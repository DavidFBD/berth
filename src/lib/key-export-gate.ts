/**
 * Gating for the private key export step (settings-drawer's Advanced
 * section, account-button's KeyExportRow). Tapping the row opens a
 * confirmation with the risk spelled out; the EVM/Solana export buttons
 * stay disabled until "I understand" is ticked. Pulled out as a pure
 * reducer so the rule ("must confirm, ticking resets on close") is a unit
 * test rather than something only a mounted component could prove.
 */

export type KeyExportGateState = {
  /** The confirmation step is open (the row was tapped). */
  confirming: boolean;
  /** "I understand" is ticked. Always false unless confirming. */
  acknowledged: boolean;
};

export type KeyExportGateAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "acknowledge"; value: boolean };

export const initialKeyExportGateState: KeyExportGateState = {
  confirming: false,
  acknowledged: false,
};

export function keyExportGateReducer(
  state: KeyExportGateState,
  action: KeyExportGateAction,
): KeyExportGateState {
  switch (action.type) {
    case "open":
      // Always starts unticked: an old tick from a prior visit should never
      // carry the risk step for you.
      return { confirming: true, acknowledged: false };
    case "close":
      return { confirming: false, acknowledged: false };
    case "acknowledge":
      // Ticking only means something once the risk text is actually shown.
      if (!state.confirming) return state;
      return { ...state, acknowledged: action.value };
    default:
      return state;
  }
}

/** Whether the EVM/Solana export buttons may be tapped. */
export function canExportKeys(state: KeyExportGateState): boolean {
  return state.confirming && state.acknowledged;
}
