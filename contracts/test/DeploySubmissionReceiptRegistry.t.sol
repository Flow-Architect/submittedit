// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DeploySubmissionReceiptRegistry} from "../script/DeploySubmissionReceiptRegistry.s.sol";
import {SubmissionReceiptRegistry} from "../src/SubmissionReceiptRegistry.sol";
import {TestBase} from "./TestBase.sol";

contract DeploySubmissionReceiptRegistryTest is TestBase {
    DeploySubmissionReceiptRegistry internal deployment;

    function setUp() public {
        deployment = new DeploySubmissionReceiptRegistry();
    }

    function testRejectsUnexpectedChainIdBeforeBroadcast() public {
        VM.chainId(1);
        VM.expectRevert(
            abi.encodeWithSelector(
                DeploySubmissionReceiptRegistry.UnexpectedChainId.selector, 10143, 1
            )
        );
        deployment.run();
    }

    function testAcceptsMonadTestnetChainId() public view {
        deployment.requireMonadTestnet(10143);
        assertEq(deployment.MONAD_TESTNET_CHAIN_ID(), 10143);
    }

    function testSimulatesDeploymentOnMonadTestnetWithoutBroadcastFlag() public {
        VM.chainId(10143);
        SubmissionReceiptRegistry registry = deployment.run();
        assertTrue(address(registry).code.length > 0);
        assertEq(uint256(registry.PROTOCOL_VERSION()), 1);
    }
}
