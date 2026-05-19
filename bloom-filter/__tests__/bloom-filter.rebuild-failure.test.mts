import { expect, it, describe, vi } from "vitest";
import { ValkeyBloomFilter } from "../../bloom-filter.mts";

describe("rebuildFromStream failure handling", () => {
  it("waits for all chunks in a concurrent batch to settle before cleaning up on failure", async () => {
    const mockClient: any = {
      invokeScript: vi.fn().mockResolvedValue(1),
      customCommand: vi.fn(),
      unlink: vi.fn().mockResolvedValue(1),
    };

    const filter = new ValkeyBloomFilter({
      name: "test-rebuild-failure",
      capacity: 1000,
      errorRate: 0.01,
      batchSize: 5, // Small batch size to trigger multiple chunks
      client: mockClient,
    });

    let activeMadds = 0;
    let maxConcurrentMadds = 0;
    const maddFinishedTimes: number[] = [];

    mockClient.customCommand.mockImplementation(async (args: string[]) => {
      const cmd = args[0];
      if (cmd === "BF.MADD") {
        activeMadds++;
        maxConcurrentMadds = Math.max(maxConcurrentMadds, activeMadds);

        const item = args[2];
        if (item === "fail") {
          activeMadds--;
          throw new Error("Simulated Valkey failure");
        }

        // Simulating network delay for other chunks
        await new Promise((resolve) => setTimeout(resolve, 50));
        activeMadds--;
        maddFinishedTimes.push(Date.now());
        return [1];
      }
      return 1;
    });

    let unlinkTime = 0;
    mockClient.unlink.mockImplementation(async () => {
      unlinkTime = Date.now();
      return 1;
    });

    async function* batches() {
      // 10 items, batchSize 5 -> 2 chunks of 5.
      // Chunk 1: [fail, 2, 3, 4, 5]
      // Chunk 2: [6, 7, 8, 9, 10]
      // Since concurrencyLimit is 16, both chunks will be dispatched together.
      yield [
        "fail",
        "item2",
        "item3",
        "item4",
        "item5",
        "item6",
        "item7",
        "item8",
        "item9",
        "item10",
      ];
    }

    await expect(filter.rebuildFromStream(batches())).rejects.toThrow("Simulated Valkey failure");

    // Verify both chunks were dispatched
    expect(mockClient.customCommand).toHaveBeenCalledTimes(2);
    // (Plus any other calls like EXISTS if they were there, but here just BF.MADD)

    // Verify unlink happened AFTER the successful (but slow) chunk finished
    expect(unlinkTime).toBeGreaterThan(0);
    for (const finishTime of maddFinishedTimes) {
      expect(unlinkTime).toBeGreaterThanOrEqual(finishTime);
    }
  });
});
