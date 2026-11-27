// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC8004Identity} from "./interfaces/IERC8004Identity.sol";

/// @title PayeeGuard
/// @notice A stablecoin vault that only pays an ERC-8004 allowlisted payee through a policy
///         checked intent. The intended recipient is derived from the registry, never from
///         the caller, so lookalike names and wallet rotations cannot redirect a payment.
/// @dev Token-level failures (a paused token, a blacklist, a revert, a `false` return) are
///      NOT policy reasons: they bubble up from SafeERC20 and revert the whole transaction.
///      Policy failures are the bytes32 reasons below and revert with `PolicyViolation`, or
///      are returned as `false` with `PaymentRejected` by `tryExecuteIntent`.
contract PayeeGuard is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ---------------- policy reason codes ----------------
    bytes32 public constant NOT_AUTHORIZED = keccak256("NOT_AUTHORIZED");
    bytes32 public constant NOT_ALLOWLISTED = keccak256("NOT_ALLOWLISTED");
    bytes32 public constant NAME_HASH_MISMATCH = keccak256("NAME_HASH_MISMATCH");
    bytes32 public constant METADATA_HASH_MISMATCH = keccak256("METADATA_HASH_MISMATCH");
    bytes32 public constant PAYEE_CHANGED = keccak256("PAYEE_CHANGED");
    bytes32 public constant APPROVAL_REQUIRED = keccak256("APPROVAL_REQUIRED");
    bytes32 public constant ABOVE_PER_PAYMENT_CAP = keccak256("ABOVE_PER_PAYMENT_CAP");
    bytes32 public constant ABOVE_CUMULATIVE_CAP = keccak256("ABOVE_CUMULATIVE_CAP");
    bytes32 public constant SESSION_EXPIRED = keccak256("SESSION_EXPIRED");
    bytes32 public constant SESSION_REVOKED = keccak256("SESSION_REVOKED");
    bytes32 public constant INTENT_EXPIRED = keccak256("INTENT_EXPIRED");
    bytes32 public constant INTENT_EXECUTED = keccak256("INTENT_EXECUTED");
    bytes32 public constant ZERO_AMOUNT = keccak256("ZERO_AMOUNT");
    bytes32 public constant INSUFFICIENT_BALANCE = keccak256("INSUFFICIENT_BALANCE");
    bytes32 public constant PAUSED = keccak256("PAUSED");
    bytes32 public constant WRONG_SESSION_EPOCH = keccak256("WRONG_SESSION_EPOCH");

    error PolicyViolation(bytes32 reason);
    error ZeroAddress();
    error ZeroAmount();
    error InvalidSessionWindow();
    error RegistryNotSet();
    error RegistryWalletMismatch(uint256 agentId, address expected, address actual);

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

    IERC20 public immutable token;
    IERC8004Identity public registry;
    uint256 public intentNonce;

    mapping(uint256 => Payee) public payees;
    mapping(bytes32 => Session) public sessions;
    mapping(bytes32 => Intent) public intents;

    event PayeeAllowed(
        uint256 indexed agentId, address indexed wallet, bytes32 nameHash, bytes32 metadataHash
    );
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
    event SessionRevoked(
        uint256 indexed agentId, address indexed operator, bytes32 indexed key, uint64 epoch
    );
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

    constructor(IERC20 token_, address initialOwner_) Ownable(initialOwner_) {
        if (address(token_) == address(0) || initialOwner_ == address(0)) revert ZeroAddress();
        token = token_;
    }

    // ---------------- owner administration ----------------

    function setRegistry(address registry_) external onlyOwner {
        if (registry_ == address(0)) revert ZeroAddress();
        address oldRegistry = address(registry);
        registry = IERC8004Identity(registry_);
        emit RegistryChanged(oldRegistry, registry_);
    }

    /// @notice Allowlist an agent's current registry wallet. The wallet is never accepted
    ///         from the caller: it must equal `registry.getAgentWallet(agentId)` right now.
    function allowPayee(uint256 agentId, address wallet, bytes32 nameHash, bytes32 metadataHash)
        external
        onlyOwner
    {
        if (address(registry) == address(0)) revert RegistryNotSet();
        address registryWallet = registry.getAgentWallet(agentId);
        if (wallet == address(0) || registryWallet != wallet) {
            revert RegistryWalletMismatch(agentId, wallet, registryWallet);
        }
        payees[agentId] =
            Payee({wallet: wallet, nameHash: nameHash, metadataHash: metadataHash, allowed: true});
        emit PayeeAllowed(agentId, wallet, nameHash, metadataHash);
    }

    function revokePayee(uint256 agentId) external onlyOwner {
        Payee storage p = payees[agentId];
        p.allowed = false;
        emit PayeeRevoked(agentId, p.wallet);
    }

    /// @notice Fund the vault with the immutable token. Only the owner may fund it.
    function deposit(uint256 amount) external onlyOwner nonReentrant returns (uint256 balance) {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        balance = token.balanceOf(address(this));
        emit Deposited(msg.sender, amount, balance);
    }

    /// @notice Withdraw to the owner. Pausing the vault does not trap the owner's funds.
    function withdraw(uint256 amount) external onlyOwner nonReentrant returns (uint256 balance) {
        return _withdraw(owner(), amount);
    }

    /// @notice Withdraw to an explicit recipient (owner only).
    function withdrawTo(address to, uint256 amount)
        external
        onlyOwner
        nonReentrant
        returns (uint256 balance)
    {
        return _withdraw(to, amount);
    }

    function _withdraw(address to, uint256 amount) private returns (uint256 balance) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 available = token.balanceOf(address(this));
        if (amount > available) revert PolicyViolation(INSUFFICIENT_BALANCE);
        token.safeTransfer(to, amount);
        balance = token.balanceOf(address(this));
        emit Withdrawn(to, amount, balance);
    }

    /// @notice Create (or recreate) a session for an agent/operator pair. Each call resets
    ///         `spent` and increments `epoch`, invalidating intents from the old session.
    function createSession(
        uint256 agentId,
        address operator,
        uint256 maxPerPayment,
        uint256 maxCumulative,
        uint256 autoApproveLimit,
        uint64 validAfter,
        uint64 expiresAt
    ) external onlyOwner returns (uint64 epoch) {
        if (operator == address(0)) revert ZeroAddress();
        if (validAfter >= expiresAt) revert InvalidSessionWindow();
        bytes32 key = sessionKey(agentId, operator);
        Session storage s = sessions[key];
        epoch = s.epoch + 1;
        s.maxPerPayment = maxPerPayment;
        s.maxCumulative = maxCumulative;
        s.spent = 0;
        s.autoApproveLimit = autoApproveLimit;
        s.validAfter = validAfter;
        s.expiresAt = expiresAt;
        s.epoch = epoch;
        s.revoked = false;
        emit SessionCreated(
            agentId,
            operator,
            key,
            epoch,
            maxPerPayment,
            maxCumulative,
            autoApproveLimit,
            validAfter,
            expiresAt
        );
    }

    /// @notice Revoke a session without rotating its epoch (so old intents report SESSION_REVOKED).
    function revokeSession(uint256 agentId, address operator) external onlyOwner {
        bytes32 key = sessionKey(agentId, operator);
        Session storage s = sessions[key];
        s.revoked = true;
        emit SessionRevoked(agentId, operator, key, s.epoch);
    }

    function approveIntent(bytes32 intentId) external onlyOwner {
        Intent storage i = intents[intentId];
        if (i.createdBy == address(0) || i.executed) revert PolicyViolation(INTENT_EXECUTED);
        i.approved = true;
        emit IntentApproved(intentId, msg.sender);
    }

    /// @notice Permanently close an intent. Cancelled intents are terminal and report
    ///         INTENT_EXECUTED if someone later tries to execute them.
    function cancelIntent(bytes32 intentId) external onlyOwner {
        Intent storage i = intents[intentId];
        if (i.createdBy == address(0) || i.executed) revert PolicyViolation(INTENT_EXECUTED);
        i.approved = false;
        i.executed = true;
        emit IntentCancelled(intentId, msg.sender);
    }

    /// @dev `Paused` / `Unpaused` come from OpenZeppelin's Pausable.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------- agent / owner intents ----------------

    /// @notice Propose a payment. `payee` comes only from the allowlist entry for `agentId`.
    /// @dev Callable by the session operator for `(agentId, msg.sender)` or by the owner.
    ///      Small payments (amount <= that session's autoApproveLimit) and owner proposals
    ///      are approved immediately; everything else needs `approveIntent`.
    function proposeIntent(
        uint256 agentId,
        uint256 amount,
        bytes32 nameHash,
        bytes32 metadataHash,
        uint64 expiresAt
    ) external returns (bytes32 intentId) {
        Payee storage p = payees[agentId];
        if (!p.allowed) revert PolicyViolation(NOT_ALLOWLISTED);
        if (nameHash != p.nameHash) revert PolicyViolation(NAME_HASH_MISMATCH);
        if (metadataHash != p.metadataHash) revert PolicyViolation(METADATA_HASH_MISMATCH);
        if (amount == 0) revert PolicyViolation(ZERO_AMOUNT);

        bool ownerCaller = msg.sender == owner();
        address operator = ownerCaller ? p.wallet : msg.sender;
        Session storage s = sessions[sessionKey(agentId, operator)];
        if (!ownerCaller && s.epoch == 0) revert PolicyViolation(NOT_AUTHORIZED);

        intentId = keccak256(
            abi.encode(
                address(this), agentId, msg.sender, amount, nameHash, metadataHash, expiresAt, intentNonce
            )
        );
        intentNonce++;

        bool approved = ownerCaller || amount <= s.autoApproveLimit;
        intents[intentId] = Intent({
            agentId: agentId,
            payee: p.wallet,
            amount: amount,
            nameHash: nameHash,
            metadataHash: metadataHash,
            expiresAt: expiresAt,
            createdBy: msg.sender,
            sessionEpoch: s.epoch,
            approved: approved,
            executed: false
        });
        emit IntentProposed(
            intentId,
            agentId,
            p.wallet,
            amount,
            nameHash,
            metadataHash,
            expiresAt,
            msg.sender,
            s.epoch,
            approved
        );
    }

    /// @notice Execute an approved intent, strictly reverting on any policy violation.
    function executeIntent(bytes32 intentId) external nonReentrant {
        bytes32 reason = _policyReason(intentId);
        if (reason != bytes32(0)) revert PolicyViolation(reason);
        _settle(intentId);
    }

    /// @notice Same policy checks as `executeIntent`, but policy failures are reported as
    ///         `PaymentRejected` and return false instead of reverting. Token failures still
    ///         revert (a paused/blacklisted/reverting token is never swallowed).
    function tryExecuteIntent(bytes32 intentId) external nonReentrant returns (bool success) {
        bytes32 reason = _policyReason(intentId);
        if (reason != bytes32(0)) {
            emit PaymentRejected(intentId, msg.sender, reason);
            return false;
        }
        _settle(intentId);
        return true;
    }

    // ---------------- views ----------------

    function sessionKey(uint256 agentId, address operator) public pure returns (bytes32) {
        return keccak256(abi.encode(agentId, operator));
    }

    /// @notice Named struct getters (the public mapping getters return unnamed tuples).
    function payeeOf(uint256 agentId) external view returns (Payee memory) {
        return payees[agentId];
    }

    function sessionOf(uint256 agentId, address operator) external view returns (Session memory) {
        return sessions[sessionKey(agentId, operator)];
    }

    function intentOf(bytes32 intentId) external view returns (Intent memory) {
        return intents[intentId];
    }

    /// @notice Return the reason code that blocks `intentId` for `msg.sender`, or bytes32(0).
    ///         Exposed so clients can simulate a rejection before submitting a transaction.
    function policyReason(bytes32 intentId) external view returns (bytes32) {
        return _policyReason(intentId);
    }

    // ---------------- internals ----------------

    function _settle(bytes32 intentId) private {
        Intent storage i = intents[intentId];
        // Effects before interactions: replay/reentrancy is impossible even with a hostile token.
        i.executed = true;
        Session storage s = sessions[_sessionKeyForIntent(i)];
        s.spent += i.amount;
        emit PaymentSent(intentId, intentId, i.agentId, i.payee, i.amount, msg.sender);
        token.safeTransfer(i.payee, i.amount);
    }

    function _sessionKeyForIntent(Intent storage i) private view returns (bytes32) {
        // Owner-proposed intents use the payee wallet as their operator; agent intents use
        // their creator. Ownership may change, so an old owner's intent falls back to its creator.
        address operator = i.createdBy == owner() ? i.payee : i.createdBy;
        return sessionKey(i.agentId, operator);
    }

    function _policyReason(bytes32 intentId) internal view returns (bytes32) {
        if (paused()) return PAUSED;

        Intent storage i = intents[intentId];
        if (i.createdBy == address(0)) return NOT_AUTHORIZED;
        if (i.executed) return INTENT_EXECUTED;
        if (block.timestamp > i.expiresAt) return INTENT_EXPIRED;

        // Only the creating session (its operator) at the same epoch, or the owner, may settle.
        // The recipient(payee) is deliberately NOT authorized to trigger settlement.
        bool ownerCaller = msg.sender == owner();
        if (!ownerCaller && msg.sender != i.createdBy) return NOT_AUTHORIZED;
        if (!i.approved) return APPROVAL_REQUIRED;

        Payee storage p = payees[i.agentId];
        if (!p.allowed) return NOT_ALLOWLISTED;
        if (address(registry) == address(0)) return NOT_ALLOWLISTED;
        // TOCTOU protection: the registry wallet may have rotated after the intent was proposed.
        if (registry.getAgentWallet(i.agentId) != i.payee || p.wallet != i.payee) return PAYEE_CHANGED;
        if (i.nameHash != p.nameHash) return NAME_HASH_MISMATCH;
        if (i.metadataHash != p.metadataHash) return METADATA_HASH_MISMATCH;
        if (i.amount == 0) return ZERO_AMOUNT;

        // epoch == 0 means the intent was proposed with no session (the owner path).
        // Such an intent has no session constraints to check; all non-session checks still apply.
        if (i.sessionEpoch != 0) {
            Session storage s = sessions[_sessionKeyForIntent(i)];
            if (s.epoch != i.sessionEpoch) return WRONG_SESSION_EPOCH;
            if (s.revoked) return SESSION_REVOKED;
            if (block.timestamp < s.validAfter || block.timestamp > s.expiresAt) return SESSION_EXPIRED;

            // The owner path skips caps only; every other check above and below still applies.
            if (!ownerCaller) {
                if (i.amount > s.maxPerPayment) return ABOVE_PER_PAYMENT_CAP;
                if (s.spent + i.amount > s.maxCumulative) return ABOVE_CUMULATIVE_CAP;
            }
        }
        if (token.balanceOf(address(this)) < i.amount) return INSUFFICIENT_BALANCE;
        return bytes32(0);
    }
}
