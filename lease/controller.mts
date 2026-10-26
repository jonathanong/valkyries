import { pexpireIfValueMatches, unlinkIfValueMatches } from "../conditional.mts";
import type { RenewableLease, RenewableLeaseLoss } from "../lease.mts";
import type { ResolvedLeaseOptions } from "./validate.mts";

type State = "held" | "lost" | "released";

/**
 * Owns one confirmed acquisition: serialized renewal, a monotonic validity deadline, and
 * token-conditional cleanup. It never touches caller work.
 */
export class LeaseController implements RenewableLease {
  readonly lost: Promise<RenewableLeaseLoss>;
  #state: State = "held";
  #deadline: number;
  #renewTimer: NodeJS.Timeout | undefined;
  #expiryTimer: NodeJS.Timeout | undefined;
  #inFlight: Promise<void> | undefined;
  #releasing: Promise<boolean> | undefined;
  #resolveLost!: (loss: RenewableLeaseLoss) => void;

  readonly #key: string;
  readonly #token: string;
  readonly #options: ResolvedLeaseOptions;

  constructor(key: string, token: string, options: ResolvedLeaseOptions, dispatchedAt: number) {
    this.#key = key;
    this.#token = token;
    this.#options = options;
    this.lost = new Promise((resolve) => {
      this.#resolveLost = resolve;
    });
    this.#deadline = dispatchedAt + options.ttlMs;
    // The interval also starts at dispatch, so a slow acquisition renews sooner.
    this.#schedule(Math.max(0, options.renewalIntervalMs - (performance.now() - dispatchedAt)));
  }

  get isHeld(): boolean {
    this.#checkDeadline();
    return this.#state === "held";
  }

  release(): Promise<boolean> {
    // Mark not-held and stop scheduling before the first await.
    if (this.#state === "held") this.#state = "released";
    this.#clearTimers();
    this.#releasing ??= this.#cleanup();
    return this.#releasing;
  }

  async #cleanup(): Promise<boolean> {
    await this.#inFlight;
    return await unlinkIfValueMatches(this.#key, this.#token, { client: this.#options.client });
  }

  #checkDeadline(): void {
    if (this.#state === "held" && performance.now() >= this.#deadline) {
      this.#markLost({ reason: "expired" });
    }
  }

  #markLost(loss: RenewableLeaseLoss): void {
    if (this.#state !== "held") return;
    this.#state = "lost";
    this.#clearTimers();
    this.#resolveLost(loss);
  }

  #clearTimers(): void {
    clearTimeout(this.#renewTimer);
    clearTimeout(this.#expiryTimer);
  }

  #schedule(renewDelayMs: number): void {
    this.#clearTimers();
    this.#renewTimer = setTimeout(() => this.#renew(), renewDelayMs).unref();
    this.#armExpiry();
  }

  #armExpiry(): void {
    const remaining = Math.max(0, this.#deadline - performance.now());
    this.#expiryTimer = setTimeout(() => this.#onExpiryTimer(), remaining).unref();
  }

  #onExpiryTimer(): void {
    this.#checkDeadline();
    // Timers can fire slightly early; re-arm for the remainder.
    if (this.#state === "held") this.#armExpiry();
  }

  #renew(): void {
    // A blocked event loop can run this timer past the deadline; never extend an expired lease.
    this.#checkDeadline();
    if (this.#state !== "held") return;
    this.#inFlight = this.#renewOnce();
  }

  async #renewOnce(): Promise<void> {
    // The deadline is measured from dispatch, never from the response.
    const dispatchedAt = performance.now();
    let renewed: boolean;
    try {
      renewed = await pexpireIfValueMatches(this.#key, this.#token, this.#options.ttlMs, {
        client: this.#options.client,
      });
    } catch (error) {
      this.#markLost({ reason: "renewal-error", error });
      return;
    }
    // A late response must not revive a lost, expired, stopping or released lease.
    this.#checkDeadline();
    if (this.#state !== "held") return;
    if (!renewed) {
      this.#markLost({ reason: "not-owner" });
      return;
    }
    this.#deadline = dispatchedAt + this.#options.ttlMs;
    const elapsed = performance.now() - dispatchedAt;
    this.#schedule(Math.max(0, this.#options.renewalIntervalMs - elapsed));
  }
}
