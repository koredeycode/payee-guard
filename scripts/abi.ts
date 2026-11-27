import { parseAbi, parseAbiItem, type AbiEvent } from "viem";

/**
 * Minimal ABI Payee Guard scripts rely on.
 *
 * These scripts deliberately carry their own ABI: they must run before the
 * contracts have been compiled, and the public RPC cannot serve artifacts.
 * Keep this in sync with `contracts/src/PayeeGuard.sol`; the event argument
 * names are what `read-events` and `verify-submission` decode and compare.
 */
export const guardAbi = parseAbi([
  "function pay(uint256 agentId, address payee, uint256 amount, bytes32 intentId, string note)",
  "function configure(uint256 agentId, uint256 perPaymentCap, uint256 autoApproveLimit, address payee, bool allowed)",
  "function approveIntent(bytes32 intentId)",
  "function setSession(uint256 agentId, address sessionWallet, bool active)",
  "function rotateAgentWallet(uint256 agentId, address newWallet)",
  "function isSessionActive(uint256 agentId, address sessionWallet) view returns (bool)",
  "function intentState(bytes32 intentId) view returns (bool approved, bool used)",
  "function paymentCaps(uint256 agentId) view returns (uint256 perPayment, uint256 autoApprove)",
  "function payeeAllowed(uint256 agentId, address payee) view returns (bool)",
  "event PaymentSent(uint256 indexed agentId, address indexed payee, uint256 amount, bytes32 indexed intentId)",
  "event PaymentRejected(uint256 indexed agentId, address indexed payee, uint256 amount, bytes32 indexed intentId, string reason)",
]);

export const paymentSentEvent = parseAbiItem(
  "event PaymentSent(uint256 indexed agentId, address indexed payee, uint256 amount, bytes32 indexed intentId)",
) as AbiEvent;

export const paymentRejectedEvent = parseAbiItem(
  "event PaymentRejected(uint256 indexed agentId, address indexed payee, uint256 amount, bytes32 indexed intentId, string reason)",
) as AbiEvent;

/** ERC-8004 Identity Registry (https://eips.ethereum.org/EIPS/eip-8004). */
export const registryAbi = parseAbi([
  "function register(string agentURI, (string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)",
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address owner)",
  "function tokenURI(uint256 tokenId) view returns (string)",
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
