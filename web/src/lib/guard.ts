import { isAddress, parseAbi, type Address } from "viem";

/**
 * Interface the console expects from PayeeGuard. Swap this for the deployed ABI once the
 * contract address is available; the function names follow the owner actions in the UI.
 */
export const payeeGuardAbi = parseAbi([
  "function allowlistPayee(string name, address payee, string domain, bytes32 nameHash, bytes32 metadataHash)",
  "function createSession(string agentId, address wallet, uint256 perPaymentCap, uint256 totalCap, uint256 expiresAt)",
  "function rotateSession(string agentId, address newWallet)",
  "function revokeSession(string agentId)",
  "function approveIntent(bytes32 intentId)",
  "function cancelIntent(bytes32 intentId)",
  "function setPaused(bool paused)",
  "function withdraw(address to, uint256 amount)",
  "function paused() view returns (bool)",
  "function isAllowlisted(bytes32 nameHash) view returns (bool)",
  "function sessionOf(string agentId) view returns ((address wallet, uint256 perPaymentCap, uint256 totalCap, uint256 expiresAt, bool revoked))",
  "event PayeeAllowlisted(bytes32 indexed nameHash, address indexed payee, string name)",
  "event SessionCreated(string indexed agentId, address wallet)",
  "event IntentApproved(bytes32 indexed intentId)",
  "event IntentRejected(bytes32 indexed intentId, uint8 reasonCode)",
]);

/** Set NEXT_PUBLIC_PAYEE_GUARD_AEVUM to a deployed address to leave demo mode. */
export const guardAddress: Address | undefined = (() => {
  const raw = process.env.NEXT_PUBLIC_PAYEE_GUARD_AEVUM?.trim();
  return raw && isAddress(raw) ? raw : undefined;
})();

export const guardDemoMode = !guardAddress;
export const GUARD_CHAIN_ID = 44005;
export const TUSD8_DECIMALS = 6;
