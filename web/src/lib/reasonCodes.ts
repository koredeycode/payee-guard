/** Every reason the on-chain decision can report, with the wording used across the app. */
export const reasonCodes = [
  "OK",
  "NOT_ALLOWLISTED",
  "NAME_SPOOF",
  "ABOVE_PER_PAYMENT_CAP",
  "ABOVE_TOTAL_CAP",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "PAYEE_CHANGED",
  "REPLAY",
  "PROMPT_INJECTION",
  "APPROVAL_REQUIRED",
  "PAUSED",
  "WALLET_ROTATED",
  "UNKNOWN",
] as const;

export type ReasonCode = (typeof reasonCodes)[number];

/** Plain-language meaning of each reason code. No code is left unexplained. */
export const reasonExplanations: Record<ReasonCode, string> = {
  OK: "The payee matched the committed identity and the payment stayed inside every cap.",
  NOT_ALLOWLISTED: "This payee is not on the owner's allowlist, so the agent cannot pay them.",
  NAME_SPOOF: "The invoice name resolves to a different entity than the registered payee. Confusable letters were found.",
  ABOVE_PER_PAYMENT_CAP: "This single payment is above the per-payment cap in the agent session.",
  ABOVE_TOTAL_CAP: "Payments in this session have reached the total cap.",
  SESSION_REVOKED: "The owner revoked this agent session before the payment was sent.",
  SESSION_EXPIRED: "The agent session expired before the payment was sent.",
  PAYEE_CHANGED: "The destination wallet does not match the wallet committed when the payee was verified.",
  REPLAY: "This intent was already submitted. The payment was not sent a second time.",
  PROMPT_INJECTION: "The invoice memo carried instructions that tried to change the payment. Only the verified payee and amount are used.",
  APPROVAL_REQUIRED: "The name is close to, but not identical to, a registered payee. An owner must approve before payment.",
  PAUSED: "The owner paused payments. No agent can pay until payments resume.",
  WALLET_ROTATED: "The payee wallet was rotated after the identity snapshot. Re-verify the payee before paying.",
  UNKNOWN: "No reason was recorded for this decision. Treat it as blocked until an owner checks it.",
};

export function explainReason(code: ReasonCode): string {
  return reasonExplanations[code];
}
