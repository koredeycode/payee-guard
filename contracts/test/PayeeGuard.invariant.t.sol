// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PayeeGuard} from "../src/PayeeGuard.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";

/// @notice With no payments in play, vault token balance must equal deposits minus withdrawals.
contract VaultAccountingHandler {
    MockUSD8 public immutable token;
    PayeeGuard public immutable guard;
    uint256 public accounted;

    constructor(MockUSD8 token_, PayeeGuard guard_) {
        token = token_;
        guard = guard_;
        token_.approve(address(guard_), type(uint256).max);
    }

    function doDeposit(uint256 amount) external {
        uint256 a = _bound(amount, 1, 10e6);
        token.mint(address(this), a);
        guard.deposit(a);
        accounted += a;
    }

    function doWithdraw(uint256 amount) external {
        uint256 a = _bound(amount, 1, 10e6);
        if (a <= token.balanceOf(address(guard))) {
            guard.withdraw(address(this), a);
            accounted -= a;
        }
    }

    function _bound(uint256 value, uint256 low, uint256 high) private pure returns (uint256) {
        if (value < low) return low;
        if (value > high) return high;
        return value;
    }
}

contract VaultAccountingInvariant is Test {
    MockUSD8 token;
    PayeeGuard guard;
    VaultAccountingHandler handler;
    address owner = makeAddr("owner");

    function setUp() public {
        token = new MockUSD8();
        guard = new PayeeGuard(IERC20(address(token)), owner);
        handler = new VaultAccountingHandler(token, guard);
        targetContract(address(handler));
    }

    function invariant_balanceEqualsDepositsMinusWithdrawals() public view {
        assertEq(token.balanceOf(address(guard)), handler.accounted());
    }
}

/// @notice Session `spent` only ever increases, never exceeds the cumulative cap, and every
///         successful payment is backed by a real token balance change.
contract SpendHandler {
    MockUSD8 public immutable token;
    PayeeGuard public immutable guard;
    uint256 public immutable agentId;
    bytes32 public immutable nameHash;
    bytes32 public immutable metaHash;
    bytes32 public immutable key;

    uint256 public maxSpentSeen;
    uint256 public payments;

    constructor(MockUSD8 token_, PayeeGuard guard_, uint256 agentId_, bytes32 nameHash_, bytes32 metaHash_) {
        token = token_;
        guard = guard_;
        agentId = agentId_;
        nameHash = nameHash_;
        metaHash = metaHash_;
        key = guard_.sessionKey(agentId_, address(this));
        token_.approve(address(guard_), type(uint256).max);
    }

    function doPay(uint256 seed) external {
        uint256 amount = 1 + (seed % 5e6);
        token.mint(address(this), amount);
        guard.deposit(amount);
        bytes32 intentId =
            guard.proposeIntent(agentId, amount, nameHash, metaHash, uint64(block.timestamp + 1000));
        guard.executeIntent(intentId);
        payments += 1;
        uint256 spent = guard.sessionOf(agentId, address(this)).spent;
        if (spent > maxSpentSeen) maxSpentSeen = spent;
    }
}

contract SpentMonotonicityInvariant is Test {
    MockUSD8 token;
    IdentityRegistry registry;
    PayeeGuard guard;
    SpendHandler handler;
    address owner = makeAddr("owner");
    address payee = makeAddr("payee");
    bytes32 constant NAME = keccak256("Northwind Trading Ltd");
    bytes32 constant META = keccak256("ipfs://northwind-metadata");
    uint256 constant CAP = 100_000e6;

    function setUp() public {
        token = new MockUSD8();
        registry = new IdentityRegistry();
        guard = new PayeeGuard(IERC20(address(token)), owner);
        vm.prank(owner);
        guard.setRegistry(address(registry));
        vm.prank(payee);
        registry.register("ipfs://northwind");
        vm.prank(owner);
        guard.allowPayee(0, payee, NAME, META);
        handler = new SpendHandler(token, guard, 0, NAME, META);
        vm.prank(owner);
        guard.createSession(
            0, address(handler), 5e6, CAP, 5e6, uint64(block.timestamp), uint64(block.timestamp + 30 days)
        );
        targetContract(address(handler));
    }

    function invariant_spentIsMonotonicAndCapped() public view {
        uint256 spent = guard.sessionOf(0, address(handler)).spent;
        assertEq(spent, handler.maxSpentSeen(), "spent must never decrease");
        assertLe(spent, CAP, "session cap must hold");
        assertEq(token.balanceOf(payee), spent, "every payment must move real tokens");
    }
}
