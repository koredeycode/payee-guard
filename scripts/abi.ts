import { keccak256, parseAbi, parseAbiItem, toHex, type AbiEvent, type Hex } from "viem";

/**
 * Real ABI of `contracts/src/PayeeGuard.sol` on the payee-guard-contracts branch.
 *
 * The security invariant is that the guard derives the payee from
 * `registry.getAgentWallet(agentId)` / `payees[agentId]`; there is deliberately no
 * `pay(agentId, payee, …)` entry point. Do not reintroduce a caller-supplied payee.
 */
export const guardAbi = parseAbi([
  "function token() view returns (address)",
  "function owner() view returns (address)",
  "function registry() view returns (address)",
  "function setRegistry(address registry_)",
  "function payees(uint256) view returns (address wallet, bytes32 nameHash, bytes32 metadataHash, bool allowed)",
  "function sessions(bytes32) view returns (uint256 maxPerPayment, uint256 maxCumulative, uint256 spent, uint256 autoApproveLimit, uint64 validAfter, uint64 expiresAt, uint64 epoch, bool revoked)",
  "function intents(bytes32) view returns (uint256 agentId, address payee, uint256 amount, bytes32 nameHash, bytes32 metadataHash, uint64 expiresAt, address createdBy, uint64 sessionEpoch, bool approved, bool executed)",
  "function payeeOf(uint256 agentId) view returns ((address wallet, bytes32 nameHash, bytes32 metadataHash, bool allowed))",
  "function sessionOf(uint256 agentId, address operator) view returns ((uint256 maxPerPayment, uint256 maxCumulative, uint256 spent, uint256 autoApproveLimit, uint64 validAfter, uint64 expiresAt, uint64 epoch, bool revoked))",
  "function intentOf(bytes32 intentId) view returns ((uint256 agentId, address payee, uint256 amount, bytes32 nameHash, bytes32 metadataHash, uint64 expiresAt, address createdBy, uint64 sessionEpoch, bool approved, bool executed))",
  "function sessionKey(uint256 agentId, address operator) view returns (bytes32)",
  "function policyReason(bytes32 intentId) view returns (bytes32)",
  "function allowPayee(uint256 agentId, address wallet, bytes32 nameHash, bytes32 metadataHash)",
  "function revokePayee(uint256 agentId)",
  "function deposit(uint256 amount) returns (uint256 balance)",
  "function withdraw(address to, uint256 amount) returns (uint256 balance)",
  "function withdraw(uint256 amount) returns (uint256 balance)",
  "function createSession(uint256 agentId, address operator, uint256 maxPerPayment, uint256 maxCumulative, uint256 autoApproveLimit, uint64 validAfter, uint64 expiresAt) returns (uint64 epoch)",
  "function revokeSession(uint256 agentId, address operator)",
  "function proposeIntent(uint256 agentId, uint256 amount, bytes32 nameHash, bytes32 metadataHash, uint64 expiresAt) returns (bytes32 intentId)",
  "function approveIntent(bytes32 intentId)",
  "function cancelIntent(bytes32 intentId)",
  "function executeIntent(bytes32 intentId)",
  "function tryExecuteIntent(bytes32 intentId) returns (bool success)",
  "function pause()",
  "function unpause()",
  "event PayeeAllowed(uint256 indexed agentId, address indexed wallet, bytes32 nameHash, bytes32 metadataHash)",
  "event PayeeRevoked(uint256 indexed agentId, address indexed wallet)",
  "event Deposited(address indexed depositor, uint256 amount, uint256 balance)",
  "event SessionCreated(uint256 indexed agentId, address indexed operator, bytes32 indexed key, uint64 epoch, uint256 maxPerPayment, uint256 maxCumulative, uint256 autoApproveLimit, uint64 validAfter, uint64 expiresAt)",
  "event SessionRevoked(uint256 indexed agentId, address indexed operator, bytes32 indexed key, uint64 epoch)",
  "event IntentProposed(bytes32 indexed intentId, uint256 indexed agentId, address indexed payee, uint256 amount, bytes32 nameHash, bytes32 metadataHash, uint64 expiresAt, address createdBy, uint64 sessionEpoch, bool approved)",
  "event IntentApproved(bytes32 indexed intentId, address indexed approver)",
  "event IntentCancelled(bytes32 indexed intentId, address indexed canceller)",
  "event PaymentSent(bytes32 indexed intentId, bytes32 indexed paymentRef, uint256 indexed agentId, address payee, uint256 amount, address caller)",
  "event PaymentRejected(bytes32 indexed intentId, address indexed caller, bytes32 reason)",
]);

export const intentProposedEvent = parseAbiItem(
  "event IntentProposed(bytes32 indexed intentId, uint256 indexed agentId, address indexed payee, uint256 amount, bytes32 nameHash, bytes32 metadataHash, uint64 expiresAt, address createdBy, uint64 sessionEpoch, bool approved)",
) as AbiEvent;

export const paymentSentEvent = parseAbiItem(
  "event PaymentSent(bytes32 indexed intentId, bytes32 indexed paymentRef, uint256 indexed agentId, address payee, uint256 amount, address caller)",
) as AbiEvent;

export const paymentRejectedEvent = parseAbiItem(
  "event PaymentRejected(bytes32 indexed intentId, address indexed caller, bytes32 reason)",
) as AbiEvent;

/** ERC-8004 Identity Registry (`contracts/src/IdentityRegistry.sol`, 0-indexed agent IDs). */
export const registryAbi = parseAbi([
  "function register(string agentURI, (string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)",
  "function register(string agentURI) returns (uint256 agentId)",
  "function register() returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)",
  "function unsetAgentWallet(uint256 agentId)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 agentId) view returns (address owner)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function domainSeparator() view returns (bytes32)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

/** Extra tUSD8 functions used only on a local fork (master-minter impersonation). */
export const tokenMintAbi = parseAbi([
  "function configureMinter(address minter, uint256 allowance) returns (bool)",
  "function mint(address account, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

/** The EIP-712 struct that binds an ERC-8004 agent wallet to its owner. */
export const agentWalletTypes = {
  AgentWalletSet: [
    { name: "agentId", type: "uint256" },
    { name: "newWallet", type: "address" },
    { name: "owner", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** PayeeGuard policy reasons are `keccak256("REASON")`, not ASCII bytes32 values. */
export const POLICY_REASONS = [
  "NOT_AUTHORIZED",
  "NOT_ALLOWLISTED",
  "NAME_HASH_MISMATCH",
  "METADATA_HASH_MISMATCH",
  "PAYEE_CHANGED",
  "APPROVAL_REQUIRED",
  "ABOVE_PER_PAYMENT_CAP",
  "ABOVE_CUMULATIVE_CAP",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "INTENT_EXPIRED",
  "INTENT_EXECUTED",
  "ZERO_AMOUNT",
  "INSUFFICIENT_BALANCE",
  "PAUSED",
  "WRONG_SESSION_EPOCH",
] as const;

export type PolicyReason = (typeof POLICY_REASONS)[number];

export function reasonHash(reason: PolicyReason | string): Hex {
  return keccak256(toHex(reason));
}

const REASON_LABELS: ReadonlyMap<string, string> = new Map(
  POLICY_REASONS.map((reason) => [reasonHash(reason).toLowerCase(), reason]),
);

/** Decodes a policy reason for display; unknown hashes stay as hex. */
export function reasonLabel(hash: Hex | string): string {
  return REASON_LABELS.get(String(hash).toLowerCase()) ?? String(hash);
}

export interface OnchainIntent {
  agentId: bigint;
  payee: Hex;
  amount: bigint;
  nameHash: Hex;
  metadataHash: Hex;
  expiresAt: bigint;
  createdBy: Hex;
  sessionEpoch: bigint;
  approved: boolean;
  executed: boolean;
}
