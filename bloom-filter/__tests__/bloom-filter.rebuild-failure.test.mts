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

    const sequence: string[] = [];
    let resolveSlowMadd: (value: unknown) => void;
    const slowMaddPromise = new Promise((resolve) => {
      resolveSlowMadd = resolve;
    });

    mockClient.customCommand.mockImplementation(async (args: string[]) => {
      const cmd = args[0];
      if (cmd === "BF.MADD") {
        const item = args[2];
        if (item === "fail") {
          sequence.push("madd-fail");
          throw new Error("Simulated Valkey failure");
        }

        // Simulating a successful but slow chunk that finishes after the failure
        await slowMaddPromise;
        sequence.push("madd-success-slow");
        return [1];
      }
      return 1;
    });

    mockClient.unlink.mockImplementation(async () => {
      sequence.push("unlink");
      return 1;
    });

    async function* batches() {
      // 10 items, batchSize 5 -> 2 chunks of 5.
      // Chunk 1: [fail, 2, 3, 4, 5]
      // Chunk 2: [6, 7, 8, 9, 10]
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

    const rebuildPromise = filter.rebuildFromStream(batches());

    // Give it a moment to dispatch the commands
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify that the failure happened but unlink is waiting
    expect(sequence).toContain("madd-fail");
    expect(sequence).not.toContain("madd-success-slow");
    expect(sequence).not.toContain("unlink");

    // Resolve the slow chunk
    resolveSlowMadd!([1]);

    await expect(rebuildPromise).rejects.toThrow("Simulated Valkey failure");

    // Verify that everything finished in the correct order
    expect(sequence).toEqual(["madd-fail", "madd-success-slow", "unlink"]);
  });
});
