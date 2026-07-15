// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SubmissionReceiptRegistry} from "../src/SubmissionReceiptRegistry.sol";

abstract contract RegistryGasFixture {
    bytes32 internal constant RECEIPT_ID = bytes32(uint256(1));
    bytes32 internal constant ATTEMPTED_HASH = bytes32(uint256(2));
    bytes32 internal constant SITE_HASH = bytes32(uint256(3));
    bytes32 internal constant TERMINAL_HASH = bytes32(uint256(4));
    bytes32 internal constant EXTENSION_KEY_HASH = bytes32(uint256(5));
    bytes32 internal constant AUTHORITY_KEY_HASH = bytes32(uint256(6));

    SubmissionReceiptRegistry internal registry;

    function _anchorAttempted() internal {
        registry.anchorEvent(
            RECEIPT_ID,
            ATTEMPTED_HASH,
            bytes32(0),
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
    }
}

contract SubmissionReceiptRegistryDeploymentGasTest {
    function testGas_DeployRegistry() public {
        new SubmissionReceiptRegistry();
    }
}

contract SubmissionReceiptRegistryFirstAnchorGasTest is RegistryGasFixture {
    function setUp() public {
        registry = new SubmissionReceiptRegistry();
    }

    function testGas_FirstAttemptedAnchor() public {
        _anchorAttempted();
    }
}

contract SubmissionReceiptRegistrySiteAnchorGasTest is RegistryGasFixture {
    function setUp() public {
        registry = new SubmissionReceiptRegistry();
        _anchorAttempted();
    }

    function testGas_LinkedSiteConfirmedAnchor() public {
        registry.anchorEvent(
            RECEIPT_ID,
            SITE_HASH,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );
    }
}

contract SubmissionReceiptRegistryAcceptedGasTest is RegistryGasFixture {
    function setUp() public {
        registry = new SubmissionReceiptRegistry();
        _anchorAttempted();
    }

    function testGas_TerminalAuthorityAcceptedAnchor() public {
        registry.anchorEvent(
            RECEIPT_ID,
            TERMINAL_HASH,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
        );
    }
}

contract SubmissionReceiptRegistryRejectedGasTest is RegistryGasFixture {
    function setUp() public {
        registry = new SubmissionReceiptRegistry();
        _anchorAttempted();
    }

    function testGas_TerminalAuthorityRejectedAnchor() public {
        registry.anchorEvent(
            RECEIPT_ID,
            TERMINAL_HASH,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected
        );
    }
}
