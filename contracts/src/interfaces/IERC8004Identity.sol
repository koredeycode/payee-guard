// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC8004Identity
/// @notice Minimal ERC-8004 Identity Registry surface used by PayeeGuard.
/// @dev Mirrors the register / setAgentURI / agentWallet part of the ERC-8004 spec
///      (reference implementation commit f2afbb0). Keeping this as an interface lets the
///      vault talk to any ERC-8004-compatible registry, including the canonical deployment.
interface IERC8004Identity {
    function register(string calldata agentURI) external returns (uint256 agentId);

    function setAgentURI(uint256 agentId, string calldata newURI) external;

    function ownerOf(uint256 agentId) external view returns (address owner);

    function getAgentWallet(uint256 agentId) external view returns (address wallet);

    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature)
        external;

    function tokenURI(uint256 agentId) external view returns (string memory);

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);

    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
}
