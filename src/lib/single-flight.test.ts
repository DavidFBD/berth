import { describe, expect, it, vi } from "vitest";
import { createSingleFlight } from "./single-flight";

describe("createSingleFlight", () => {
  it("a double tap in the same frame starts the task once", async () => {
    const flight = createSingleFlight();
    let release!: () => void;
    const sign = vi.fn(() => new Promise<string>((resolve) => (release = () => resolve("signed"))));
    const first = flight.run(sign);
    const second = flight.run(sign);
    expect(flight.isRunning()).toBe(true);
    expect(await second).toBeUndefined();
    release();
    expect(await first).toBe("signed");
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("frees the berth after a success and after a throw", async () => {
    const flight = createSingleFlight();
    const task = vi.fn(async () => "ok");
    await flight.run(task);
    await flight.run(task);
    expect(task).toHaveBeenCalledTimes(2);

    await expect(flight.run(async () => { throw new Error("rejected"); })).rejects.toThrow("rejected");
    expect(flight.isRunning()).toBe(false);
    expect(await flight.run(task)).toBe("ok");
  });
});
