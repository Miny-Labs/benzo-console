/**
 * Central copy constants — reusable privacy / disclosure wording so every screen
 * says the same thing the same way. Business language first; cryptographic detail
 * only where it earns its place. Screens adopt these in later waves; exported now so
 * the vocabulary is fixed before the rewrites start.
 *
 * Rule of thumb:
 *  - PRIVACY.privateOnChain — the amount AND recipient are not publicly visible.
 *  - PRIVACY.visibleToWorkspace — authorized teammates can see it in this console.
 *  - PRIVACY.hiddenDueToRole — you personally can't see it (your role, not a failure).
 *  - PRIVACY.disclosedThroughProof — revealed deliberately, backed by an on-chain proof.
 *  - PRIVACY.hideBalances — the screen-level mask toggle label.
 */
export const PRIVACY = {
  /** Amount + recipient are not publicly visible on-chain. */
  privateOnChain: "Private on-chain",
  /** Longer form for tooltips / callouts. */
  privateOnChainLong: "The amount and recipient aren't publicly visible on-chain.",
  /** Visible to teammates who are authorized in this workspace. */
  visibleToWorkspace: "Visible to authorized workspace members",
  /** The value is withheld from the current viewer because of their role. */
  hiddenDueToRole: "Hidden due to your role",
  /** Value revealed on purpose, backed by an on-chain-verified proof. */
  disclosedThroughProof: "Disclosed through proof",
  /** Screen-level mask toggle (hide monetary values). */
  hideBalances: "Hide balances",
  /** Inverse of hideBalances, for the toggled-on state. */
  showBalances: "Show balances",
} as const;

export type PrivacyCopyKey = keyof typeof PRIVACY;
