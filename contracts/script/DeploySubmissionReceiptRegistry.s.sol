// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SubmissionReceiptRegistry} from "../src/SubmissionReceiptRegistry.sol";

interface IVmBroadcast {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @title DeploySubmissionReceiptRegistry
/// @notice Foundry deployment script guarded to Monad Testnet chain ID 10143.
/// @dev `startBroadcast()` uses credentials supplied through Foundry's account or keystore
///      mechanisms. This source contains no key and broadcasts only when the CLI receives
///      `--broadcast`.
contract DeploySubmissionReceiptRegistry {
    /// @notice Monad Testnet's required chain identifier.
    uint256 public constant MONAD_TESTNET_CHAIN_ID = 10143;

    /// @notice Reverts before deployment or broadcast on any unexpected chain.
    /// @param expected Required Monad Testnet chain identifier.
    /// @param actual Active chain identifier.
    error UnexpectedChainId(uint256 expected, uint256 actual);

    IVmBroadcast private constant VM =
        IVmBroadcast(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @notice Deploys a new registry after validating the active chain.
    /// @return registry The newly deployed registry instance.
    function run() external returns (SubmissionReceiptRegistry registry) {
        requireMonadTestnet(block.chainid);

        VM.startBroadcast();
        registry = new SubmissionReceiptRegistry();
        VM.stopBroadcast();
    }

    /// @notice Validates a chain identifier independently for simulation and tests.
    /// @param chainId Chain identifier to validate.
    function requireMonadTestnet(uint256 chainId) public pure {
        if (chainId != MONAD_TESTNET_CHAIN_ID) {
            revert UnexpectedChainId(MONAD_TESTNET_CHAIN_ID, chainId);
        }
    }
}
