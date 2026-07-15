// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SubmissionReceiptRegistry} from "../src/SubmissionReceiptRegistry.sol";
import {TestBase} from "./TestBase.sol";

contract SubmissionReceiptRegistryFuzzTest is TestBase {
    SubmissionReceiptRegistry internal registry;

    function setUp() public {
        registry = new SubmissionReceiptRegistry();
    }

    function testFuzzRejectsDuplicateHashGlobally(
        bytes32 firstReceiptId,
        bytes32 secondReceiptId,
        bytes32 eventHash,
        bytes32 firstExtensionKeyHash,
        bytes32 secondExtensionKeyHash,
        address firstSender,
        address secondSender
    ) public {
        VM.assume(firstReceiptId != bytes32(0));
        VM.assume(secondReceiptId != bytes32(0));
        VM.assume(firstReceiptId != secondReceiptId);
        VM.assume(eventHash != bytes32(0));
        VM.assume(firstExtensionKeyHash != bytes32(0));
        VM.assume(secondExtensionKeyHash != bytes32(0));

        VM.prank(firstSender);
        _anchorAttempted(firstReceiptId, eventHash, firstExtensionKeyHash);

        VM.expectRevert(
            abi.encodeWithSelector(SubmissionReceiptRegistry.DuplicateEventHash.selector, eventHash)
        );
        VM.prank(secondSender);
        _anchorAttempted(secondReceiptId, eventHash, secondExtensionKeyHash);

        assertTrue(registry.isAnchored(eventHash));
        _assertCount(firstReceiptId, 1);
        _assertCount(secondReceiptId, 0);
    }

    function testFuzzRejectsRandomIncorrectPreviousHash(
        bytes32 receiptId,
        bytes32 attemptedHash,
        bytes32 siteHash,
        bytes32 wrongPreviousHash,
        bytes32 extensionKeyHash
    ) public {
        VM.assume(receiptId != bytes32(0));
        VM.assume(attemptedHash != bytes32(0));
        VM.assume(siteHash != bytes32(0));
        VM.assume(siteHash != attemptedHash);
        VM.assume(wrongPreviousHash != bytes32(0));
        VM.assume(wrongPreviousHash != attemptedHash);
        VM.assume(extensionKeyHash != bytes32(0));

        _anchorAttempted(receiptId, attemptedHash, extensionKeyHash);
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.IncorrectPreviousEventHash.selector,
                attemptedHash,
                wrongPreviousHash
            )
        );
        registry.anchorEvent(
            receiptId,
            siteHash,
            wrongPreviousHash,
            extensionKeyHash,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );

        _assertTip(receiptId, SubmissionReceiptRegistry.ReceiptStage.Attempted, attemptedHash, 1);
        assertFalse(registry.isAnchored(siteHash));
    }

    function testFuzzPreservesEstablishedExtensionKey(
        bytes32 receiptId,
        bytes32 attemptedHash,
        bytes32 siteHash,
        bytes32 extensionKeyHash,
        bytes32 changedExtensionKeyHash
    ) public {
        VM.assume(receiptId != bytes32(0));
        VM.assume(attemptedHash != bytes32(0));
        VM.assume(siteHash != bytes32(0));
        VM.assume(siteHash != attemptedHash);
        VM.assume(extensionKeyHash != bytes32(0));
        VM.assume(changedExtensionKeyHash != bytes32(0));
        VM.assume(changedExtensionKeyHash != extensionKeyHash);

        _anchorAttempted(receiptId, attemptedHash, extensionKeyHash);
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.ExtensionKeyMismatch.selector,
                extensionKeyHash,
                changedExtensionKeyHash
            )
        );
        registry.anchorEvent(
            receiptId,
            siteHash,
            attemptedHash,
            changedExtensionKeyHash,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );

        (,, bytes32 storedExtensionKeyHash,,) = registry.getReceipt(receiptId);
        assertEq(storedExtensionKeyHash, extensionKeyHash);
        assertFalse(registry.isAnchored(siteHash));
    }

    function testFuzzTerminalStateCannotChange(
        bool accepted,
        bytes32 receiptId,
        bytes32 attemptedHash,
        bytes32 terminalHash,
        bytes32 candidateHash,
        bytes32 extensionKeyHash,
        bytes32 authorityKeyHash,
        uint8 requestedStageSeed
    ) public {
        VM.assume(receiptId != bytes32(0));
        VM.assume(attemptedHash != bytes32(0));
        VM.assume(terminalHash != bytes32(0));
        VM.assume(candidateHash != bytes32(0));
        VM.assume(attemptedHash != terminalHash);
        VM.assume(candidateHash != attemptedHash);
        VM.assume(candidateHash != terminalHash);
        VM.assume(extensionKeyHash != bytes32(0));
        VM.assume(authorityKeyHash != bytes32(0));

        _anchorAttempted(receiptId, attemptedHash, extensionKeyHash);
        SubmissionReceiptRegistry.ReceiptStage terminalStage = accepted
            ? SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
            : SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected;
        registry.anchorEvent(
            receiptId,
            terminalHash,
            attemptedHash,
            extensionKeyHash,
            authorityKeyHash,
            terminalStage
        );

        SubmissionReceiptRegistry.ReceiptStage requestedStage =
            SubmissionReceiptRegistry.ReceiptStage(uint8(requestedStageSeed % 4) + 1);
        bytes32 candidateAuthorityKeyHash = uint8(requestedStage)
            >= uint8(SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted)
            ? authorityKeyHash
            : bytes32(0);
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.TerminalReceipt.selector, terminalStage
            )
        );
        registry.anchorEvent(
            receiptId,
            candidateHash,
            terminalHash,
            extensionKeyHash,
            candidateAuthorityKeyHash,
            requestedStage
        );

        _assertTip(receiptId, terminalStage, terminalHash, 2);
        assertFalse(registry.isAnchored(candidateHash));
    }

    function testFuzzValidSequencesKeepMonotonicCountAndLatestHash(
        bytes32 receiptId,
        bytes32 attemptedHash,
        bytes32 secondHash,
        bytes32 thirdHash,
        bytes32 extensionKeyHash,
        bytes32 authorityKeyHash,
        bool includeSiteConfirmation,
        bool accepted
    ) public {
        VM.assume(receiptId != bytes32(0));
        VM.assume(attemptedHash != bytes32(0));
        VM.assume(secondHash != bytes32(0));
        VM.assume(thirdHash != bytes32(0));
        VM.assume(attemptedHash != secondHash);
        VM.assume(attemptedHash != thirdHash);
        VM.assume(secondHash != thirdHash);
        VM.assume(extensionKeyHash != bytes32(0));
        VM.assume(authorityKeyHash != bytes32(0));

        _anchorAttempted(receiptId, attemptedHash, extensionKeyHash);
        _assertTip(receiptId, SubmissionReceiptRegistry.ReceiptStage.Attempted, attemptedHash, 1);

        bytes32 previousHash = attemptedHash;
        bytes32 terminalHash = secondHash;
        uint32 terminalCount = 2;
        if (includeSiteConfirmation) {
            registry.anchorEvent(
                receiptId,
                secondHash,
                attemptedHash,
                extensionKeyHash,
                bytes32(0),
                SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
            );
            _assertTip(
                receiptId, SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed, secondHash, 2
            );
            previousHash = secondHash;
            terminalHash = thirdHash;
            terminalCount = 3;
        }

        SubmissionReceiptRegistry.ReceiptStage terminalStage = accepted
            ? SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
            : SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected;
        registry.anchorEvent(
            receiptId, terminalHash, previousHash, extensionKeyHash, authorityKeyHash, terminalStage
        );

        _assertTip(receiptId, terminalStage, terminalHash, terminalCount);
        assertTrue(registry.isAnchored(attemptedHash));
        assertTrue(registry.isAnchored(terminalHash));
        if (includeSiteConfirmation) assertTrue(registry.isAnchored(secondHash));
    }

    function testFuzzReceiptsRemainIsolated(
        bytes32 firstReceiptId,
        bytes32 secondReceiptId,
        bytes32 firstEventHash,
        bytes32 secondEventHash,
        bytes32 firstExtensionKeyHash,
        bytes32 secondExtensionKeyHash
    ) public {
        VM.assume(firstReceiptId != bytes32(0));
        VM.assume(secondReceiptId != bytes32(0));
        VM.assume(firstReceiptId != secondReceiptId);
        VM.assume(firstEventHash != bytes32(0));
        VM.assume(secondEventHash != bytes32(0));
        VM.assume(firstEventHash != secondEventHash);
        VM.assume(firstExtensionKeyHash != bytes32(0));
        VM.assume(secondExtensionKeyHash != bytes32(0));

        _anchorAttempted(firstReceiptId, firstEventHash, firstExtensionKeyHash);
        _anchorAttempted(secondReceiptId, secondEventHash, secondExtensionKeyHash);

        _assertReceiptIdentity(firstReceiptId, firstEventHash, firstExtensionKeyHash);
        _assertReceiptIdentity(secondReceiptId, secondEventHash, secondExtensionKeyHash);
    }

    function testFuzzAuthorityKeyRules(
        bytes32 receiptId,
        bytes32 attemptedHash,
        bytes32 nextHash,
        bytes32 extensionKeyHash,
        bytes32 authorityKeyHash,
        bool accepted
    ) public {
        VM.assume(receiptId != bytes32(0));
        VM.assume(attemptedHash != bytes32(0));
        VM.assume(nextHash != bytes32(0));
        VM.assume(nextHash != attemptedHash);
        VM.assume(extensionKeyHash != bytes32(0));
        VM.assume(authorityKeyHash != bytes32(0));

        _anchorAttempted(receiptId, attemptedHash, extensionKeyHash);
        SubmissionReceiptRegistry.ReceiptStage terminalStage = accepted
            ? SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
            : SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected;

        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.MissingAuthorityKeyHash.selector, terminalStage
            )
        );
        registry.anchorEvent(
            receiptId, nextHash, attemptedHash, extensionKeyHash, bytes32(0), terminalStage
        );

        registry.anchorEvent(
            receiptId, nextHash, attemptedHash, extensionKeyHash, authorityKeyHash, terminalStage
        );
        _assertTip(receiptId, terminalStage, nextHash, 2);
    }

    function testFuzzZeroIdentityValuesNeverInitialize(
        uint8 zeroFieldSeed,
        bytes32 receiptSeed,
        bytes32 eventSeed,
        bytes32 extensionSeed
    ) public {
        bytes32 receiptId = _nonzero(receiptSeed);
        bytes32 eventHash = _nonzero(eventSeed);
        bytes32 extensionKeyHash = _nonzero(extensionSeed);
        uint8 zeroField = zeroFieldSeed % 3;
        bytes4 expectedError;

        if (zeroField == 0) {
            receiptId = bytes32(0);
            expectedError = SubmissionReceiptRegistry.ZeroReceiptId.selector;
        } else if (zeroField == 1) {
            eventHash = bytes32(0);
            expectedError = SubmissionReceiptRegistry.ZeroEventHash.selector;
        } else {
            extensionKeyHash = bytes32(0);
            expectedError = SubmissionReceiptRegistry.ZeroExtensionKeyHash.selector;
        }

        VM.expectRevert(expectedError);
        _anchorAttempted(receiptId, eventHash, extensionKeyHash);
        _assertCount(receiptId, 0);
        assertFalse(registry.isAnchored(eventHash));
    }

    function _anchorAttempted(bytes32 receiptId, bytes32 eventHash, bytes32 extensionKeyHash)
        internal
    {
        registry.anchorEvent(
            receiptId,
            eventHash,
            bytes32(0),
            extensionKeyHash,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
    }

    function _assertCount(bytes32 receiptId, uint32 expectedCount) internal view {
        (,,,, uint32 eventCount) = registry.getReceipt(receiptId);
        assertEq(uint256(eventCount), uint256(expectedCount));
    }

    function _assertTip(
        bytes32 receiptId,
        SubmissionReceiptRegistry.ReceiptStage expectedStage,
        bytes32 expectedHash,
        uint32 expectedCount
    ) internal view {
        (
            SubmissionReceiptRegistry.ReceiptStage stage,
            bytes32 latestEventHash,,,
            uint32 eventCount
        ) = registry.getReceipt(receiptId);
        assertEq(uint256(uint8(stage)), uint256(uint8(expectedStage)));
        assertEq(latestEventHash, expectedHash);
        assertEq(uint256(eventCount), uint256(expectedCount));
    }

    function _assertReceiptIdentity(
        bytes32 receiptId,
        bytes32 expectedHash,
        bytes32 expectedExtensionKeyHash
    ) internal view {
        (, bytes32 latestEventHash, bytes32 extensionKeyHash,, uint32 eventCount) =
            registry.getReceipt(receiptId);
        assertEq(latestEventHash, expectedHash);
        assertEq(extensionKeyHash, expectedExtensionKeyHash);
        assertEq(uint256(eventCount), 1);
    }

    function _nonzero(bytes32 value) internal pure returns (bytes32) {
        return value == bytes32(0) ? bytes32(uint256(1)) : value;
    }
}
