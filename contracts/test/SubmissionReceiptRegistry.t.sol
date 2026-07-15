// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SubmissionReceiptRegistry} from "../src/SubmissionReceiptRegistry.sol";
import {TestBase} from "./TestBase.sol";

contract SubmissionReceiptRegistryTest is TestBase {
    SubmissionReceiptRegistry internal registry;

    bytes32 internal constant RECEIPT_ID = bytes32(uint256(0x1001));
    bytes32 internal constant OTHER_RECEIPT_ID = bytes32(uint256(0x1002));
    bytes32 internal constant ATTEMPTED_HASH = bytes32(uint256(0x2001));
    bytes32 internal constant SITE_CONFIRMED_HASH = bytes32(uint256(0x2002));
    bytes32 internal constant ACCEPTED_HASH = bytes32(uint256(0x2003));
    bytes32 internal constant REJECTED_HASH = bytes32(uint256(0x2004));
    bytes32 internal constant OTHER_HASH = bytes32(uint256(0x2005));
    bytes32 internal constant EXTENSION_KEY_HASH = bytes32(uint256(0x3001));
    bytes32 internal constant OTHER_EXTENSION_KEY_HASH = bytes32(uint256(0x3002));
    bytes32 internal constant AUTHORITY_KEY_HASH = bytes32(uint256(0x4001));
    address internal constant ANCHORER = address(0xA11CE);

    event ReceiptEventAnchored(
        bytes32 indexed receiptId,
        bytes32 indexed eventHash,
        address indexed anchoredBy,
        bytes32 previousEventHash,
        bytes32 extensionKeyHash,
        bytes32 authorityKeyHash,
        SubmissionReceiptRegistry.ReceiptStage stage,
        uint64 anchoredAt,
        uint32 eventCount,
        uint16 protocolVersion
    );

    function setUp() public {
        registry = new SubmissionReceiptRegistry();
    }

    function testAnchorsNoneToAttemptedAndEmitsCompleteEvent() public {
        VM.warp(1_000);
        _expectEvent(
            RECEIPT_ID,
            ATTEMPTED_HASH,
            bytes32(0),
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted,
            1_000,
            1
        );

        VM.prank(ANCHORER);
        registry.anchorEvent(
            RECEIPT_ID,
            ATTEMPTED_HASH,
            bytes32(0),
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );

        _assertReceipt(
            RECEIPT_ID,
            SubmissionReceiptRegistry.ReceiptStage.Attempted,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            1_000,
            1
        );
        assertTrue(registry.isAnchored(ATTEMPTED_HASH));
    }

    function testAnchorsAttemptedToSiteConfirmedAndEmitsCompleteEvent() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        VM.warp(2_000);
        _expectEvent(
            RECEIPT_ID,
            SITE_CONFIRMED_HASH,
            ATTEMPTED_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed,
            2_000,
            2
        );

        VM.prank(ANCHORER);
        registry.anchorEvent(
            RECEIPT_ID,
            SITE_CONFIRMED_HASH,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );

        _assertReceipt(
            RECEIPT_ID,
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed,
            SITE_CONFIRMED_HASH,
            EXTENSION_KEY_HASH,
            2_000,
            2
        );
        assertTrue(registry.isAnchored(SITE_CONFIRMED_HASH));
    }

    function testAnchorsAttemptedToAuthorityAcceptedAndEmitsCompleteEvent() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        VM.warp(3_000);
        _expectEvent(
            RECEIPT_ID,
            ACCEPTED_HASH,
            ATTEMPTED_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted,
            3_000,
            2
        );

        VM.prank(ANCHORER);
        registry.anchorEvent(
            RECEIPT_ID,
            ACCEPTED_HASH,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
        );

        _assertReceipt(
            RECEIPT_ID,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted,
            ACCEPTED_HASH,
            EXTENSION_KEY_HASH,
            3_000,
            2
        );
        assertTrue(registry.isAnchored(ACCEPTED_HASH));
    }

    function testAnchorsAttemptedToAuthorityRejectedAndEmitsCompleteEvent() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        VM.warp(4_000);
        _expectEvent(
            RECEIPT_ID,
            REJECTED_HASH,
            ATTEMPTED_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected,
            4_000,
            2
        );

        VM.prank(ANCHORER);
        registry.anchorEvent(
            RECEIPT_ID,
            REJECTED_HASH,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected
        );

        _assertReceipt(
            RECEIPT_ID,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected,
            REJECTED_HASH,
            EXTENSION_KEY_HASH,
            4_000,
            2
        );
        assertTrue(registry.isAnchored(REJECTED_HASH));
    }

    function testAnchorsSiteConfirmedToAuthorityAcceptedAndEmitsCompleteEvent() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        _anchorSiteConfirmed(RECEIPT_ID, ATTEMPTED_HASH, SITE_CONFIRMED_HASH);
        VM.warp(5_000);
        _expectEvent(
            RECEIPT_ID,
            ACCEPTED_HASH,
            SITE_CONFIRMED_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted,
            5_000,
            3
        );

        VM.prank(ANCHORER);
        registry.anchorEvent(
            RECEIPT_ID,
            ACCEPTED_HASH,
            SITE_CONFIRMED_HASH,
            EXTENSION_KEY_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
        );

        _assertReceipt(
            RECEIPT_ID,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted,
            ACCEPTED_HASH,
            EXTENSION_KEY_HASH,
            5_000,
            3
        );
        assertTrue(registry.isAnchored(ACCEPTED_HASH));
    }

    function testAnchorsSiteConfirmedToAuthorityRejectedAndEmitsCompleteEvent() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        _anchorSiteConfirmed(RECEIPT_ID, ATTEMPTED_HASH, SITE_CONFIRMED_HASH);
        VM.warp(6_000);
        _expectEvent(
            RECEIPT_ID,
            REJECTED_HASH,
            SITE_CONFIRMED_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected,
            6_000,
            3
        );

        VM.prank(ANCHORER);
        registry.anchorEvent(
            RECEIPT_ID,
            REJECTED_HASH,
            SITE_CONFIRMED_HASH,
            EXTENSION_KEY_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected
        );

        _assertReceipt(
            RECEIPT_ID,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected,
            REJECTED_HASH,
            EXTENSION_KEY_HASH,
            6_000,
            3
        );
        assertTrue(registry.isAnchored(REJECTED_HASH));
    }

    function testRejectsInitialSiteConfirmed() public {
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.InvalidInitialStage.selector,
                SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            SITE_CONFIRMED_HASH,
            bytes32(0),
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );
    }

    function testRejectsInitialAuthorityAccepted() public {
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.InvalidInitialStage.selector,
                SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            ACCEPTED_HASH,
            bytes32(0),
            EXTENSION_KEY_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
        );
    }

    function testRejectsInitialAuthorityRejected() public {
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.InvalidInitialStage.selector,
                SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            REJECTED_HASH,
            bytes32(0),
            EXTENSION_KEY_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected
        );
    }

    function testRejectsInitialNone() public {
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.InvalidInitialStage.selector,
                SubmissionReceiptRegistry.ReceiptStage.None
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            ATTEMPTED_HASH,
            bytes32(0),
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.None
        );
    }

    function testRejectsRepeatedAttempted() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        _expectInvalidTransition(
            SubmissionReceiptRegistry.ReceiptStage.Attempted,
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
        _anchorRaw(
            RECEIPT_ID,
            OTHER_HASH,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
    }

    function testRejectsRepeatedSiteConfirmed() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        _anchorSiteConfirmed(RECEIPT_ID, ATTEMPTED_HASH, SITE_CONFIRMED_HASH);
        _expectInvalidTransition(
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed,
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );
        _anchorRaw(
            RECEIPT_ID,
            OTHER_HASH,
            SITE_CONFIRMED_HASH,
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );
    }

    function testRejectsAttemptedAfterSiteConfirmed() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        _anchorSiteConfirmed(RECEIPT_ID, ATTEMPTED_HASH, SITE_CONFIRMED_HASH);
        _expectInvalidTransition(
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed,
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
        _anchorRaw(
            RECEIPT_ID,
            OTHER_HASH,
            SITE_CONFIRMED_HASH,
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
    }

    function testRejectsEveryTransitionAfterAuthorityAccepted() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        _anchorAuthority(
            RECEIPT_ID,
            ATTEMPTED_HASH,
            ACCEPTED_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
        );
        _assertEveryTerminalAppendReverts(
            SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted, ACCEPTED_HASH
        );
    }

    function testRejectsEveryTransitionAfterAuthorityRejected() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        _anchorAuthority(
            RECEIPT_ID,
            ATTEMPTED_HASH,
            REJECTED_HASH,
            SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected
        );
        _assertEveryTerminalAppendReverts(
            SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected, REJECTED_HASH
        );
    }

    function testRejectsDuplicateEventHashWithinReceipt() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.DuplicateEventHash.selector, ATTEMPTED_HASH
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            ATTEMPTED_HASH,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );
    }

    function testRejectsDuplicateEventHashAcrossReceipts() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.DuplicateEventHash.selector, ATTEMPTED_HASH
            )
        );
        _anchorRaw(
            OTHER_RECEIPT_ID,
            ATTEMPTED_HASH,
            bytes32(0),
            OTHER_EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
    }

    function testRejectsWrongPreviousEventHash() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.IncorrectPreviousEventHash.selector,
                ATTEMPTED_HASH,
                OTHER_HASH
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            SITE_CONFIRMED_HASH,
            OTHER_HASH,
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );
    }

    function testRejectsZeroPreviousEventHashForLinkedEvent() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        VM.expectRevert(SubmissionReceiptRegistry.ZeroPreviousEventHash.selector);
        _anchorRaw(
            RECEIPT_ID,
            SITE_CONFIRMED_HASH,
            bytes32(0),
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );
    }

    function testRejectsNonzeroPreviousEventHashForFirstEvent() public {
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.UnexpectedPreviousEventHash.selector, OTHER_HASH
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            ATTEMPTED_HASH,
            OTHER_HASH,
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
    }

    function testRejectsZeroReceiptId() public {
        VM.expectRevert(SubmissionReceiptRegistry.ZeroReceiptId.selector);
        _anchorRaw(
            bytes32(0),
            ATTEMPTED_HASH,
            bytes32(0),
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
    }

    function testRejectsZeroEventHash() public {
        VM.expectRevert(SubmissionReceiptRegistry.ZeroEventHash.selector);
        _anchorRaw(
            RECEIPT_ID,
            bytes32(0),
            bytes32(0),
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
    }

    function testRejectsZeroExtensionKeyHash() public {
        VM.expectRevert(SubmissionReceiptRegistry.ZeroExtensionKeyHash.selector);
        _anchorRaw(
            RECEIPT_ID,
            ATTEMPTED_HASH,
            bytes32(0),
            bytes32(0),
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
    }

    function testRejectsChangedExtensionKeyHash() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.ExtensionKeyMismatch.selector,
                EXTENSION_KEY_HASH,
                OTHER_EXTENSION_KEY_HASH
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            SITE_CONFIRMED_HASH,
            ATTEMPTED_HASH,
            OTHER_EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );
    }

    function testRejectsMissingAuthorityKeyHashForAccepted() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.MissingAuthorityKeyHash.selector,
                SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            ACCEPTED_HASH,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
        );
    }

    function testRejectsMissingAuthorityKeyHashForRejected() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.MissingAuthorityKeyHash.selector,
                SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            REJECTED_HASH,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected
        );
    }

    function testRejectsAuthorityKeyHashForAttempted() public {
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.UnexpectedAuthorityKeyHash.selector,
                SubmissionReceiptRegistry.ReceiptStage.Attempted,
                AUTHORITY_KEY_HASH
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            ATTEMPTED_HASH,
            bytes32(0),
            EXTENSION_KEY_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
    }

    function testRejectsAuthorityKeyHashForSiteConfirmed() public {
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.UnexpectedAuthorityKeyHash.selector,
                SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed,
                AUTHORITY_KEY_HASH
            )
        );
        _anchorRaw(
            RECEIPT_ID,
            SITE_CONFIRMED_HASH,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            AUTHORITY_KEY_HASH,
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );
    }

    function testMalformedStageValueRevertsAtAbiBoundary() public {
        bytes memory callData = abi.encodeWithSelector(
            SubmissionReceiptRegistry.anchorEvent.selector,
            RECEIPT_ID,
            ATTEMPTED_HASH,
            bytes32(0),
            EXTENSION_KEY_HASH,
            bytes32(0),
            uint8(5)
        );

        (bool success,) = address(registry).call(callData);
        assertFalse(success);
        _assertUnknownReceipt(RECEIPT_ID);
    }

    function testUnknownReceiptReturnsDefaultState() public view {
        _assertUnknownReceipt(RECEIPT_ID);
        assertFalse(registry.isAnchored(ATTEMPTED_HASH));
    }

    function testTimestampChangesAcrossEvents() public {
        VM.warp(10_000);
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        _assertReceipt(
            RECEIPT_ID,
            SubmissionReceiptRegistry.ReceiptStage.Attempted,
            ATTEMPTED_HASH,
            EXTENSION_KEY_HASH,
            10_000,
            1
        );

        VM.warp(20_000);
        _anchorSiteConfirmed(RECEIPT_ID, ATTEMPTED_HASH, SITE_CONFIRMED_HASH);
        _assertReceipt(
            RECEIPT_ID,
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed,
            SITE_CONFIRMED_HASH,
            EXTENSION_KEY_HASH,
            20_000,
            2
        );
    }

    function testTimestampOverflowRevertsWithoutTruncation() public {
        VM.warp(uint256(type(uint64).max) + 1);
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.TimestampOverflow.selector, uint256(type(uint64).max) + 1
            )
        );
        _anchorAttempted(RECEIPT_ID, ATTEMPTED_HASH);
        _assertUnknownReceipt(RECEIPT_ID);
        assertFalse(registry.isAnchored(ATTEMPTED_HASH));
    }

    function testProtocolVersionIsOne() public view {
        assertEq(uint256(registry.PROTOCOL_VERSION()), 1);
    }

    function _anchorAttempted(bytes32 receiptId, bytes32 eventHash) internal {
        _anchorRaw(
            receiptId,
            eventHash,
            bytes32(0),
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        );
    }

    function _anchorSiteConfirmed(bytes32 receiptId, bytes32 previousHash, bytes32 eventHash)
        internal
    {
        _anchorRaw(
            receiptId,
            eventHash,
            previousHash,
            EXTENSION_KEY_HASH,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        );
    }

    function _anchorAuthority(
        bytes32 receiptId,
        bytes32 previousHash,
        bytes32 eventHash,
        SubmissionReceiptRegistry.ReceiptStage stage
    ) internal {
        _anchorRaw(
            receiptId, eventHash, previousHash, EXTENSION_KEY_HASH, AUTHORITY_KEY_HASH, stage
        );
    }

    function _anchorRaw(
        bytes32 receiptId,
        bytes32 eventHash,
        bytes32 previousHash,
        bytes32 extensionKeyHash,
        bytes32 authorityKeyHash,
        SubmissionReceiptRegistry.ReceiptStage stage
    ) internal {
        VM.prank(ANCHORER);
        registry.anchorEvent(
            receiptId, eventHash, previousHash, extensionKeyHash, authorityKeyHash, stage
        );
    }

    function _assertEveryTerminalAppendReverts(
        SubmissionReceiptRegistry.ReceiptStage terminalStage,
        bytes32 terminalHash
    ) internal {
        SubmissionReceiptRegistry.ReceiptStage[4] memory
            requested = [
                SubmissionReceiptRegistry.ReceiptStage.Attempted,
                SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed,
                SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted,
                SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected
            ];

        for (uint256 index = 0; index < requested.length; index++) {
            bytes32 authorityKeyHash = uint8(requested[index])
                >= uint8(SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted)
                ? AUTHORITY_KEY_HASH
                : bytes32(0);
            VM.expectRevert(
                abi.encodeWithSelector(
                    SubmissionReceiptRegistry.TerminalReceipt.selector, terminalStage
                )
            );
            _anchorRaw(
                RECEIPT_ID,
                bytes32(uint256(0x9000 + index)),
                terminalHash,
                EXTENSION_KEY_HASH,
                authorityKeyHash,
                requested[index]
            );
        }
    }

    function _expectInvalidTransition(
        SubmissionReceiptRegistry.ReceiptStage current,
        SubmissionReceiptRegistry.ReceiptStage requested
    ) internal {
        VM.expectRevert(
            abi.encodeWithSelector(
                SubmissionReceiptRegistry.InvalidTransition.selector, current, requested
            )
        );
    }

    function _expectEvent(
        bytes32 receiptId,
        bytes32 eventHash,
        bytes32 previousEventHash,
        bytes32 authorityKeyHash,
        SubmissionReceiptRegistry.ReceiptStage stage,
        uint64 anchoredAt,
        uint32 eventCount
    ) internal {
        VM.expectEmit(true, true, true, true, address(registry));
        emit ReceiptEventAnchored(
            receiptId,
            eventHash,
            ANCHORER,
            previousEventHash,
            EXTENSION_KEY_HASH,
            authorityKeyHash,
            stage,
            anchoredAt,
            eventCount,
            1
        );
    }

    function _assertReceipt(
        bytes32 receiptId,
        SubmissionReceiptRegistry.ReceiptStage expectedStage,
        bytes32 expectedLatestHash,
        bytes32 expectedExtensionKeyHash,
        uint64 expectedUpdatedAt,
        uint32 expectedEventCount
    ) internal view {
        (
            SubmissionReceiptRegistry.ReceiptStage currentStage,
            bytes32 latestEventHash,
            bytes32 extensionKeyHash,
            uint64 updatedAt,
            uint32 eventCount
        ) = registry.getReceipt(receiptId);

        assertEq(uint256(uint8(currentStage)), uint256(uint8(expectedStage)));
        assertEq(latestEventHash, expectedLatestHash);
        assertEq(extensionKeyHash, expectedExtensionKeyHash);
        assertEq(uint256(updatedAt), uint256(expectedUpdatedAt));
        assertEq(uint256(eventCount), uint256(expectedEventCount));
    }

    function _assertUnknownReceipt(bytes32 receiptId) internal view {
        _assertReceipt(
            receiptId, SubmissionReceiptRegistry.ReceiptStage.None, bytes32(0), bytes32(0), 0, 0
        );
    }
}
