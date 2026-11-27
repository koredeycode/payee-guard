import { isAddress, parseAbi, type Address } from "viem";

/**
 * Exact ABI of PayeeGuard.sol from the contracts slice. Function names, argument types and
 * event fields mirror the deployed contract. Event topic0 covers every field below, so the
 * events are declared in full and never truncated for display.
 */
export const payeeGuardAbi = parseAbi([
  // owner administration
  "function allowPayee(uint256 agentId, address wallet, bytes32 nameHash, bytes32 metadataHash)",
  "function revokePayee(uint256 agentId)",
  "function deposit(uint256 amount) returns (uint256 balance)",
  "function withdraw(uint256 amount) returns (uint256 balance)",
  "function withdrawTo(address to, uint256 amount) returns (uint256 balance)",
  "function createSession(uint256 agentId, address operator, uint256 maxPerPayment, uint256 maxCumulative, uint256 autoApproveLimit, uint64 validAfter, uint64 expiresAt) returns (uint64 epoch)",
  "function revokeSession(uint256 agentId, address operator)",
  "function approveIntent(bytes32 intentId)",
  "function cancelIntent(bytes32 intentId)",
  "function pause()",
  "function unpause()",
  // intents
  "function proposeIntent(uint256 agentId, uint256 amount, bytes32 nameHash, bytes32 metadataHash, uint64 expiresAt) returns (bytes32 intentId)",
  "function executeIntent(bytes32 intentId)",
  "function tryExecuteIntent(bytes32 intentId) returns (bool success)",
  // views
  "function paused() view returns (bool)",
  "function sessionKey(uint256 agentId, address operator) pure returns (bytes32)",
  "function payeeOf(uint256 agentId) view returns (address wallet, bytes32 nameHash, bytes32 metadataHash, bool allowed)",
  "function sessionOf(uint256 agentId, address operator) view returns (uint256 maxPerPayment, uint256 maxCumulative, uint256 spent, uint256 autoApproveLimit, uint64 validAfter, uint64 expiresAt, uint64 epoch, bool revoked)",
  "function intentOf(bytes32 intentId) view returns (uint256 agentId, address payee, uint256 amount, bytes32 nameHash, bytes32 metadataHash, uint64 expiresAt, address createdBy, uint64 sessionEpoch, bool approved, bool executed)",
  "function policyReason(bytes32 intentId) view returns (bytes32 reason)",
  "function intentNonce() view returns (uint256)",
  "function owner() view returns (address)",
  // events, with every field that contributes to topic0
  "event PayeeAllowed(uint256 indexed agentId, address indexed wallet, bytes32 nameHash, bytes32 metadataHash)",
  "event PayeeRevoked(uint256 indexed agentId, address indexed wallet)",
  "event Deposited(address indexed depositor, uint256 amount, uint256 balance)",
  "event Withdrawn(address indexed to, uint256 amount, uint256 balance)",
  "event SessionCreated(uint256 indexed agentId, address indexed operator, bytes32 indexed key, uint64 epoch, uint256 maxPerPayment, uint256 maxCumulative, uint256 autoApproveLimit, uint64 validAfter, uint64 expiresAt)",
  "event SessionRevoked(uint256 indexed agentId, address indexed operator, bytes32 indexed key, uint64 epoch)",
  "event IntentProposed(bytes32 indexed intentId, uint256 indexed agentId, address indexed payee, uint256 amount, bytes32 nameHash, bytes32 metadataHash, uint64 expiresAt, address createdBy, uint64 sessionEpoch, bool approved)",
  "event IntentApproved(bytes32 indexed intentId, address indexed approver)",
  "event IntentCancelled(bytes32 indexed intentId, address indexed canceller)",
  "event PaymentSent(bytes32 indexed intentId, bytes32 indexed paymentRef, uint256 indexed agentId, address payee, uint256 amount, address caller)",
  "event PaymentRejected(bytes32 indexed intentId, address indexed caller, bytes32 reason)",
  "event RegistryChanged(address indexed oldRegistry, address indexed newRegistry)",
]);

/** Set NEXT_PUBLIC_PAYEE_GUARD_AEVUM to a deployed address to leave demo mode. */
export const guardAddress: Address | undefined = (() => {
  const raw = process.env.NEXT_PUBLIC_PAYEE_GUARD_AEVUM?.trim();
  return raw && isAddress(raw) ? raw : undefined;
})();

export const guardDemoMode = !guardAddress;
export const GUARD_CHAIN_ID = 44005;
export const TUSD8_DECIMALS = 6;
