// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Checkout} from "../../src/Checkout.sol";
import {IdentityRegistry} from "../../src/IdentityRegistry.sol";
import {PayeeGuard} from "../../src/PayeeGuard.sol";
import {Signing} from "../Signing.sol";

interface ITUSD8 is IERC20 {
    function decimals() external view returns (uint8);

    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function authorizationState(address, bytes32) external view returns (bool);
}

/// @notice Runs contracts against the REAL tUSD8 on a local fork of Aevum testnet. No funds needed:
///         `deal` writes a balance into the fork only.
///         Run with: make test-fork   (or: forge test --match-path 'test/fork/*' --fork-url aevum --evm-version shanghai)
contract AevumForkTest is Test {
    ITUSD8 constant TUSD8 = ITUSD8(0x456569838f1d43009A91ebA4263147Afd7233483);
    uint256 constant CHAIN_ID = 44005;

    function _assertChain() internal view {
        assertEq(block.chainid, CHAIN_ID, "run with --fork-url aevum");
    }

    function test_realTusd8_domain() public view {
        _assertChain();
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("tUSD8"),
                keccak256("2"),
                uint256(CHAIN_ID),
                address(TUSD8)
            )
        );
        assertEq(TUSD8.DOMAIN_SEPARATOR(), expected);
    }

    function test_realTusd8_hasSixDecimals() public view {
        _assertChain();
        assertEq(TUSD8.decimals(), 6);
    }

    function test_realTusd8_payWithAuthorization() public {
        _assertChain();
        address merchant = makeAddr("merchant");
        (address buyer, uint256 key) = makeAddrAndKey("buyer");
        Checkout checkout = new Checkout(TUSD8, merchant);
        deal(address(TUSD8), buyer, 10e6);

        bytes32 orderId = keccak256("fork-order");
        uint256 deadline = block.timestamp + 1 hours;
        Signing.Auth memory a = Signing.Auth({
            from: buyer,
            to: address(checkout),
            value: 5e6,
            validAfter: 0,
            validBefore: deadline,
            nonce: checkout.authorizationNonce(orderId)
        });
        (uint8 v, bytes32 r, bytes32 s) = Signing.signReceive(vm, key, TUSD8.DOMAIN_SEPARATOR(), a);

        vm.prank(makeAddr("relayer"));
        checkout.payWithAuthorization(orderId, buyer, 5e6, 0, deadline, v, r, s);

        assertEq(TUSD8.balanceOf(merchant), 5e6);
        assertEq(TUSD8.balanceOf(buyer), 5e6);
        assertTrue(TUSD8.authorizationState(buyer, checkout.authorizationNonce(orderId)));
    }

    function test_realTusd8_approveAndPay() public {
        _assertChain();
        address merchant = makeAddr("merchant");
        address buyer = makeAddr("buyer");
        Checkout checkout = new Checkout(TUSD8, merchant);
        deal(address(TUSD8), buyer, 10e6);

        vm.startPrank(buyer);
        TUSD8.approve(address(checkout), 3e6);
        checkout.pay(keccak256("fork-order-2"), 3e6);
        vm.stopPrank();

        assertEq(TUSD8.balanceOf(merchant), 3e6);
    }

    function test_payeeGuard_realTusd8_endToEnd() public {
        _assertChain();
        address payee = makeAddr("fork-payee");
        address operator = makeAddr("fork-operator");
        address payer = makeAddr("fork-payer");

        IdentityRegistry registry = new IdentityRegistry();
        PayeeGuard guard = new PayeeGuard(TUSD8, address(this));
        guard.setRegistry(address(registry));

        vm.prank(payee);
        uint256 agentId = registry.register("ipfs://northwind-fork");
        bytes32 nameHash = keccak256("Northwind Trading Ltd");
        bytes32 metaHash = keccak256("ipfs://northwind-metadata");
        guard.allowPayee(agentId, payee, nameHash, metaHash);
        guard.createSession(
            agentId, operator, 20e6, 100e6, 5e6, uint64(block.timestamp), uint64(block.timestamp + 1 days)
        );

        deal(address(TUSD8), payer, 10e6); // 10 tUSD8 (6 decimals), fork-only balance write
        vm.startPrank(payer);
        TUSD8.approve(address(guard), 5e6);
        guard.deposit(5e6);
        vm.stopPrank();

        vm.prank(operator);
        bytes32 intentId =
            guard.proposeIntent(agentId, 5e6, nameHash, metaHash, uint64(block.timestamp + 1 hours));
        vm.prank(operator);
        guard.executeIntent(intentId);

        assertEq(TUSD8.balanceOf(payee), 5e6);
        assertEq(TUSD8.balanceOf(address(guard)), 0);
        assertEq(guard.sessionOf(agentId, operator).spent, 5e6);
        assertTrue(guard.intentOf(intentId).executed);
    }

    function test_payeeGuard_registryDomainUsesForkChainId() public {
        _assertChain();
        IdentityRegistry registry = new IdentityRegistry();
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("ERC8004IdentityRegistry"),
                keccak256("1"),
                uint256(CHAIN_ID),
                address(registry)
            )
        );
        assertEq(registry.domainSeparator(), expected);
    }
}
