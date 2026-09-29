import { describe, expect, it } from "vitest";
import { PENDING_KEEP_MS, PENDING_NO_HUB_KEEP_MS, PENDING_KEY, addPending, readPending, removePending } from "./limit-pending";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}

const entry = { spokeTxHash: "0xs", direction: "buy" as const, limitPrice: "200", srcChain: "0x2105.base", at: Date.now() };

describe("orders placed but not yet saved", () => {
  it("keeps, updates and drops an entry by its payment", () => {
    const store = memory();
    addPending(entry, store);
    addPending({ ...entry, intentTxHash: "0xh" }, store);
    expect(readPending(store)).toEqual([{ ...entry, intentTxHash: "0xh" }]);
    removePending("0xs", store);
    expect(readPending(store)).toEqual([]);
  });

  it("forgets entries past their keep, and junk", () => {
    const store = memory();
    addPending({ ...entry, at: Date.now() - PENDING_KEEP_MS - 1 }, store);
    expect(readPending(store)).toEqual([]);
    store.setItem(PENDING_KEY, "not json");
    expect(readPending(store)).toEqual([]);
    store.setItem(PENDING_KEY, JSON.stringify([{ nope: 1 }]));
    expect(readPending(store)).toEqual([]);
  });

  it("never throws when storage does", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readPending(broken)).toEqual([]);
    expect(() => addPending(entry, broken)).not.toThrow();
    expect(readPending(null)).toEqual([]);
  });

  it("forgets an entry without a hub transaction after an hour, one with it only after days", () => {
    const store = memory();
    const old = Date.now() - PENDING_NO_HUB_KEEP_MS - 1;
    addPending({ ...entry, spokeTxHash: "0xa", at: old }, store);
    addPending({ ...entry, spokeTxHash: "0xb", intentTxHash: "0xh", at: old }, store);
    expect(readPending(store).map((kept) => kept.spokeTxHash)).toEqual(["0xb"]);
  });
});
