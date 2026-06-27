import {
  ensureDynamicConfigValkeySubscriptionClient,
  addPubSubMessageHandler,
  removePubSubMessageHandler,
  dynamicConfigValkeyClient,
} from "./clients.mts";
import type { GlideClient, PubSubMsg } from "@valkey/valkey-glide";
import type { DynamicConfigOptions, DynamicConfigField, DynamicConfigFieldType } from "./types.mts";
import { handleValkeyError } from "./errors.mts";
import {
  applyFieldsFromMap,
  buildMissingDefaultWrites,
  getDynamicConfigFieldsMap,
  writeDynamicConfigFields,
} from "./dynamic-config/storage.mts";
import {
  parseField,
  processFieldValue,
  stringifyField,
  validateFieldTypes,
} from "./dynamic-config/fields.mts";
const NAMESPACE = "dynamic-config";
const isTest = process.env.NODE_ENV === "test";

export const dynamicConfigs: DynamicConfig[] = [];

export class DynamicConfig {
  staleTtl: number;
  key: string;
  fields: Map<string, DynamicConfigField>;
  fieldTypes: Record<string, DynamicConfigFieldType>;
  defaultFields: Record<string, DynamicConfigField>;
  initialization: Promise<void>;
  private fieldsConfig: {
    name: string;
    type: DynamicConfigFieldType;
    defaultValue: DynamicConfigField;
  }[];
  private client: GlideClient;
  private closed: boolean = false;
  private lastRefresh: number = 0;
  private isRefreshing: boolean = false;
  private refreshUpdatedFields: Set<string> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly messageHandler = (msg: PubSubMsg) => this.handlePubSubMessage(msg);

  constructor(options: DynamicConfigOptions) {
    this.staleTtl = options.staleTtlSeconds || 60;
    this.key = `${NAMESPACE}:${options.key}`;
    this.fieldTypes = options.fieldTypes;
    this.defaultFields = options.defaultFields;
    this.client = options.client ?? dynamicConfigValkeyClient;
    this.fields = new Map();

    const keys = Object.keys(this.fieldTypes);
    // eslint-disable-next-line unicorn/no-new-array
    this.fieldsConfig = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const name = keys[i];
      this.fieldsConfig[i] = {
        name,
        type: this.fieldTypes[name],
        defaultValue: this.defaultFields[name],
      };
    }
    /* v8 ignore next 3 -- duplicate construction is guarded only outside NODE_ENV=test. */
    if (!isTest && dynamicConfigs.some((config) => config.key === this.key)) {
      throw new Error(`DynamicConfig already initialized: ${this.key}`);
    }
    dynamicConfigs.push(this);
    this.initialization = this.initialize();
    /* v8 ignore next -- tests run with NODE_ENV=test and do not attach startup catch handlers. */
    if (!isTest) {
      this.initialization.catch((err) => {
        handleValkeyError(err);
      });
    }
  }

  async initialize() {
    this.validateFieldTypes();
    const fieldsMap = await this.getFieldsMap();
    const { toApply, writeArgs } = buildMissingDefaultWrites({
      fieldsMap,
      fieldsConfig: this.fieldsConfig,
    });
    await writeDynamicConfigFields({ key: this.key, args: writeArgs, client: this.client });

    // Keep identity stable for callers that captured `fields` by reference.
    this.fields.clear();
    for (const [name, value] of toApply) {
      this.fields.set(name, value);
    }

    // Mark initialized so the refresh timer doesn't race with initialization
    this.lastRefresh = Date.now();
    await this.subscribe();
    /* v8 ignore next -- closing during the subscription await is a shutdown race guard. */
    if (this.closed) return;
    this.createRefreshTimer();
  }

  async waitForInitialization(): Promise<void> {
    await this.initialization;
  }

  private validateFieldTypes() {
    validateFieldTypes(this.fieldTypes, this.defaultFields);
  }

  stringifyField = stringifyField;
  parseField = parseField;

  private getFieldsMap(): Promise<Record<string, { field: unknown; value: unknown }>> {
    return getDynamicConfigFieldsMap(this.key, this.client);
  }

  private async applyFieldsFromMap(
    fieldsMap: Record<string, { field: unknown; value: unknown }>,
    skipFieldNames: Set<string> = new Set(),
  ): Promise<void> {
    await applyFieldsFromMap({
      fields: this.fields,
      fieldsMap,
      fieldsConfig: this.fieldsConfig,
      skipFieldNames,
    });
  }

  async subscribe(): Promise<void> {
    if (this.closed) return;
    await ensureDynamicConfigValkeySubscriptionClient();
    /* v8 ignore next -- closing during the subscription await is a shutdown race guard. */
    if (this.closed) return;
    addPubSubMessageHandler(this.messageHandler);
  }

  // Unsubscribe from pub/sub
  unsubscribe(): void {
    removePubSubMessageHandler(this.messageHandler);
  }

  private handlePubSubMessage(msg: PubSubMsg) {
    const channel = msg.channel.toString();
    const prefix = `${this.key}:`;

    // Only process messages for this config's key
    if (!channel.startsWith(prefix)) return;

    const fieldName = channel.slice(prefix.length);
    const type = this.fieldTypes[fieldName];
    if (!type) return;

    this.refreshUpdatedFields?.add(fieldName);
    const value = parseField(type, msg.message.toString());
    this.fields.set(fieldName, value);
  }

  createRefreshTimer() {
    const refreshInterval = Math.max(this.staleTtl * 1000, 1000); // Convert to ms, minimum 1 second
    /* v8 ignore next 3 -- interval callback is defensive background refresh plumbing. */
    this.refreshTimer = setInterval(() => {
      this.refresh().catch(handleValkeyError);
    }, refreshInterval);
    this.refreshTimer.unref(); // Do not hold the event loop open if the process wants to exit
  }

  close(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    const idx = dynamicConfigs.indexOf(this);
    if (idx !== -1) dynamicConfigs.splice(idx, 1);
    return Promise.resolve();
  }

  async refresh() {
    if (this.closed) return;
    if (this.isRefreshing) return;
    const now = Date.now();
    if (now - this.lastRefresh < this.staleTtl * 1000) return;
    this.lastRefresh = now; // Optimistic claim: prevents concurrent duplicate refreshes
    const refreshUpdatedFields = new Set<string>();
    this.refreshUpdatedFields = refreshUpdatedFields;
    this.isRefreshing = true;
    try {
      const fieldsMap = await this.getFieldsMap();
      await this.applyFieldsFromMap(fieldsMap, refreshUpdatedFields);
    } catch (err) {
      /* v8 ignore next -- transient Valkey failures are environment-dependent. */
      this.lastRefresh = 0; // Reset so the next interval can retry after a transient failure
      /* v8 ignore next -- rethrow preserves caller-visible refresh failure semantics. */
      throw err;
    } finally {
      if (this.refreshUpdatedFields === refreshUpdatedFields) {
        this.refreshUpdatedFields = null;
      }
      this.isRefreshing = false;
    }
  }

  getFields(): Record<string, DynamicConfigField> {
    const result: Record<string, DynamicConfigField> = {};
    // ⚡ Bolt Optimization:
    // What: Iterate over map using forEach instead of .entries()
    // Why: Avoids iterator overhead and array tuple allocations on every iteration.
    // Impact: Reduces GC pressure in hot paths.
    this.fields.forEach((value, name) => {
      result[name] = value;
    });
    return result;
  }

  // set the fields in valkey and publish change events atomically via Lua script,
  // then apply local state only after a successful write
  async setFields(fields: Record<string, DynamicConfigField>): Promise<void> {
    const toApplyNames: string[] = [];
    const toApplyValues: DynamicConfigField[] = [];
    const args: string[] = [];

    // Use for-in to iterate over fields without allocating an array of entries
    for (const name in fields) {
      if (!Object.hasOwn(fields, name)) continue;

      const type = this.fieldTypes[name];
      if (!type) {
        throw new Error(`Unknown field: ${name}`);
      }

      const value = fields[name];
      const processedValue = processFieldValue(type, value);

      toApplyNames.push(name);
      toApplyValues.push(processedValue);
      args.push(name, stringifyField(type, processedValue));
    }

    await writeDynamicConfigFields({ key: this.key, args, client: this.client });

    for (let i = 0; i < toApplyNames.length; i += 1) {
      this.fields.set(toApplyNames[i], toApplyValues[i]);
    }
  }

  setField(name: string, value: DynamicConfigField): Promise<void> {
    return this.setFields({ [name]: value });
  }
}
