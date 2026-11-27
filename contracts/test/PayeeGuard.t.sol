// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {PayeeGuard} from "../src/PayeeGuard.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";
import {FalseReturnToken, RevertingToken, ReentrantToken} from "../src/mocks/AdversarialTokens.sol";

contract PayeeGuardTest is Test {
    MockUSD8 token;
    IdentityRegistry registry;
    PayeeGuard guard;

    address owner = makeAddr("owner");
    address operator = makeAddr("operator");
    address payer = makeAddr("payer");
    address outsider = makeAddr("outsider");
    address agentWallet = makeAddr("agentWallet");
    address lookalikeWallet = makeAddr("lookalikeWallet");
    uint256 agentKey;
    address rotationWallet;
    uint256 rotationKey;

    uint256 constant AGENT_ID = 0;
    bytes32 constant NAME = keccak256("Northwind Trading Ltd");
    bytes32 constant META = keccak256("ipfs://northwind-metadata");
    uint256 constant MAX_PER = 20e6; // 20 tUSD8, 6 decimals
    uint256 constant MAX_CUM = 100e6;
    uint256 constant AUTO = 5e6;
    uint256 constant DEPOSIT = 1000e6;
    uint64 constant WINDOW = 30 days;

    bytes32 constant WALLET_TYPEHASH =
        keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)");

    // Expected reason codes mirror PayeeGuard's public constants.
    bytes32 constant NOT_AUTHORIZED = keccak256("NOT_AUTHORIZED");
    bytes32 constant NOT_ALLOWLISTED = keccak256("NOT_ALLOWLISTED");
    bytes32 constant NAME_HASH_MISMATCH = keccak256("NAME_HASH_MISMATCH");
    bytes32 constant METADATA_HASH_MISMATCH = keccak256("METADATA_HASH_MISMATCH");
    bytes32 constant PAYEE_CHANGED = keccak256("PAYEE_CHANGED");
    bytes32 constant APPROVAL_REQUIRED = keccak256("APPROVAL_REQUIRED");
    bytes32 constant ABOVE_PER_PAYMENT_CAP = keccak256("ABOVE_PER_PAYMENT_CAP");
    bytes32 constant ABOVE_CUMULATIVE_CAP = keccak256("ABOVE_CUMULATIVE_CAP");
    bytes32 constant SESSION_EXPIRED = keccak256("SESSION_EXPIRED");
    bytes32 constant SESSION_REVOKED = keccak256("SESSION_REVOKED");
    bytes32 constant INTENT_EXPIRED = keccak256("INTENT_EXPIRED");
    bytes32 constant INTENT_EXECUTED = keccak256("INTENT_EXECUTED");
    bytes32 constant ZERO_AMOUNT = keccak256("ZERO_AMOUNT");
    bytes32 constant INSUFFICIENT_BALANCE = keccak256("INSUFFICIENT_BALANCE");
    bytes32 constant PAUSED = keccak256("PAUSED");
    bytes32 constant WRONG_SESSION_EPOCH = keccak256("WRONG_SESSION_EPOCH");

    function setUp() public {
        (agentWallet, agentKey) = makeAddrAndKey("agentWallet");
        (rotationWallet, rotationKey) = makeAddrAndKey("rotationWallet");
        token = new MockUSD8();
        registry = new IdentityRegistry();
        guard = new PayeeGuard(IERC20(address(token)), owner);

        vm.prank(owner);
        guard.setRegistry(address(registry));

        vm.prank(agentWallet);
        assertEq(registry.register("ipfs://northwind"), AGENT_ID);
        vm.prank(lookalikeWallet);
        registry.register("ipfs://northwind-lookalike"); // agentId 1, different wallet

        vm.prank(owner);
        guard.allowPayee(AGENT_ID, agentWallet, NAME, META);
        _createSession(MAX_PER, MAX_CUM, AUTO, uint64(block.timestamp), uint64(block.timestamp + WINDOW));

        token.mint(owner, DEPOSIT);
        vm.startPrank(owner);
        token.approve(address(guard), DEPOSIT);
        guard.deposit(DEPOSIT);
        vm.stopPrank();
    }

    function _createSession(uint256 per, uint256 cum, uint256 auto_, uint64 validAfter_, uint64 expiresAt_)
        internal
    {
        vm.prank(owner);
        guard.createSession(AGENT_ID, operator, per, cum, auto_, validAfter_, expiresAt_);
    }

    function _propose(uint256 amount) internal returns (bytes32) {
        return _propose(amount, uint64(block.timestamp + 1 hours));
    }

    function _propose(uint256 amount, uint64 expiresAt) internal returns (bytes32) {
        vm.prank(operator);
        return guard.proposeIntent(AGENT_ID, amount, NAME, META, expiresAt);
    }

    function _expectViolation(bytes32 reason) internal {
        vm.expectRevert(abi.encodeWithSelector(PayeeGuard.PolicyViolation.selector, reason));
    }

    function _walletSig(uint256 agentId, address newWallet, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(WALLET_TYPEHASH, agentId, newWallet, registry.ownerOf(agentId), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(rotationKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---------------- happy path ----------------

    function test_autoApprove_execute_paysAllowlistedAgent() public {
        bytes32 id = _propose(AUTO);
        assertTrue(guard.intentOf(id).approved);
        assertEq(guard.intentOf(id).payee, agentWallet);

        vm.expectEmit(true, true, true, false, address(guard));
        emit PayeeGuard.PaymentSent(id, id, AGENT_ID, agentWallet, AUTO, operator);
        vm.prank(operator);
        guard.executeIntent(id);

        assertTrue(guard.intentOf(id).executed);
        assertEq(token.balanceOf(agentWallet), AUTO);
        assertEq(token.balanceOf(address(guard)), DEPOSIT - AUTO);
        assertEq(guard.sessionOf(AGENT_ID, operator).spent, AUTO);
    }

    function test_ownerApproval_thenAgentExecutes() public {
        uint256 amount = 10e6; // > AUTO, <= MAX_PER
        bytes32 id = _propose(amount);
        assertFalse(guard.intentOf(id).approved);

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        guard.approveIntent(id);

        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(guard));
        emit PayeeGuard.IntentApproved(id, owner);
        guard.approveIntent(id);

        vm.prank(operator);
        guard.executeIntent(id);
        assertEq(token.balanceOf(agentWallet), amount);
    }

    function test_ownerPath_skipsOnlyCaps() public {
        // Give the payee wallet a session too, so the owner-created intent is session-bound.
        vm.prank(owner);
        guard.createSession(
            AGENT_ID,
            agentWallet,
            MAX_PER,
            MAX_CUM,
            AUTO,
            uint64(block.timestamp),
            uint64(block.timestamp + WINDOW)
        );
        uint256 amount = 50e6; // above MAX_PER and above the auto-approve limit
        uint64 expiry = uint64(block.timestamp + 1 hours);

        uint256 nonce = guard.intentNonce();
        vm.prank(owner);
        guard.proposeIntent(AGENT_ID, amount, NAME, META, expiry);
        bytes32 id = _computeIntentId(owner, amount, expiry, nonce);
        assertTrue(guard.intentOf(id).approved);

        vm.prank(owner);
        guard.executeIntent(id);
        assertEq(token.balanceOf(agentWallet), amount);

        // The owner path skips caps ONLY: revoking the session still blocks the owner.
        nonce = guard.intentNonce();
        vm.prank(owner);
        guard.proposeIntent(AGENT_ID, amount, NAME, META, expiry);
        bytes32 id2 = _computeIntentId(owner, amount, expiry, nonce);
        vm.prank(owner);
        guard.revokeSession(AGENT_ID, agentWallet);
        vm.prank(owner);
        _expectViolation(SESSION_REVOKED);
        guard.executeIntent(id2);
    }

    function test_payeeCannotExecuteIntent() public {
        bytes32 id = _propose(AUTO);
        vm.prank(agentWallet);
        _expectViolation(NOT_AUTHORIZED);
        guard.executeIntent(id);
        vm.expectEmit(true, true, false, true, address(guard));
        emit PayeeGuard.PaymentRejected(id, agentWallet, NOT_AUTHORIZED);
        vm.prank(agentWallet);
        assertFalse(guard.tryExecuteIntent(id));
        assertFalse(guard.intentOf(id).executed);
        assertEq(token.balanceOf(agentWallet), 0);
    }

    // ---------------- every reason code ----------------

    function test_NOT_AUTHORIZED_proposeByStranger() public {
        vm.prank(outsider);
        _expectViolation(NOT_AUTHORIZED);
        guard.proposeIntent(AGENT_ID, AUTO, NAME, META, uint64(block.timestamp + 1 hours));
    }

    function test_NOT_AUTHORIZED_executeByStranger() public {
        bytes32 id = _propose(AUTO);
        vm.prank(outsider);
        _expectViolation(NOT_AUTHORIZED);
        guard.executeIntent(id);
    }

    function test_NOT_ALLOWLISTED_afterRevoke() public {
        bytes32 id = _propose(AUTO);
        vm.prank(owner);
        guard.revokePayee(AGENT_ID);

        vm.prank(operator);
        _expectViolation(NOT_ALLOWLISTED);
        guard.executeIntent(id);

        vm.prank(operator);
        _expectViolation(NOT_ALLOWLISTED);
        guard.proposeIntent(AGENT_ID, AUTO, NAME, META, uint64(block.timestamp + 1 hours));
    }

    function test_NAME_HASH_MISMATCH_atProposeAndAtExecution() public {
        vm.prank(operator);
        _expectViolation(NAME_HASH_MISMATCH);
        guard.proposeIntent(
            AGENT_ID, AUTO, keccak256("Northwind Tradlng Ltd"), META, uint64(block.timestamp + 1 hours)
        );

        bytes32 id = _propose(AUTO);
        vm.prank(owner);
        guard.allowPayee(AGENT_ID, agentWallet, keccak256("renamed"), META);
        vm.prank(operator);
        _expectViolation(NAME_HASH_MISMATCH);
        guard.executeIntent(id);
    }

    function test_METADATA_HASH_MISMATCH_atProposeAndAtExecution() public {
        vm.prank(operator);
        _expectViolation(METADATA_HASH_MISMATCH);
        guard.proposeIntent(AGENT_ID, AUTO, NAME, keccak256("ipfs://evil"), uint64(block.timestamp + 1 hours));

        bytes32 id = _propose(AUTO);
        vm.prank(owner);
        guard.allowPayee(AGENT_ID, agentWallet, NAME, keccak256("ipfs://new-metadata"));
        vm.prank(operator);
        _expectViolation(METADATA_HASH_MISMATCH);
        guard.executeIntent(id);
    }

    function test_PAYEE_CHANGED_toctouWalletRotation() public {
        bytes32 id = _propose(AUTO);
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _walletSig(AGENT_ID, rotationWallet, deadline);
        vm.prank(agentWallet);
        registry.setAgentWallet(AGENT_ID, rotationWallet, deadline, sig);
        assertEq(registry.getAgentWallet(AGENT_ID), rotationWallet);

        vm.prank(operator);
        _expectViolation(PAYEE_CHANGED);
        guard.executeIntent(id);

        vm.expectEmit(true, true, false, true, address(guard));
        emit PayeeGuard.PaymentRejected(id, operator, PAYEE_CHANGED);
        vm.prank(operator);
        assertFalse(guard.tryExecuteIntent(id));

        assertFalse(guard.intentOf(id).executed);
        assertEq(token.balanceOf(agentWallet), 0);
        assertEq(token.balanceOf(rotationWallet), 0);
        assertEq(token.balanceOf(address(guard)), DEPOSIT);
    }

    function test_PAYEE_CHANGED_whenWalletUnset() public {
        bytes32 id = _propose(AUTO);
        vm.prank(agentWallet);
        registry.unsetAgentWallet(AGENT_ID);
        vm.prank(operator);
        _expectViolation(PAYEE_CHANGED);
        guard.executeIntent(id);
    }

    function test_APPROVAL_REQUIRED() public {
        uint256 amount = 10e6;
        bytes32 id = _propose(amount);
        assertFalse(guard.intentOf(id).approved);
        vm.prank(operator);
        _expectViolation(APPROVAL_REQUIRED);
        guard.executeIntent(id);

        vm.expectEmit(true, true, false, true, address(guard));
        emit PayeeGuard.PaymentRejected(id, operator, APPROVAL_REQUIRED);
        vm.prank(operator);
        assertFalse(guard.tryExecuteIntent(id));
        assertFalse(guard.intentOf(id).executed);
        assertEq(token.balanceOf(agentWallet), 0);
    }

    function test_ABOVE_PER_PAYMENT_CAP() public {
        uint256 amount = MAX_PER + 1;
        bytes32 id = _propose(amount);
        vm.prank(owner);
        guard.approveIntent(id);
        vm.prank(operator);
        _expectViolation(ABOVE_PER_PAYMENT_CAP);
        guard.executeIntent(id);
    }

    function test_ABOVE_CUMULATIVE_CAP() public {
        _createSession(MAX_PER, 10e6, AUTO, uint64(block.timestamp), uint64(block.timestamp + WINDOW));
        uint256 spent;
        while (spent < 10e6) {
            bytes32 id = _propose(AUTO);
            vm.prank(operator);
            guard.executeIntent(id);
            spent += AUTO;
        }
        assertEq(guard.sessionOf(AGENT_ID, operator).spent, 10e6);

        bytes32 over = _propose(AUTO);
        vm.prank(operator);
        _expectViolation(ABOVE_CUMULATIVE_CAP);
        guard.executeIntent(over);
    }

    function test_SESSION_EXPIRED_afterExpiry() public {
        uint64 longExpiry = uint64(block.timestamp + 40 days);
        bytes32 id = _propose(AUTO, longExpiry);
        vm.warp(block.timestamp + WINDOW + 1 days);
        vm.prank(operator);
        _expectViolation(SESSION_EXPIRED);
        guard.executeIntent(id);
    }

    function test_SESSION_EXPIRED_beforeValidAfter() public {
        _createSession(
            MAX_PER, MAX_CUM, AUTO, uint64(block.timestamp + 1000), uint64(block.timestamp + WINDOW)
        );
        bytes32 id = _propose(AUTO);
        vm.prank(operator);
        _expectViolation(SESSION_EXPIRED);
        guard.executeIntent(id);
    }

    function test_SESSION_REVOKED() public {
        bytes32 id = _propose(AUTO);
        vm.prank(owner);
        guard.revokeSession(AGENT_ID, operator);

        vm.prank(operator);
        _expectViolation(SESSION_REVOKED);
        guard.executeIntent(id);

        vm.expectEmit(true, true, false, true, address(guard));
        emit PayeeGuard.PaymentRejected(id, operator, SESSION_REVOKED);
        vm.prank(operator);
        assertFalse(guard.tryExecuteIntent(id));
    }

    function test_INTENT_EXPIRED() public {
        bytes32 id = _propose(AUTO, uint64(block.timestamp + 100));
        vm.warp(block.timestamp + 101);
        vm.prank(operator);
        _expectViolation(INTENT_EXPIRED);
        guard.executeIntent(id);
    }

    function test_INTENT_EXECUTED_replay() public {
        bytes32 id = _propose(AUTO);
        vm.prank(operator);
        guard.executeIntent(id);

        vm.prank(operator);
        _expectViolation(INTENT_EXECUTED);
        guard.executeIntent(id);

        vm.expectEmit(true, true, false, true, address(guard));
        emit PayeeGuard.PaymentRejected(id, operator, INTENT_EXECUTED);
        vm.prank(operator);
        assertFalse(guard.tryExecuteIntent(id));
        assertEq(token.balanceOf(agentWallet), AUTO);
    }

    function test_ZERO_AMOUNT() public {
        vm.prank(operator);
        _expectViolation(ZERO_AMOUNT);
        guard.proposeIntent(AGENT_ID, 0, NAME, META, uint64(block.timestamp + 1 hours));
    }

    function test_INSUFFICIENT_BALANCE() public {
        vm.prank(owner);
        guard.withdraw(DEPOSIT);
        assertEq(token.balanceOf(address(guard)), 0);

        bytes32 id = _propose(AUTO);
        vm.prank(operator);
        _expectViolation(INSUFFICIENT_BALANCE);
        guard.executeIntent(id);

        vm.expectEmit(true, true, false, true, address(guard));
        emit PayeeGuard.PaymentRejected(id, operator, INSUFFICIENT_BALANCE);
        vm.prank(operator);
        assertFalse(guard.tryExecuteIntent(id));
    }

    function test_PAUSED() public {
        bytes32 id = _propose(AUTO);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(guard));
        emit Pausable.Paused(owner);
        guard.pause();

        vm.prank(operator);
        _expectViolation(PAUSED);
        guard.executeIntent(id);

        vm.expectEmit(true, true, false, true, address(guard));
        emit PayeeGuard.PaymentRejected(id, operator, PAUSED);
        vm.prank(operator);
        assertFalse(guard.tryExecuteIntent(id));

        vm.prank(owner);
        guard.unpause();
        vm.prank(operator);
        guard.executeIntent(id);
        assertEq(token.balanceOf(agentWallet), AUTO);
    }

    function test_WRONG_SESSION_EPOCH_afterRecreation() public {
        bytes32 id = _propose(AUTO);
        _createSession(MAX_PER, MAX_CUM, AUTO, uint64(block.timestamp), uint64(block.timestamp + WINDOW));

        vm.prank(operator);
        _expectViolation(WRONG_SESSION_EPOCH);
        guard.executeIntent(id);
    }

    // ---------------- session lifecycle ----------------

    function test_sessionRecreation_resetsSpentAndIncrementsEpoch() public {
        uint64 firstEpoch = guard.sessionOf(AGENT_ID, operator).epoch;
        assertEq(firstEpoch, 1);

        bytes32 id = _propose(AUTO);
        vm.prank(operator);
        guard.executeIntent(id);
        assertEq(guard.sessionOf(AGENT_ID, operator).spent, AUTO);

        _createSession(MAX_PER, MAX_CUM, AUTO, uint64(block.timestamp), uint64(block.timestamp + WINDOW));
        assertEq(guard.sessionOf(AGENT_ID, operator).epoch, firstEpoch + 1);
        assertEq(guard.sessionOf(AGENT_ID, operator).spent, 0);

        bytes32 id2 = _propose(AUTO);
        assertEq(guard.intentOf(id2).sessionEpoch, firstEpoch + 1);
        vm.prank(operator);
        guard.executeIntent(id2);
        assertEq(token.balanceOf(agentWallet), 2 * AUTO);
    }

    function test_cancel_isTerminal() public {
        bytes32 id = _propose(AUTO);
        vm.prank(owner);
        guard.cancelIntent(id);
        assertTrue(guard.intentOf(id).executed);

        vm.prank(operator);
        _expectViolation(INTENT_EXECUTED);
        guard.executeIntent(id);
        assertEq(token.balanceOf(agentWallet), 0);
    }

    // ---------------- admin ----------------

    function test_allowPayee_requiresRegistryWalletMatch() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                PayeeGuard.RegistryWalletMismatch.selector, 1, agentWallet, lookalikeWallet
            )
        );
        guard.allowPayee(1, agentWallet, keccak256("Northwind Tradlng Ltd"), keccak256("x"));

        vm.prank(owner);
        guard.allowPayee(1, lookalikeWallet, keccak256("Northwind Tradlng Ltd"), keccak256("x"));
        assertTrue(guard.payeeOf(1).allowed);
    }

    function test_setRegistry_andZeroAddressGuards() public {
        address newRegistry = makeAddr("newRegistry");
        vm.prank(owner);
        vm.expectEmit(true, true, false, false, address(guard));
        emit PayeeGuard.RegistryChanged(address(registry), newRegistry);
        guard.setRegistry(newRegistry);
        assertEq(address(guard.registry()), newRegistry);

        vm.prank(owner);
        vm.expectRevert(PayeeGuard.ZeroAddress.selector);
        guard.setRegistry(address(0));

        // Ownable's constructor rejects a zero owner before PayeeGuard's body runs.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new PayeeGuard(IERC20(address(token)), address(0));
        vm.expectRevert(PayeeGuard.ZeroAddress.selector);
        new PayeeGuard(IERC20(address(0)), owner);
    }

    function test_depositWithdraw_eventsAndAccounting() public {
        token.mint(owner, 7e6);
        vm.prank(owner);
        token.approve(address(guard), 7e6);
        vm.expectEmit(true, false, false, true, address(guard));
        emit PayeeGuard.Deposited(owner, 7e6, DEPOSIT + 7e6);
        vm.prank(owner);
        guard.deposit(7e6);

        vm.expectEmit(true, false, false, true, address(guard));
        emit PayeeGuard.Withdrawn(owner, 2e6, DEPOSIT + 5e6);
        vm.prank(owner);
        guard.withdraw(2e6);
        assertEq(token.balanceOf(address(guard)), DEPOSIT + 5e6);

        vm.expectEmit(true, false, false, true, address(guard));
        emit PayeeGuard.Withdrawn(payer, 1e6, DEPOSIT + 4e6);
        vm.prank(owner);
        guard.withdrawTo(payer, 1e6);
        assertEq(token.balanceOf(payer), 1e6);

        vm.prank(owner);
        _expectViolation(INSUFFICIENT_BALANCE);
        guard.withdraw(DEPOSIT + 6e6);
    }

    function test_onlyOwnerAdminFunctions() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        guard.allowPayee(AGENT_ID, agentWallet, NAME, META);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        guard.pause();
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        guard.withdraw(1);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        guard.withdrawTo(outsider, 1);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        guard.deposit(1);
    }

    function test_ownershipIsTwoStep() public {
        vm.prank(owner);
        guard.transferOwnership(outsider);
        assertEq(guard.owner(), owner);
        assertEq(guard.pendingOwner(), outsider);
        vm.prank(outsider);
        guard.acceptOwnership();
        assertEq(guard.owner(), outsider);
    }

    // ---------------- adversarial tokens ----------------

    function _deployWithToken(IERC20 t) internal returns (PayeeGuard g) {
        g = new PayeeGuard(t, owner);
        vm.prank(owner);
        g.setRegistry(address(registry));
        vm.prank(owner);
        g.allowPayee(AGENT_ID, agentWallet, NAME, META);
        vm.prank(owner);
        g.createSession(
            AGENT_ID,
            operator,
            MAX_PER,
            MAX_CUM,
            AUTO,
            uint64(block.timestamp),
            uint64(block.timestamp + WINDOW)
        );
    }

    function _proposeOn(PayeeGuard g, uint256 amount) internal returns (bytes32) {
        vm.prank(operator);
        return g.proposeIntent(AGENT_ID, amount, NAME, META, uint64(block.timestamp + 1 hours));
    }

    function test_falseReturningToken_revertsAndLeavesIntentUnpaid() public {
        FalseReturnToken t = new FalseReturnToken();
        PayeeGuard g = _deployWithToken(t);
        deal(address(t), address(g), 100e6);
        bytes32 id = _proposeOn(g, AUTO);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(t)));
        g.executeIntent(id);

        assertFalse(g.intentOf(id).executed);
        assertEq(g.sessionOf(AGENT_ID, operator).spent, 0);
        assertEq(t.balanceOf(agentWallet), 0);
        assertEq(t.balanceOf(address(g)), 100e6);
    }

    function test_revertingToken_propagatesRevertEvenInTry() public {
        RevertingToken t = new RevertingToken();
        PayeeGuard g = _deployWithToken(t);
        deal(address(t), address(g), 100e6);
        bytes32 id = _proposeOn(g, AUTO);

        vm.prank(operator);
        vm.expectRevert(RevertingToken.TokenPaused.selector);
        g.executeIntent(id);
        vm.prank(operator);
        vm.expectRevert(RevertingToken.TokenPaused.selector);
        g.tryExecuteIntent(id);
        assertFalse(g.intentOf(id).executed);
    }

    function test_reentrantToken_cannotPayTwice() public {
        ReentrantToken t = new ReentrantToken();
        PayeeGuard g = _deployWithToken(t);
        deal(address(t), address(g), 100e6);
        bytes32 first = _proposeOn(g, AUTO);
        bytes32 second = _proposeOn(g, AUTO);

        t.configure(address(g), second, false);
        vm.prank(operator);
        assertTrue(g.tryExecuteIntent(first));

        assertTrue(t.attempted());
        assertFalse(t.nestedSucceeded());
        assertEq(t.balanceOf(agentWallet), AUTO);
        assertFalse(g.intentOf(second).executed);
        assertEq(g.sessionOf(AGENT_ID, operator).spent, AUTO);
    }

    function test_reentrantToken_cannotReplaySameIntent() public {
        ReentrantToken t = new ReentrantToken();
        PayeeGuard g = _deployWithToken(t);
        deal(address(t), address(g), 100e6);
        bytes32 id = _proposeOn(g, AUTO);

        t.configure(address(g), id, true); // nested strict execute of the SAME intent
        vm.prank(operator);
        g.executeIntent(id);

        assertFalse(t.nestedSucceeded());
        assertEq(t.balanceOf(agentWallet), AUTO);
    }

    // ---------------- fuzz ----------------

    function testFuzz_depositWithdraw(uint96 depositAmount, uint96 withdrawAmount) public {
        uint256 d = bound(depositAmount, 1, 100e6);
        uint256 w = bound(withdrawAmount, 1, d);
        token.mint(owner, d);
        vm.startPrank(owner);
        token.approve(address(guard), d);
        guard.deposit(d);
        vm.stopPrank();
        vm.prank(owner);
        guard.withdraw(w);
        assertEq(token.balanceOf(address(guard)), DEPOSIT + d - w);
    }

    function testFuzz_paymentRespectsCaps(uint64 amount) public {
        uint256 a = bound(amount, 1, MAX_PER);
        bytes32 id = _propose(a);
        if (a > AUTO) {
            vm.prank(owner);
            guard.approveIntent(id);
        }
        vm.prank(operator);
        guard.executeIntent(id);
        assertEq(token.balanceOf(agentWallet), a);
        assertLe(guard.sessionOf(AGENT_ID, operator).spent, MAX_CUM);
    }

    // ---------------- helpers ----------------

    function _computeIntentId(address caller, uint256 amount, uint64 expiry, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(address(guard), AGENT_ID, caller, amount, NAME, META, expiry, nonce));
    }
}
