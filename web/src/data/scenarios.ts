import type { ReasonCode } from "@/lib/reasonCodes";

export type Verdict = "allowed" | "rejected" | "needs-approval";
export type TierStatus = "verified" | "checked" | "failed" | "not-checked";
export type EvidenceOutcome = "pass" | "fail" | "note";

export interface TrustTier {
  tier: 0 | 1 | 2 | 3;
  title: string;
  status: TierStatus;
  detail: string;
}

export interface EvidenceItem {
  label: string;
  value: string;
  outcome: EvidenceOutcome;
}

export interface Scenario {
  id: string;
  title: string;
  category: string;
  summary: string;
  verdict: Verdict;
  reasonCode: ReasonCode;
  reason: string;
  amount: string;
  agentId: string;
  sessionId: string;
  invoiceName: string;
  registryName: string;
  payeeAddress: string;
  domain: string;
  tiers: TrustTier[];
  evidence: EvidenceItem[];
  txHash: string;
  event: string;
  settledAt: string;
  why: string;
}

const tier = (tier: 0 | 1 | 2 | 3, status: TierStatus, detail: string): TrustTier => ({
  tier,
  title: ["On-chain binding", "Registration metadata", "Domain control", "Payment reputation"][tier],
  status,
  detail,
});

/** Fixture data only. Hashes are placeholders and never claim a transaction happened. */
export const scenarios: Scenario[] = [
  {
    id: "legit-payment",
    title: "Legitimate payment",
    category: "Verified payee",
    summary: "Name, wallet and caps all match the committed snapshot",
    verdict: "allowed",
    reasonCode: "OK",
    reason: "The invoice name is identical to the registered payee and the payment is inside the session cap.",
    amount: "2.40",
    agentId: "1",
    sessionId: "0x5c1f…a204",
    invoiceName: "Northwind Freight Ltd",
    registryName: "Northwind Freight Ltd",
    payeeAddress: "0x4A2d6B08f91c2E7b3F55a0C6D8e41B7290cE13ac",
    domain: "northwindfreight.example",
    tiers: [
      tier(0, "verified", "nameHash and payee wallet bound on-chain"),
      tier(1, "verified", "Registry entry matches the invoice name"),
      tier(2, "verified", "Invoice domain resolves to the registered payee"),
      tier(3, "verified", "No prior disputes on this payee"),
    ],
    evidence: [
      { label: "Name skeleton", value: "northwind freight ltd", outcome: "pass" },
      { label: "Destination", value: "0x4A2d…13ac", outcome: "pass" },
      { label: "Per-payment cap", value: "2.40 of 3.00 tUSD8", outcome: "pass" },
      { label: "Session", value: "agent 1 · active", outcome: "pass" },
    ],
    txHash: "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809",
    event: "PaymentAllowed",
    settledAt: "2026-11-27 09:14 UTC",
    why: "The owner verified Northwind Freight Ltd once and the contract committed the name hash and wallet. The agent asked for a 2.40 tUSD8 payment, which is below its 3.00 per-payment cap. All four trust tiers agree, so the payment is allowed.",
  },
  {
    id: "lookalike-spoof",
    title: "Lookalike spoof",
    category: "Identity check",
    summary: "Cyrillic letters and an invisible space hide a different payee",
    verdict: "rejected",
    reasonCode: "NAME_SPOOF",
    reason: "The invoice name uses Cyrillic letters and a hidden space. Its skeleton does not match the registered payee.",
    amount: "4.80",
    agentId: "4",
    sessionId: "0x77be…10f3",
    invoiceName: "Northw\u0438nd Fr\u0435ight\u200BLtd",
    registryName: "Northwind Freight Ltd",
    payeeAddress: "0x2Fb8C410dE6a97B3541f8C0a6E52d7190aB3c4D5",
    domain: "northw1ndfre1ght.example",
    tiers: [
      tier(0, "failed", "nameHash does not match the committed snapshot"),
      tier(1, "failed", "Registry has no entry for this character sequence"),
      tier(2, "checked", "Invoice domain was registered three days ago"),
      tier(3, "not-checked", "No reputation record for this payee"),
    ],
    evidence: [
      { label: "Cyrillic small letter i", value: "U+0438 → i", outcome: "fail" },
      { label: "Cyrillic small letter ye", value: "U+0435 → e", outcome: "fail" },
      { label: "Invisible control", value: "U+200B removed", outcome: "fail" },
      { label: "Requested destination", value: "0x2Fb8…c4D5", outcome: "note" },
    ],
    txHash: "0x2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a",
    event: "PaymentRejected",
    settledAt: "2026-11-27 09:21 UTC",
    why: "Two letters and a space look ordinary on screen but are different code points. Once folded to a Latin skeleton the invoice no longer names the payee the owner verified. The contract rejects it with NAME_SPOOF before any tUSD8 moves.",
  },
  {
    id: "over-cap",
    title: "Over the per-payment cap",
    category: "Session limits",
    summary: "Verified payee, but the amount exceeds the agent's cap",
    verdict: "rejected",
    reasonCode: "ABOVE_PER_PAYMENT_CAP",
    reason: "This payment is 4.95 tUSD8. The agent session allows at most 2.00 tUSD8 in one payment.",
    amount: "4.95",
    agentId: "1",
    sessionId: "0x5c1f…a204",
    invoiceName: "Northwind Freight Ltd",
    registryName: "Northwind Freight Ltd",
    payeeAddress: "0x4A2d6B08f91c2E7b3F55a0C6D8e41B7290cE13ac",
    domain: "northwindfreight.example",
    tiers: [
      tier(0, "verified", "nameHash and payee wallet bound on-chain"),
      tier(1, "verified", "Registry entry matches the invoice name"),
      tier(2, "verified", "Invoice domain resolves to the registered payee"),
      tier(3, "checked", "Payment history reviewed for this payee"),
    ],
    evidence: [
      { label: "Requested amount", value: "4.95 tUSD8", outcome: "fail" },
      { label: "Per-payment cap", value: "2.00 tUSD8", outcome: "note" },
      { label: "Name skeleton", value: "northwind freight ltd", outcome: "pass" },
      { label: "Session", value: "agent 1 · active", outcome: "pass" },
    ],
    txHash: "0x3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b",
    event: "PaymentRejected",
    settledAt: "2026-11-27 09:26 UTC",
    why: "Identity checks pass, so the payee is real. The cap is a separate rule in the agent session: a single payment cannot exceed 2.00 tUSD8. The owner can raise the cap or split the invoice into smaller payments.",
  },
  {
    id: "revoked-session",
    title: "Revoked session",
    category: "Agent authority",
    summary: "The owner revoked the agent before this intent arrived",
    verdict: "rejected",
    reasonCode: "SESSION_REVOKED",
    reason: "The owner revoked this agent session. The agent can no longer submit payments.",
    amount: "0.75",
    agentId: "7",
    sessionId: "0x18aa…9b71",
    invoiceName: "Cedar Office Supply",
    registryName: "Cedar Office Supply",
    payeeAddress: "0x7C31a94B0eD2f586C194a3E7b5D086F2c1A4e3B7",
    domain: "cedaroffice.example",
    tiers: [
      tier(0, "verified", "nameHash and payee wallet bound on-chain"),
      tier(1, "verified", "Registry entry matches the invoice name"),
      tier(2, "verified", "Invoice domain resolves to the registered payee"),
      tier(3, "not-checked", "No reputation record for this payee"),
    ],
    evidence: [
      { label: "Agent", value: "7", outcome: "fail" },
      { label: "Session state", value: "revoked by owner", outcome: "fail" },
      { label: "Requested amount", value: "0.75 tUSD8", outcome: "note" },
      { label: "Name skeleton", value: "cedar office supply", outcome: "pass" },
    ],
    txHash: "0x4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c",
    event: "PaymentRejected",
    settledAt: "2026-11-27 09:33 UTC",
    why: "Revoking a session takes effect immediately, even for a correctly named payee and a small amount. A new session is needed before this agent can pay again.",
  },
  {
    id: "prompt-injection",
    title: "Prompt injection",
    category: "Agent instructions",
    summary: "Invoice memo tried to redirect the payment to another wallet",
    verdict: "rejected",
    reasonCode: "PROMPT_INJECTION",
    reason: "The invoice memo contained instructions to ignore the verified payee. Only the committed name and wallet are used.",
    amount: "5.00",
    agentId: "4",
    sessionId: "0x77be…10f3",
    invoiceName: "Northwind Freight Ltd",
    registryName: "Northwind Freight Ltd",
    payeeAddress: "0x9D40E7a1b28C6f53A901dE4b7C2a85F630d1E9b4",
    domain: "invoice-northwind.example",
    tiers: [
      tier(0, "verified", "nameHash and payee wallet bound on-chain"),
      tier(1, "verified", "Registry entry matches the invoice name"),
      tier(2, "failed", "Memo domain is not the registered domain"),
      tier(3, "checked", "Instruction pattern flagged in agent trace"),
    ],
    evidence: [
      { label: "Memo text", value: "ignore previous instructions", outcome: "fail" },
      { label: "Injected destination", value: "0x9D40…E9b4", outcome: "fail" },
      { label: "Committed destination", value: "0x4A2d…13ac", outcome: "pass" },
      { label: "Name skeleton", value: "northwind freight ltd", outcome: "pass" },
    ],
    txHash: "0x5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
    event: "PaymentRejected",
    settledAt: "2026-11-27 09:41 UTC",
    why: "The name matches, but the memo asked the agent to pay a different wallet. Invoice text is untrusted input: the contract only accepts the wallet committed at verification. The injected destination is ignored and the intent is rejected.",
  },
  {
    id: "approval-required",
    title: "Approval required",
    category: "Owner review",
    summary: "Digit zero stands in for the letter O in the payee name",
    verdict: "needs-approval",
    reasonCode: "APPROVAL_REQUIRED",
    reason: "The name is close to a registered payee but not identical. An owner must approve before the agent pays.",
    amount: "1.10",
    agentId: "2",
    sessionId: "0x90cd…4e18",
    invoiceName: "Cascade 0ne Supply",
    registryName: "Cascade One Supply",
    payeeAddress: "0x1D9e0a2B7c45F8361a0B4c9D2e7F5A083b6C1d42",
    domain: "cascadeone.example",
    tiers: [
      tier(0, "checked", "nameHash is close but not identical"),
      tier(1, "checked", "One registry entry is a near match"),
      tier(2, "verified", "Invoice domain resolves to a registered payee"),
      tier(3, "not-checked", "Owner review pending"),
    ],
    evidence: [
      { label: "Digit zero", value: "0 → O", outcome: "note" },
      { label: "Near match", value: "Cascade One Supply", outcome: "note" },
      { label: "Requested amount", value: "1.10 tUSD8", outcome: "pass" },
      { label: "Owner decision", value: "pending", outcome: "note" },
    ],
    txHash: "0x6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e",
    event: "ApprovalRequested",
    settledAt: "2026-11-27 09:48 UTC",
    why: "The zero in '0ne' reads as the letter O, but it is a different character. Because the name is a near match rather than a clear spoof, the payment waits for an owner. Nothing is sent until the intent is approved or cancelled.",
  },
  {
    id: "replay",
    title: "Replayed intent",
    category: "Replay protection",
    summary: "The same signed intent was submitted a second time",
    verdict: "rejected",
    reasonCode: "REPLAY",
    reason: "This intent was already settled. The contract will not pay the same intent twice.",
    amount: "1.25",
    agentId: "1",
    sessionId: "0x5c1f…a204",
    invoiceName: "Cedar Office Supply",
    registryName: "Cedar Office Supply",
    payeeAddress: "0x7C31a94B0eD2f586C194a3E7b5D086F2c1A4e3B7",
    domain: "cedaroffice.example",
    tiers: [
      tier(0, "verified", "intent hash already recorded on-chain"),
      tier(1, "verified", "Registry entry matches the invoice name"),
      tier(2, "verified", "Invoice domain resolves to the registered payee"),
      tier(3, "checked", "Duplicate detected in settlement log"),
    ],
    evidence: [
      { label: "Intent hash", value: "0x3ba0…7f21", outcome: "fail" },
      { label: "First settlement", value: "2026-11-27 09:02 UTC", outcome: "note" },
      { label: "Name skeleton", value: "cedar office supply", outcome: "pass" },
      { label: "Requested amount", value: "1.25 tUSD8", outcome: "pass" },
    ],
    txHash: "0x708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
    event: "PaymentRejected",
    settledAt: "2026-11-27 09:52 UTC",
    why: "A relayer can resend a signed intent, but the contract records each intent hash once. The second submission is rejected with REPLAY so the payee is not paid twice.",
  },
  {
    id: "wallet-rotation",
    title: "Wallet rotation",
    category: "Binding changed",
    summary: "Payee wallet changed after the identity snapshot was committed",
    verdict: "rejected",
    reasonCode: "PAYEE_CHANGED",
    reason: "The destination wallet differs from the one bound to this payee. Re-verify before paying.",
    amount: "3.20",
    agentId: "2",
    sessionId: "0x90cd…4e18",
    invoiceName: "Cascade One Supply",
    registryName: "Cascade One Supply",
    payeeAddress: "0x5b7F21c0D93a4E68b2f1C07d3A95E6428c0B7d31",
    domain: "cascadeone.example",
    tiers: [
      tier(0, "failed", "Destination does not match the committed wallet"),
      tier(1, "verified", "Registry entry matches the invoice name"),
      tier(2, "verified", "Invoice domain resolves to the registered payee"),
      tier(3, "checked", "Wallet rotation notice found"),
    ],
    evidence: [
      { label: "Committed wallet", value: "0x1D9e…1d42", outcome: "pass" },
      { label: "Requested wallet", value: "0x5b7F…7d31", outcome: "fail" },
      { label: "Name skeleton", value: "cascade one supply", outcome: "pass" },
      { label: "Rotation notice", value: "unconfirmed", outcome: "note" },
    ],
    txHash: "0x8192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70",
    event: "PaymentRejected",
    settledAt: "2026-11-27 10:03 UTC",
    why: "The payee name is right, but the wallet is not. A rotated wallet must be verified and committed again before agents are allowed to send funds to it. Until then the payment is rejected with PAYEE_CHANGED.",
  },
];

export interface PendingIntent {
  id: string;
  payee: string;
  amount: string;
  agentId: string;
  reasonCode: ReasonCode;
}

export const pendingIntents: PendingIntent[] = [
  { id: "0x3ba07c14e9d2f6804a1b6c8d0e2f3975148a6b0d3c9e7f15284a6b0d3c9e7f15", payee: "Halcyon Print Co", amount: "0.40", agentId: "7", reasonCode: "NOT_ALLOWLISTED" },
  { id: "0x9e12d47b60ca8f354c7d1e0b9a2863f57c1d0e8b4a6f3927d1e0b9a2863f57c1", payee: "Northwind Freight Ltd", amount: "2.60", agentId: "1", reasonCode: "ABOVE_TOTAL_CAP" },
  { id: "0x6c83f0a9d17b4e526f0a1c8d3e7b92546f0a1c8d3e7b92546f0a1c8d3e7b9254", payee: "Cascade 0ne Supply", amount: "1.10", agentId: "2", reasonCode: "APPROVAL_REQUIRED" },
];

export interface DemoSession {
  agentId: string;
  wallet: string;
  perPaymentCap: string;
  totalCap: string;
  spent: string;
  status: "active" | "revoked";
}

export const demoSessions: DemoSession[] = [
  { agentId: "1", wallet: "0x8F2a…4c10", perPaymentCap: "3.00", totalCap: "24.00", spent: "9.15", status: "active" },
  { agentId: "4", wallet: "0x2c7B…91dE", perPaymentCap: "5.00", totalCap: "40.00", spent: "31.60", status: "active" },
  { agentId: "7", wallet: "0x4d1E…20aF", perPaymentCap: "1.00", totalCap: "8.00", spent: "0.75", status: "revoked" },
];

export const knownPayees = [
  "Northwind Freight Ltd",
  "Cedar Office Supply",
  "Cascade One Supply",
  "Halcyon Print Co",
  "Meridian Data Services",
] as const;

/** Explorer links are real, but every fixture hash above is a placeholder for a future receipt. */
export const isPlaceholderHash = (hash: string) => /^[0-9a-f]{64}$/i.test(hash.slice(2)) && hash.length === 66;
