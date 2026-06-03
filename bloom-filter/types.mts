import type { GlideClient } from "@valkey/valkey-glide";

export type BloomFilterState = {
  name: string;
  capacity: number;
  errorRate: number;
  expansionRate: number;
  batchSize: number;
  concurrencyLimit: number;
  liveKey: string;
  buildingKey: string;
  client: GlideClient;
};
