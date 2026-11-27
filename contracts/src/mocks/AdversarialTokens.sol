// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @dev PayeeGuard surface used by the reentrant token mock.
interface IGuardExecutor {
    function executeIntent(bytes32 intentId) external;
    function tryExecuteIntent(bytes32 intentId) external returns (bool);
}

/// @notice ERC20 whose transfers always return false. SafeERC20 must surface this as a revert.
contract FalseReturnToken is ERC20 {
    error TransferDisabled();

    constructor() ERC20("False USD", "FALSE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// @notice ERC20 that reverts like a paused/blacklisted stablecoin. The revert must propagate.
contract RevertingToken is ERC20 {
    error TokenPaused();

    constructor() ERC20("Reverting USD", "REVERT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        revert TokenPaused();
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert TokenPaused();
    }
}

/// @notice ERC20 that reenters PayeeGuard from inside `transfer`, trying to pay a second intent.
/// @dev The nested call must fail (ReentrancyGuard) while the outer payment succeeds once.
contract ReentrantToken is ERC20 {
    IGuardExecutor public guard;
    bytes32 public targetIntent;
    bool public useStrict;
    bool public attempted;
    bool public nestedSucceeded;

    constructor() ERC20("Reentrant USD", "REENT") {}

    function configure(address guard_, bytes32 targetIntent_, bool useStrict_) external {
        guard = IGuardExecutor(guard_);
        targetIntent = targetIntent_;
        useStrict = useStrict_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (address(guard) != address(0) && targetIntent != bytes32(0)) {
            attempted = true;
            if (useStrict) {
                try guard.executeIntent(targetIntent) {
                    nestedSucceeded = true;
                } catch {}
            } else {
                try guard.tryExecuteIntent(targetIntent) returns (bool ok) {
                    nestedSucceeded = ok;
                } catch {}
            }
        }
        return super.transfer(to, amount);
    }
}

/// @notice Minimal ERC-1271 wallet used to test IdentityRegistry's contract-wallet signature path.
contract MockERC1271Wallet is IERC1271 {
    bytes4 public constant MAGIC = 0x1626ba7e;
    bool public accept;
    bytes32 public expectedDigest;

    function configure(bool accept_, bytes32 expectedDigest_) external {
        accept = accept_;
        expectedDigest = expectedDigest_;
    }

    function isValidSignature(bytes32 hash, bytes memory) external view override returns (bytes4) {
        return accept && hash == expectedDigest ? MAGIC : bytes4(0xffffffff);
    }
}
