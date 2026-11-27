// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC8004Identity} from "./interfaces/IERC8004Identity.sol";

/// @title IdentityRegistry
/// @notice Self-deployed, non-upgradeable ERC-8004 Identity Registry for agent discovery.
/// @dev Non-upgradeable adaptation of the ERC-8004 reference implementation
///      https://github.com/erc-8004/erc-8004-contracts at commit f2afbb0a7f4a8136c9a66ec55f252b8a68f70776
///      ("change Uri to URI"), ported from OpenZeppelin upgradeable contracts to plain
///      ERC721URIStorage / EIP712 / SignatureChecker on OpenZeppelin 5.1.
///      No proxy, no initializer: `forge create` is enough to deploy it.
///      Differences from the reference, all required for this deployment:
///        - agent ids are 0-indexed (the first registration is agentId 0);
///        - `register` reserves the `agentWallet` key and sets it to msg.sender;
///        - signature verification uses SignatureChecker (ECDSA recovery for EOAs and
///          ERC-1271 `isValidSignature` returning 0x1626ba7e for contract wallets).
contract IdentityRegistry is ERC721URIStorage, EIP712, IERC8004Identity {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    uint256 private _lastId; // 0-indexed: next agentId to mint
    mapping(uint256 => mapping(string => bytes)) private _metadata;
    mapping(uint256 => address) private _agentWallet;

    event MetadataSet(
        uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue
    );

    bytes32 private constant AGENT_WALLET_SET_TYPEHASH =
        keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)");
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;
    uint256 private constant MAX_DEADLINE_DELAY = 5 minutes;
    bytes32 private constant RESERVED_AGENT_WALLET_KEY_HASH = keccak256("agentWallet");

    error ReservedKey();
    error NotAuthorized();
    error BadWallet();
    error Expired();
    error DeadlineTooFar();
    error InvalidWalletSignature();

    constructor() ERC721("AgentIdentity", "AGENT") EIP712("ERC8004IdentityRegistry", "1") {
        _lastId = 0;
    }

    // ---------------- registration ----------------

    function register() external returns (uint256 agentId) {
        return _register("");
    }

    function register(string calldata agentURI) external override returns (uint256 agentId) {
        return _register(agentURI);
    }

    function register(string calldata agentURI, MetadataEntry[] calldata metadata)
        external
        returns (uint256 agentId)
    {
        agentId = _register(agentURI);
        for (uint256 i; i < metadata.length; ++i) {
            _setMetadata(agentId, metadata[i].metadataKey, metadata[i].metadataValue);
        }
    }

    function _register(string memory agentURI) private returns (uint256 agentId) {
        agentId = _lastId++;
        _safeMint(msg.sender, agentId);
        if (bytes(agentURI).length != 0) _setTokenURI(agentId, agentURI);

        // agentWallet is reserved: initial value is the registrant, like the reference implementation.
        _agentWallet[agentId] = msg.sender;
        _metadata[agentId]["agentWallet"] = abi.encodePacked(msg.sender);
        emit Registered(agentId, agentURI, msg.sender);
        emit MetadataSet(agentId, "agentWallet", "agentWallet", abi.encodePacked(msg.sender));
    }

    // ---------------- URI / metadata ----------------

    function setAgentURI(uint256 agentId, string calldata newURI) external override {
        _requireAuthorized(agentId);
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function tokenURI(uint256 agentId)
        public
        view
        override(ERC721URIStorage, IERC8004Identity)
        returns (string memory)
    {
        return super.tokenURI(agentId);
    }

    function ownerOf(uint256 agentId)
        public
        view
        override(ERC721, IERC721, IERC8004Identity)
        returns (address owner)
    {
        return super.ownerOf(agentId);
    }

    function getMetadata(uint256 agentId, string calldata metadataKey) external view returns (bytes memory) {
        return _metadata[agentId][metadataKey];
    }

    function setMetadata(uint256 agentId, string calldata metadataKey, bytes calldata metadataValue)
        external
    {
        _requireAuthorized(agentId);
        _setMetadata(agentId, metadataKey, metadataValue);
    }

    function _setMetadata(uint256 agentId, string calldata metadataKey, bytes calldata metadataValue)
        private
    {
        if (keccak256(bytes(metadataKey)) == RESERVED_AGENT_WALLET_KEY_HASH) revert ReservedKey();
        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    // ---------------- agent wallet ----------------

    function getAgentWallet(uint256 agentId) external view override returns (address wallet) {
        ownerOf(agentId); // nonexistent agent must revert, like other identity reads
        return _agentWallet[agentId];
    }

    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature)
        external
        override
    {
        address owner = ownerOf(agentId);
        _requireAuthorized(agentId);
        if (newWallet == address(0)) revert BadWallet();
        if (block.timestamp > deadline) revert Expired();
        if (deadline > block.timestamp + MAX_DEADLINE_DELAY) revert DeadlineTooFar();

        bytes32 structHash =
            keccak256(abi.encode(AGENT_WALLET_SET_TYPEHASH, agentId, newWallet, owner, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);

        // SignatureChecker handles both ECDSA (EOA / EIP-7702) and ERC-1271 contract wallets
        // (magic value 0x1626ba7e). Fall back to an explicit ECDSA recovery so an EOA
        // signature is accepted even when the wallet has unusual code deployed.
        bool valid = SignatureChecker.isValidSignatureNow(newWallet, digest, signature);
        if (!valid) {
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
            valid = err == ECDSA.RecoverError.NoError && recovered == newWallet;
        }
        // Keep the ERC-1271 path explicit for readers/indexers.
        if (!valid && newWallet.code.length != 0) {
            (bool ok, bytes memory result) =
                newWallet.staticcall(abi.encodeCall(IERC1271Shim.isValidSignature, (digest, signature)));
            valid = ok && result.length >= 32 && abi.decode(result, (bytes4)) == ERC1271_MAGICVALUE;
        }
        if (!valid) revert InvalidWalletSignature();

        _agentWallet[agentId] = newWallet;
        _metadata[agentId]["agentWallet"] = abi.encodePacked(newWallet);
        emit MetadataSet(agentId, "agentWallet", "agentWallet", abi.encodePacked(newWallet));
    }

    function unsetAgentWallet(uint256 agentId) external {
        _requireAuthorized(agentId);
        _agentWallet[agentId] = address(0);
        _metadata[agentId]["agentWallet"] = "";
        emit MetadataSet(agentId, "agentWallet", "agentWallet", "");
    }

    /// @notice EIP-712 domain separator, exposed for off-chain signers and deploy scripts.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool) {
        return _isAuthorized(ownerOf(agentId), spender, agentId);
    }

    // ---------------- internals ----------------

    function _requireAuthorized(uint256 agentId) private view {
        address agentOwner = ownerOf(agentId);
        if (!_isAuthorized(agentOwner, msg.sender, agentId)) revert NotAuthorized();
    }

    /// @dev Clear the verified wallet on transfer so a new owner must re-verify it.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            _agentWallet[tokenId] = address(0);
            _metadata[tokenId]["agentWallet"] = "";
            emit MetadataSet(tokenId, "agentWallet", "agentWallet", "");
        }
        return super._update(to, tokenId, auth);
    }
}

/// @dev Local interface declaration so no extra OpenZeppelin import is needed for the explicit
///      ERC-1271 branch above (the function selector is identical to IERC1271).
interface IERC1271Shim {
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4 magicValue);
}
