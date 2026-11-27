// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {PayeeGuard} from "../src/PayeeGuard.sol";

/// @notice Seeds four identities demonstrating the Payee Guard threat model:
///   1. "Northwind Trading Ltd"   - the legitimate payee (allowlisted below).
///   2. "Northwind Tradlng Ltd"   - a lookalike with a DIFFERENT registry wallet (never allowlisted).
///   3. an unregistered address    - logged only; it has no agentId and cannot be allowlisted.
///   4. a rotation case            - registered, then its agentWallet is rotated with an EIP-712
///                                  signature from the NEW wallet (an old intent would now fail
///                                  with PAYEE_CHANGED).
///   Finally allowlists #1 and creates a session for AGENT_ADDRESS.
///
/// Usage (local fork / anvil):
///   IDENTITY_REGISTRY=0x... PAYEE_GUARD=0x... forge script script/SeedIdentities.s.sol \
///     --rpc-url http://127.0.0.1:8555 --broadcast --unlocked --sender <deployer>
/// Private keys can be supplied with LEGIT_PRIVATE_KEY, LOOKALIKE_PRIVATE_KEY,
/// ROTATION_PRIVATE_KEY, ROTATION_NEW_PRIVATE_KEY, OWNER_PRIVATE_KEY and AGENT_ADDRESS.
/// On live chains private keys are mandatory: anvil's public keys are NEVER reused there.
contract SeedIdentities is Script {
    uint256 constant ANVIL_CHAIN = 31337;
    uint256 constant FORK_CHAIN = 440050;
    string constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

    // Non-anvil demo keys, used ONLY on local chains when no env key is supplied.
    uint256 constant DEMO_LEGIT_KEY = 0xfc325de396644b6411fb1c059c5d7cab159ef406927104dab67ffd49e0b05621;
    uint256 constant DEMO_LOOKALIKE_KEY = 0x8863aceac9ed81a35ade8631eb40e2ad6c7b16ff8756099330a1d4288db43e53;
    uint256 constant DEMO_ROTATION_KEY = 0xd8186d4530d07d4b2d8d8cfb927184fd821e2c43c937738a8096c2f23adbcda9;
    uint256 constant DEMO_ROTATION_NEW_KEY =
        0x85d886294b89ae5deeb9479fb19092dc8f0750a17351525877641865e16dc535;
    uint256 constant DEMO_AGENT_KEY = 0xfa4e6b86db6718dfae80acfa9c47fce7b677bdbc2e5391bcab4785e17f4f2b02;

    bytes32 constant WALLET_TYPEHASH =
        keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)");

    IdentityRegistry internal registry;
    PayeeGuard internal guard;
    bool internal local;
    uint256 internal legitId;
    uint256 internal lookalikeId;
    uint256 internal rotationId;
    address internal legitWallet;
    address internal lookalikeWallet;
    address internal rotationWallet;
    address internal newWallet;
    address internal unregistered;
    address internal agent;
    uint256 internal rotationKey;
    uint256 internal newKey;
    uint256 internal ownerKey;

    function run() external {
        address registryAddr = vm.envOr("IDENTITY_REGISTRY", address(0));
        address guardAddr = vm.envOr("PAYEE_GUARD", address(0));
        require(
            registryAddr != address(0) && guardAddr != address(0), "Set IDENTITY_REGISTRY and PAYEE_GUARD"
        );
        registry = IdentityRegistry(registryAddr);
        guard = PayeeGuard(guardAddr);
        local = block.chainid == ANVIL_CHAIN || block.chainid == FORK_CHAIN;

        uint256 legitKey = vm.envOr("LEGIT_PRIVATE_KEY", local ? DEMO_LEGIT_KEY : uint256(0));
        uint256 lookalikeKey = vm.envOr("LOOKALIKE_PRIVATE_KEY", local ? DEMO_LOOKALIKE_KEY : uint256(0));
        rotationKey = vm.envOr("ROTATION_PRIVATE_KEY", local ? DEMO_ROTATION_KEY : uint256(0));
        newKey = vm.envOr("ROTATION_NEW_PRIVATE_KEY", local ? DEMO_ROTATION_NEW_KEY : uint256(0));
        ownerKey = vm.envOr("OWNER_PRIVATE_KEY", uint256(0));

        if (!local) {
            require(
                legitKey != 0 && lookalikeKey != 0 && rotationKey != 0 && newKey != 0 && ownerKey != 0,
                "Live chains need all private keys in env"
            );
        }

        legitWallet = legitKey != 0 ? vm.addr(legitKey) : vm.envOr("LEGIT_WALLET", address(0));
        lookalikeWallet = lookalikeKey != 0 ? vm.addr(lookalikeKey) : vm.envOr("LOOKALIKE_WALLET", address(0));
        rotationWallet = rotationKey != 0 ? vm.addr(rotationKey) : vm.envOr("ROTATION_WALLET", address(0));
        newWallet = vm.addr(newKey);
        require(
            legitWallet != address(0) && lookalikeWallet != address(0) && rotationWallet != address(0),
            "Missing wallet"
        );
        if (!local) {
            require(
                !isAnvilAccount(legitWallet) && !isAnvilAccount(lookalikeWallet)
                    && !isAnvilAccount(rotationWallet) && !isAnvilAccount(newWallet),
                "Public anvil account on live chain"
            );
        }

        // 1. The legitimate payee.
        legitId = _register(legitKey, legitWallet, "ipfs://northwind-trading-legit.json");
        // 2. The lookalike: same-sounding name, different wallet, NEVER allowlisted.
        lookalikeId = _register(lookalikeKey, lookalikeWallet, "ipfs://northwind-tradlng-lookalike.json");
        // 3. An unregistered address: logged only, it has no agentId and cannot be allowlisted.
        unregistered = vm.envOr("UNREGISTERED_ADDRESS", vm.addr(DEMO_AGENT_KEY + 1));
        // 4. Rotation case, registered before the wallet change.
        rotationId = _register(rotationKey, rotationWallet, "ipfs://rotation-before.json");
        _rotateWallet();
        _configureGuard();

        console.log("IdentityRegistry", address(registry));
        console.log("PayeeGuard     ", address(guard));
        console.log("legit agentId  ", legitId, legitWallet);
        console.log("lookalike id   ", lookalikeId, lookalikeWallet);
        console.log("unregistered   ", unregistered);
        console.log("rotation id    ", rotationId, newWallet);
        console.log("allowlisted id ", legitId);
        console.log("session agent  ", agent);
    }

    function _rotateWallet() internal {
        uint256 deadline = block.timestamp + 240; // < 5 minute maximum
        bytes32 structHash =
            keccak256(abi.encode(WALLET_TYPEHASH, rotationId, newWallet, rotationWallet, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(newKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        _start(rotationKey, rotationWallet);
        registry.setAgentWallet(rotationId, newWallet, deadline, sig);
        vm.stopBroadcast();
    }

    function _configureGuard() internal {
        _start(ownerKey, guard.owner());
        guard.allowPayee(
            legitId,
            legitWallet,
            keccak256("Northwind Trading Ltd"),
            keccak256("ipfs://northwind-metadata.json")
        );

        agent = vm.envOr("AGENT_ADDRESS", address(0));
        if (agent == address(0)) {
            require(local, "Set AGENT_ADDRESS on live chains");
            agent = vm.addr(DEMO_AGENT_KEY);
        }
        if (!local) require(!isAnvilAccount(agent), "AGENT_ADDRESS is a public anvil account");
        guard.createSession(
            legitId,
            agent,
            20e6, // 20 tUSD8 per payment
            100e6, // 100 tUSD8 cumulative
            5e6, // auto-approve below 5 tUSD8
            uint64(block.timestamp),
            uint64(block.timestamp + 30 days)
        );
        vm.stopBroadcast();
    }

    function _register(uint256 key, address wallet, string memory uri) internal returns (uint256 agentId) {
        _start(key, wallet);
        agentId = registry.register(uri);
        vm.stopBroadcast();
    }

    function _start(uint256 key, address wallet) internal {
        if (key != 0) {
            if (!local) require(!isAnvilAccount(vm.addr(key)), "Public anvil key on live chain");
            vm.startBroadcast(key);
        } else {
            require(local, "Live chains need a private key");
            require(!isAnvilAccount(wallet), "Public anvil account");
            vm.startBroadcast(wallet); // impersonation on anvil / local fork only
        }
    }

    function isAnvilAccount(address a) internal pure returns (bool) {
        for (uint32 i = 0; i < 10; i++) {
            if (vm.addr(vm.deriveKey(ANVIL_MNEMONIC, i)) == a) return true;
        }
        return false;
    }
}
