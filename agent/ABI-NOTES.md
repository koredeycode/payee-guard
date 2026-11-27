# ABI notes: demo fixtures → real contracts

Demo mode (`MCP_DEMO=1` or `LLM_PROVIDER=mock`) is unchanged: identities, policy, intent
ids and receipts come from `fixtures/*.json` and a fixed clock. The table below maps each
demo concept to the live contract call used in `agent/lib/tools.ts`. Live mode never
enumerates agents by name or address: the only identifier is a **uint256 `agentId`**.

| Demo value | Live source |
|---|---|
| `agentId` (`"acme-treasury"`) | numeric `agentId` supplied by the caller, parsed as `uint256` |
| payee `address` | `PayeeGuard.payees(agentId).wallet`; re-checked against `IdentityRegistry.getAgentWallet(agentId)` at resolution **and** execution (`PAYEE_CHANGED` if unequal) |
| `name` / `nameDiff` | `payees(agentId).nameHash` compared with `keccak256(utf8(NFKC(name).trim()))`; the contract exposes hashes, not a name string, so the diff says so explicitly |
| `metadataHash` | `payees(agentId).metadataHash` (demo computes it from stable identity fields) |
| `active` / allowlist | `payees(agentId).allowed` (`NOT_ALLOWLISTED` if false); there is no `isAllowed(address)` function |
| trust tier `verified` | allowed payee whose two wallet lookups agree |
| `policy.maxAutoApprove` | `sessionOf(agentId, operator).autoApproveLimit`; hard cap `maxPerPayment` has no demo equivalent |
| session validity | `sessionOf(agentId, operator).validAfter`, `expiresAt`, `epoch`, `revoked`, `spent`, `maxCumulative` |
| intent expiration | `expiresAt` argument of `proposeIntent`, taken from the session expiry or now + 1 hour |
| deterministic demo `intentId` | exact `IntentProposed` log parsed from the `proposeIntent` transaction receipt (`args.intentId`); receipts do not return values |
| owner approval flag | `approveIntent(intentId)` signed by the owner key, only for an intent the owner listed in `OWNER_APPROVED_INTENTS` |
| execute / demo hash | `tryExecuteIntent(intentId)` signed by the agent operator key; `PaymentSent` is the receipt, `PaymentRejected` carries a `bytes32` reason |
| `get_receipts()` | exact `PaymentSent` logs from `PAYMENT_CONTRACT_ADDRESS`, read in 1,000-block chunks over the last 100,000 blocks |

## Contract fragments used

```solidity
// IdentityRegistry.sol (PAYEE_REGISTRY_ADDRESS)
function getAgentWallet(uint256 agentId) external view returns (address wallet);

// PayeeGuard.sol (PAYMENT_CONTRACT_ADDRESS)
function payees(uint256 agentId) external view returns (
    address wallet, bytes32 nameHash, bytes32 metadataHash, bool allowed);
function sessionKey(uint256 agentId, address operator) external pure returns (bytes32 key);
function sessionOf(uint256 agentId, address operator) external view returns (Session memory);
function sessions(bytes32 key) external view returns (Session); // alternative to sessionOf
function intents(bytes32 intentId) external view returns (
    uint256 agentId, address payee, uint256 amount, bytes32 nameHash,
    bytes32 metadataHash, uint64 expiresAt, address createdBy,
    uint64 sessionEpoch, bool approved, bool executed);
function proposeIntent(uint256 agentId, uint256 amount, bytes32 nameHash,
    bytes32 metadataHash, uint64 expiresAt) external returns (bytes32 intentId);
function approveIntent(bytes32 intentId) external;
function executeIntent(bytes32 intentId) external;
function tryExecuteIntent(bytes32 intentId) external returns (bool);

struct Session {
    uint256 maxPerPayment;
    uint256 maxCumulative;
    uint256 spent;
    uint256 autoApproveLimit;
    uint64 validAfter;
    uint64 expiresAt;
    uint64 epoch;
    bool revoked;
}

// Exact topic0 signatures (shorter fragments would never match a deployed log):
event IntentProposed(
    bytes32 indexed intentId,
    uint256 indexed agentId,
    address indexed payee,
    uint256 amount,
    bytes32 nameHash,
    bytes32 metadataHash,
    uint64 expiresAt,
    address createdBy,
    uint64 sessionEpoch,
    bool approved
);
event PaymentSent(
    bytes32 indexed intentId,
    bytes32 indexed paymentRef,
    uint256 indexed agentId,
    address payee,
    uint256 amount,
    address caller
);
event PaymentRejected(bytes32 indexed intentId, address indexed caller, bytes32 reason);
```

Sessions are keyed by `sessionKey(uint256 agentId, address operator)`, **not** by an
address. Live reads use `sessionOf(agentId, operator)` with the `uint256` agentId and the
public agent operator address; `epoch == 0` means no session exists and limits fail closed
(auto-approval `0`). `intentIdFromReceipt` uses the exact `IntentProposed` fragment, so viem
matches topic0 precisely and decodes `args.intentId`. If no such log is present, proposal
returns `INTENT_ID_NOT_FOUND` rather than inventing an id. `getReceipts` uses the exact
`PaymentSent` fragment (including `paymentRef` and `caller`), so log filtering returns the
real receipts.

## Required environment for live mode

| Variable | Meaning |
|---|---|
| `MCP_DEMO=0`, `LLM_PROVIDER=openai-compatible` | Selects live mode (`MCP_DEMO=1` or the default mock provider always stays offline) |
| `PAYEE_REGISTRY_ADDRESS` | Deployed `IdentityRegistry` with `getAgentWallet(uint256)` |
| `PAYMENT_CONTRACT_ADDRESS` | Deployed `PayeeGuard` with the functions/events above |
| `AGENT_OPERATOR_ADDRESS` | **Public** address of the agent's operator; combined with the `uint256` agentId in `sessionOf(agentId, operator)`. Missing/inactive/revoked session ⇒ auto-approval limit `0` (fail closed) |
| `AGENT_PRIVATE_KEY` | Gas-only operator key; read only to sign `proposeIntent` / `tryExecuteIntent` |
| `OWNER_PRIVATE_KEY` | Read only to sign `approveIntent` for an intent explicitly listed in `OWNER_APPROVED_INTENTS` |

There is no `SESSION_KEY_ADDRESS` variable and no `sessions(address)` call. No separate
policy contract address is used: limits and allowlisting live in `PayeeGuard.sessionOf`
and `PayeeGuard.payees`. An LLM-supplied address is never used as a payee.
