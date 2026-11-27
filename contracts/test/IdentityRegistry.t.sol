// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {IERC8004Identity} from "../src/interfaces/IERC8004Identity.sol";
import {MockERC1271Wallet} from "../src/mocks/AdversarialTokens.sol";

contract IdentityRegistryTest is Test {
    IdentityRegistry registry;
    address alice;
    uint256 aliceKey;
    address bob;
    uint256 bobKey;
    address operator = makeAddr("operator");

    bytes32 constant TYPEHASH =
        keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)");

    function setUp() public {
        registry = new IdentityRegistry();
        (alice, aliceKey) = makeAddrAndKey("alice");
        (bob, bobKey) = makeAddrAndKey("bob");
    }

    function _walletSignature(uint256 agentId, address newWallet, uint256 deadline, uint256 signerKey)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(TYPEHASH, agentId, newWallet, registry.ownerOf(agentId), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_register_isZeroIndexedAndStoresRegistrantWallet() public {
        vm.prank(alice);
        vm.expectEmit(true, false, true, true, address(registry));
        emit IERC8004Identity.Registered(0, "ipfs://alice", alice);
        uint256 id = registry.register("ipfs://alice");
        assertEq(id, 0);

        vm.prank(bob);
        uint256 id2 = registry.register("ipfs://bob");
        assertEq(id2, 1);

        assertEq(registry.getAgentWallet(0), alice);
        assertEq(registry.getAgentWallet(1), bob);
        assertEq(registry.ownerOf(0), alice);
        assertEq(registry.tokenURI(0), "ipfs://alice");
    }

    function test_register_emptyAndNoArgOverloads() public {
        vm.prank(alice);
        assertEq(registry.register(), 0);
        assertEq(registry.tokenURI(0), "");
        vm.prank(alice);
        assertEq(registry.register(""), 1);
    }

    function test_setAgentURI_byOwnerAndByApprovedOperator() public {
        vm.prank(alice);
        registry.register("ipfs://old");

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(registry));
        emit IERC8004Identity.URIUpdated(0, "ipfs://new", alice);
        registry.setAgentURI(0, "ipfs://new");
        assertEq(registry.tokenURI(0), "ipfs://new");

        vm.prank(alice);
        registry.approve(operator, 0);
        vm.prank(operator);
        registry.setAgentURI(0, "ipfs://operator");
        assertEq(registry.tokenURI(0), "ipfs://operator");

        vm.prank(bob);
        vm.expectRevert(IdentityRegistry.NotAuthorized.selector);
        registry.setAgentURI(0, "ipfs://hijack");
    }

    function test_metadata_reservedWalletKeyCannotBeSet() public {
        vm.prank(alice);
        registry.register("ipfs://alice");

        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.ReservedKey.selector);
        registry.setMetadata(0, "agentWallet", abi.encodePacked(bob));

        bytes[] memory values = new bytes[](1);
        values[0] = abi.encodePacked(bob);
        IdentityRegistry.MetadataEntry[] memory entries = new IdentityRegistry.MetadataEntry[](1);
        entries[0] = IdentityRegistry.MetadataEntry({metadataKey: "agentWallet", metadataValue: values[0]});
        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.ReservedKey.selector);
        registry.register("ipfs://again", entries);
    }

    function test_metadata_setAndRead() public {
        vm.prank(alice);
        registry.register("ipfs://alice");

        IdentityRegistry.MetadataEntry[] memory entries = new IdentityRegistry.MetadataEntry[](1);
        entries[0] =
            IdentityRegistry.MetadataEntry({metadataKey: "description", metadataValue: bytes("hello")});
        vm.prank(alice);
        uint256 id = registry.register("ipfs://second", entries);
        assertEq(id, 1);
        assertEq(registry.getMetadata(1, "description"), bytes("hello"));

        vm.prank(alice);
        registry.setMetadata(1, "description", bytes("bye"));
        assertEq(registry.getMetadata(1, "description"), bytes("bye"));
    }

    function test_setAgentWallet_eoaSignature() public {
        vm.prank(alice);
        registry.register("ipfs://alice");
        vm.prank(bob);
        uint256 id = registry.register("ipfs://bob"); // id 1, owner bob

        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _walletSignature(id, alice, deadline, aliceKey);
        vm.prank(bob);
        vm.expectEmit(true, false, false, true, address(registry));
        emit IdentityRegistry.MetadataSet(1, "agentWallet", "agentWallet", abi.encodePacked(alice));
        registry.setAgentWallet(id, alice, deadline, sig);
        assertEq(registry.getAgentWallet(id), alice);
        assertEq(registry.getMetadata(id, "agentWallet"), abi.encodePacked(alice));
    }

    function test_setAgentWallet_erc1271Signature() public {
        vm.prank(alice);
        registry.register("ipfs://alice");

        MockERC1271Wallet wallet = new MockERC1271Wallet();
        uint256 deadline = block.timestamp + 60;
        bytes32 structHash = keccak256(abi.encode(TYPEHASH, 0, address(wallet), alice, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
        wallet.configure(true, digest);

        vm.prank(alice);
        registry.setAgentWallet(0, address(wallet), deadline, hex"1234");
        assertEq(registry.getAgentWallet(0), address(wallet));
    }

    function test_setAgentWallet_rejectsBadSignatureWrongOwnerAndBounds() public {
        vm.prank(alice);
        registry.register("ipfs://alice");

        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _walletSignature(0, bob, deadline, bobKey);

        vm.prank(bob);
        vm.expectRevert(IdentityRegistry.NotAuthorized.selector);
        registry.setAgentWallet(0, bob, deadline, sig);

        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.BadWallet.selector);
        registry.setAgentWallet(0, address(0), deadline, sig);

        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.DeadlineTooFar.selector);
        registry.setAgentWallet(0, bob, block.timestamp + 301, sig);

        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.Expired.selector);
        registry.setAgentWallet(0, bob, block.timestamp - 1, sig);

        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.InvalidWalletSignature.selector);
        registry.setAgentWallet(0, bob, deadline, hex"deadbeef");
    }

    function test_transferClearsWallet() public {
        vm.prank(alice);
        registry.register("ipfs://alice");
        assertEq(registry.getAgentWallet(0), alice);

        vm.prank(alice);
        registry.transferFrom(alice, bob, 0);
        assertEq(registry.getAgentWallet(0), address(0));

        // The old owner's empty signature cannot re-verify the now-cleared wallet.
        vm.prank(bob);
        vm.expectRevert(IdentityRegistry.InvalidWalletSignature.selector);
        registry.setAgentWallet(0, bob, block.timestamp + 60, hex"");
    }

    function test_unsetAgentWallet() public {
        vm.prank(alice);
        registry.register("ipfs://alice");
        vm.prank(alice);
        registry.unsetAgentWallet(0);
        assertEq(registry.getAgentWallet(0), address(0));
    }

    function test_domainSeparator_isPinnedToEip712NameAndVersion() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("ERC8004IdentityRegistry"),
                keccak256("1"),
                block.chainid,
                address(registry)
            )
        );
        assertEq(registry.domainSeparator(), expected);
    }
}
