import { describe, expect, it } from "vitest";
import {
  canExportKeys,
  initialKeyExportGateState,
  keyExportGateReducer,
  type KeyExportGateState,
} from "./key-export-gate";

const open = (state: KeyExportGateState) => keyExportGateReducer(state, { type: "open" });
const close = (state: KeyExportGateState) => keyExportGateReducer(state, { type: "close" });
const acknowledge = (state: KeyExportGateState, value: boolean) =>
  keyExportGateReducer(state, { type: "acknowledge", value });

describe("key export gate", () => {
  it("starts closed and unexportable", () => {
    expect(initialKeyExportGateState).toEqual({ confirming: false, acknowledged: false });
    expect(canExportKeys(initialKeyExportGateState)).toBe(false);
  });

  it("cannot export merely by opening the confirmation", () => {
    const state = open(initialKeyExportGateState);
    expect(canExportKeys(state)).toBe(false);
  });

  it("unlocks only once the confirmation is open and ticked", () => {
    const state = acknowledge(open(initialKeyExportGateState), true);
    expect(state).toEqual({ confirming: true, acknowledged: true });
    expect(canExportKeys(state)).toBe(true);
  });

  it("ignores a tick while the confirmation is closed", () => {
    const state = acknowledge(initialKeyExportGateState, true);
    expect(state).toEqual(initialKeyExportGateState);
    expect(canExportKeys(state)).toBe(false);
  });

  it("unticking locks it again without closing", () => {
    let state = acknowledge(open(initialKeyExportGateState), true);
    expect(canExportKeys(state)).toBe(true);
    state = acknowledge(state, false);
    expect(state).toEqual({ confirming: true, acknowledged: false });
    expect(canExportKeys(state)).toBe(false);
  });

  it("closing resets the tick, so reopening always starts unticked", () => {
    const ticked = acknowledge(open(initialKeyExportGateState), true);
    const closed = close(ticked);
    expect(closed).toEqual({ confirming: false, acknowledged: false });

    const reopened = open(closed);
    expect(reopened.acknowledged).toBe(false);
    expect(canExportKeys(reopened)).toBe(false);
  });
});
