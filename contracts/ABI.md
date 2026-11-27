# Payee Guard — authoritative ABI reference

This document is the single source of truth for the contract surface on branch
`feat/payee-guard-contracts` (commit that follows PR #3 review). All signatures below are the
**exact** final Solidity signatures; use them verbatim in scripts, the agent and the UI.
Solidity `^0.8.24`, EVM `shanghai`, OpenZeppelin 5.1.

Sources: `src/PayeeGuard.sol`, `src/IdentityRegistry.sol`, `src/interfaces/IERC8004Identity.sol`.

---

## 1. PayeeGuard

`constructor(IERC20 token_, address initialOwner_)`
(the token is immutable; the owner is set via `Ownable2Step`).

### Structs

```solidity
struct Payee {
    address wallet;
    bytes32 nameHash;
    bytes32 metadataHash;
    bool allowed;
}

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

struct Intent {
    uint256 agentId;
    address payee;
    uint256 amount;
    bytes32 nameHash;
    bytes32 metadataHash;
    uint64 expiresAt;
    address createdBy;
    uint64 sessionEpoch;
    bool approved;
    bool executed;
}
```

### Owner-only state changes

```solidity
function setRegistry(address registry_) external onlyOwner;
function allowPayee(uint256 agentId, address wallet, bytes32 nameHash, bytes32 metadataHash) external onlyOwner;
function revokePayee(uint256 agentId) external onlyOwner;
function deposit(uint256 amount) external onlyOwner nonReentrant returns (uint256 balance);
function withdraw(uint256 amount) external onlyOwner nonReentrant returns (uint256 balance);
function withdrawTo(address to, uint256 amount) external onlyOwner nonReentrant returns (uint256 balance);
function createSession(
    uint256 agentId,
    address operator,
    uint256 maxPerPayment,
    uint256 maxCumulative,
    uint256 autoApproveLimit,
    uint64 validAfter,
    uint64 expiresAt
) external onlyOwner returns (uint64 epoch);
function revokeSession(uint256 agentId, address operator) external onlyOwner;
function approveIntent(bytes32 intentId) external onlyOwner;
function cancelIntent(bytes32 intentId) external onlyOwner;
function pause() external onlyOwner;
function unpause() external onlyOwner;
```

- `deposit` is **owner-only**: the owner must approve the vault on the token first.
- `withdraw(uint256)` sends to `owner()`. `withdrawTo(address,uint256)` is the explicit-recipient
  variant. Both revert with `PolicyViolation(INSUFFICIENT_BALANCE)` if the vault has too little.
- `allowPayee` reverts with `RegistryWalletMismatch(agentId, expected, actual)` unless
  `registry.getAgentWallet(agentId) == wallet` at call time.
- `createSession` increments `epoch` and resets `spent` on every call. `revokeSession` only sets
  `revoked = true` (epoch unchanged). `cancelIntent` is terminal: it sets `executed = true`.

### Agent (session operator) / owner intents

```solidity
function proposeIntent(
    uint256 agentId,
    uint256 amount,
    bytes32 nameHash,
    bytes32 metadataHash,
    uint64 expiresAt
) external returns (bytes32 intentId);

function executeIntent(bytes32 intentId) external nonReentrant;
function tryExecuteIntent(bytes32 intentId) external nonReentrant returns (bool success);
```

`proposeIntent` derives `payee` **only** from `payees[agentId].wallet`; callers cannot pass a payee.
It is callable by the operator of an existing session for `(agentId, msg.sender)`, or by the owner.
It auto-approves when `amount <= session.autoApproveLimit`, or when the caller is the owner.

`intentId` is deterministic and can be precomputed before sending the transaction:

```solidity
intentId = keccak256(abi.encode(
    address(payeeGuard), agentId, msg.sender, amount, nameHash, metadataHash, expiresAt, intentNonce
));
```

Read `intentNonce()` on-chain first; the value increments after every proposal. `IntentProposed`
also emits the id. `paymentRef` on `PaymentSent` is this same `intentId`.

### Views / getters

```solidity
function sessionKey(uint256 agentId, address operator) public pure returns (bytes32);
function sessionOf(uint256 agentId, address operator) external view returns (Session memory);
function payeeOf(uint256 agentId) external view returns (Payee memory);
function intentOf(bytes32 intentId) external view returns (Intent memory);
function policyReason(bytes32 intentId) external view returns (bytes32);
function token() external view returns (address);      // immutable tUSD8
function registry() external view returns (address);
function intentNonce() external view returns (uint256);
function paused() external view returns (bool);
function owner() external view returns (address);
function pendingOwner() external view returns (address);
```

**Sessions are keyed by `sessionKey(agentId, operator)` = `keccak256(abi.encode(agentId, operator))`.**
Use `sessionOf(agentId, operator)` for the decoded struct; the raw public mapping getter
`sessions(bytes32 key)` returns an unnamed tuple
`(maxPerPayment, maxCumulative, spent, autoApproveLimit, validAfter, expiresAt, epoch, revoked)`.
Likewise `payeeOf(agentId)` / `intentOf(intentId)` are the named alternatives to the raw
`payees(uint256)` / `intents(bytes32)` getters.

`policyReason(intentId)` returns `bytes32(0)` if `msg.sender` may execute now, otherwise the
reason code it would be rejected with (see §5).

### Inherited owner API

```solidity
function transferOwnership(address newOwner) public onlyOwner;   // two-step
function acceptOwnership() public;                                // pending owner
function renounceOwnership() public onlyOwner;
```

---

## 2. PayeeGuard events (exact definitions)

```solidity
event PayeeAllowed(uint256 indexed agentId, address indexed wallet, bytes32 nameHash, bytes32 metadataHash);
event PayeeRevoked(uint256 indexed agentId, address indexed wallet);
event Deposited(address indexed depositor, uint256 amount, uint256 balance);
event Withdrawn(address indexed to, uint256 amount, uint256 balance);
event SessionCreated(
    uint256 indexed agentId,
    address indexed operator,
    bytes32 indexed key,
    uint64 epoch,
    uint256 maxPerPayment,
    uint256 maxCumulative,
    uint256 autoApproveLimit,
    uint64 validAfter,
    uint64 expiresAt
);
event SessionRevoked(uint256 indexed agentId, address indexed operator, bytes32 indexed key, uint64 epoch);
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
event IntentApproved(bytes32 indexed intentId, address indexed approver);
event IntentCancelled(bytes32 indexed intentId, address indexed canceller);
event PaymentSent(
    bytes32 indexed intentId,
    bytes32 indexed paymentRef,
    uint256 indexed agentId,
    address payee,
    uint256 amount,
    address caller
);
event PaymentRejected(bytes32 indexed intentId, address indexed caller, bytes32 reason);
event RegistryChanged(address indexed oldRegistry, address indexed newRegistry);
event Paused(address account);     // inherited from Pausable
event Unpaused(address account);   // inherited from Pausable
event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
```

`PaymentRejected` is emitted **only** by `tryExecuteIntent` on a policy failure; no funds move and
`executed` stays `false`. `PaymentSent` is emitted immediately before the token transfer, after
`executed = true` and after `spent += amount`.

---

## 3. PayeeGuard errors

```solidity
error PolicyViolation(bytes32 reason);
error ZeroAddress();
error ZeroAmount();
error InvalidSessionWindow();
error RegistryNotSet();
error RegistryWalletMismatch(uint256 agentId, address expected, address actual);
error EnforcedPause();                       // from Pausable
error ExpectedPause();                       // from Pausable
error ReentrancyGuardReentrantCall();        // from ReentrancyGuard
error OwnableUnauthorizedAccount(address account);
error OwnableInvalidOwner(address owner);
error SafeERC20FailedOperation(address token);
```

All policy failures use `PolicyViolation(reason)` with one of the codes below.

---

## 4. Execution rules (owner vs agent)

- **Who may execute:** the vault **owner**, or `intent.createdBy` — i.e. the operator whose
  session was active when the intent was proposed. The **payee/recipient may NOT execute**
  (`NOT_AUTHORIZED`); it is never a settlement trigger. This holds for both `executeIntent` and
  `tryExecuteIntent`.
- **Epoch:** the session for the intent must still have `session.epoch == intent.sessionEpoch`.
  `createSession` increments the epoch, so old intents fail with `WRONG_SESSION_EPOCH`.
- **Owner path:** the owner skips **only** the per-payment and cumulative cap checks. Every other
  check (pause, expiry, approval, allowlist, registry wallet, name/metadata hashes, session epoch,
  revocation and time window, vault balance) still applies.
- **Agent path:** all checks including `maxPerPayment` and `maxCumulative - spent` apply.
- An intent proposed by the owner with no session for `(agentId, payee)` (`sessionEpoch == 0`)
  has no session constraints; all non-session checks still apply.
- `executed == true` means terminal (paid, or cancelled). Replay returns `INTENT_EXECUTED`.
- `tryExecuteIntent` converts policy failures into `PaymentRejected` + `false`; token-level
  failures (token pause/blacklist/revert/`false` return) still revert the whole transaction and
  are **not** policy reasons.

---

## 5. Policy reason codes (all 16, exact bytes32 values)

`keccak256` of the uppercase name:

| Constant | Value |
| --- | --- |
| `NOT_AUTHORIZED` | `0xe7e213d5e2bee0acc2c7bf8bfda19ef0cae82e7b8c997e7e898919269971e7c4` |
| `NOT_ALLOWLISTED` | `0x1850a47a00772def98f93dae29c73b9ff8c7ac1653d1f2c20606d5565fdfbe2e` |
| `NAME_HASH_MISMATCH` | `0x4da399060f1f3b9f4225e8dc56e432b022f83f7b95e7d0473962b821760e9a6c` |
| `METADATA_HASH_MISMATCH` | `0x0cdde48170feb0141288f078eebb2de06051b395bae24fda0ec83305802b688c` |
| `PAYEE_CHANGED` | `0xbffcfe741f337ff6f5376a59603b4b0bcd589954e3b2d8b77e311b6afafe1190` |
| `APPROVAL_REQUIRED` | `0xc760a28021878428f4aec66089d704b9a343f0a14df5bc0f42ebe63fceff4591` |
| `ABOVE_PER_PAYMENT_CAP` | `0x22422587cd2d91205ad456db9bec08d33c72c754a92ac55ac600ac5e0ac9d0d8` |
| `ABOVE_CUMULATIVE_CAP` | `0x1bce1e4602f832671bbc0d73f715deb11cf9c936fc311dea575fcce7ea732a05` |
| `SESSION_EXPIRED` | `0x821bb5df17dfaa1e2938b6ccc123a5cbe99b133def3e078f06d9808c2c7774d6` |
| `SESSION_REVOKED` | `0xe161ec6793316e751cf76c1ff3eded3d1e650935cb695cbb531ce718b819b709` |
| `INTENT_EXPIRED` | `0x4752b8d42d00f4e137975b24e63494cdd238a221f1f6ef673d2388ac7cc7cfa5` |
| `INTENT_EXECUTED` | `0x0601df54beefee1f4e0b17e96d49adf207c7e35913660f6c05500e81be255094` |
| `ZERO_AMOUNT` | `0xad8e292265788ac5c19f708ed96612bf3229f5fbdf9e1b9b3466c3f5a1b60243` |
| `INSUFFICIENT_BALANCE` | `0x153c6a82d06260899a3190a7f053b8e53b5844ee1a57108f9b35d4e78ccddb58` |
| `PAUSED` | `0x03d87756d0359861a8ed751161c405747027362fc6301ef3fdd73959fc4cb597` |
| `WRONG_SESSION_EPOCH` | `0xe936c8c0306de6538341c0d1052151ec8c261d4542dcd449555a900c88802591` |

Check order in `_policyReason`: `PAUSED` → nonexistent intent (`NOT_AUTHORIZED`) →
`INTENT_EXECUTED` → `INTENT_EXPIRED` → caller authorization → `APPROVAL_REQUIRED` →
`NOT_ALLOWLISTED` → `PAYEE_CHANGED` → `NAME_HASH_MISMATCH` → `METADATA_HASH_MISMATCH` →
`ZERO_AMOUNT` → session checks (`WRONG_SESSION_EPOCH` → `SESSION_REVOKED` → `SESSION_EXPIRED`
→ caps for non-owner) → `INSUFFICIENT_BALANCE`.

---

## 6. IERC8004Identity (interface used by PayeeGuard)

```solidity
interface IERC8004Identity {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function setAgentURI(uint256 agentId, string calldata newURI) external;
    function ownerOf(uint256 agentId) external view returns (address owner);
    function getAgentWallet(uint256 agentId) external view returns (address wallet);
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
    function tokenURI(uint256 agentId) external view returns (string memory);

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
}
```

---

## 7. IdentityRegistry (self-deployed, non-upgradeable)

`constructor()` — no arguments, no proxy/initializer; `forge create` is enough.

```solidity
struct MetadataEntry { string metadataKey; bytes metadataValue; }

function register() external returns (uint256 agentId);
function register(string calldata agentURI) external returns (uint256 agentId);
function register(string calldata agentURI, MetadataEntry[] calldata metadata) external returns (uint256 agentId);
function setAgentURI(uint256 agentId, string calldata newURI) external;
function tokenURI(uint256 agentId) public view returns (string memory);
function ownerOf(uint256 agentId) public view returns (address owner);
function getMetadata(uint256 agentId, string calldata metadataKey) external view returns (bytes memory);
function setMetadata(uint256 agentId, string calldata metadataKey, bytes calldata metadataValue) external;
function getAgentWallet(uint256 agentId) external view returns (address wallet);
function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
function unsetAgentWallet(uint256 agentId) external;
function domainSeparator() external view returns (bytes32);
function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
```

Plus the standard ERC-721 surface (`balanceOf`, `transferFrom`, `safeTransferFrom`, `approve`,
`setApprovalForAll`, `isApprovedForAll`, `getApproved`, `supportsInterface`, ...).

```solidity
event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
event MetadataSet(
    uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue
);
event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

error ReservedKey();
error NotAuthorized();
error BadWallet();
error Expired();
error DeadlineTooFar();
error InvalidWalletSignature();
```

Agent ids are **0-indexed**. `register` sets the reserved `agentWallet` metadata key to
`msg.sender`. `setAgentWallet` requires owner/approved caller, `newWallet != 0`,
`block.timestamp <= deadline <= block.timestamp + 5 minutes`, and a signature from `newWallet`
verified by `SignatureChecker` (ECDSA for EOAs, ERC-1271 magic value `0x1626ba7e` for contracts):

- EIP-712 domain: `name = "ERC8004IdentityRegistry"`, `version = "1"`.
- Typehash: `keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)")`.
- `structHash = keccak256(abi.encode(TYPEHASH, agentId, newWallet, owner, deadline))`.

Transferring the NFT clears `agentWallet`; the new owner must re-verify it.
