// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SubmissionReceiptRegistry} from "../src/SubmissionReceiptRegistry.sol";
import {TestBase} from "./TestBase.sol";

contract SubmissionReceiptRegistryHandler {
    uint256 internal constant RECEIPT_LIMIT = 4;

    SubmissionReceiptRegistry public immutable REGISTRY;
    bytes32[] internal _successfulHashes;

    constructor(SubmissionReceiptRegistry registry_) {
        REGISTRY = registry_;
    }

    function advance(
        uint8 receiptSeed,
        uint8 outcomeSeed,
        bytes32 eventSeed,
        bytes32 extensionSeed,
        bytes32 authoritySeed
    ) external {
        bytes32 receiptId = receiptIdAt(uint256(receiptSeed) % RECEIPT_LIMIT);
        (
            SubmissionReceiptRegistry.ReceiptStage currentStage,
            bytes32 latestEventHash,
            bytes32 extensionKeyHash,,
        ) = REGISTRY.getReceipt(receiptId);

        SubmissionReceiptRegistry.ReceiptStage nextStage;
        bytes32 previousEventHash;
        bytes32 nextExtensionKeyHash;
        bytes32 authorityKeyHash;

        if (currentStage == SubmissionReceiptRegistry.ReceiptStage.None) {
            nextStage = SubmissionReceiptRegistry.ReceiptStage.Attempted;
            nextExtensionKeyHash = _nonzero(extensionSeed);
        } else if (currentStage == SubmissionReceiptRegistry.ReceiptStage.Attempted) {
            previousEventHash = latestEventHash;
            nextExtensionKeyHash = extensionKeyHash;
            uint8 outcome = outcomeSeed % 3;
            if (outcome == 0) {
                nextStage = SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed;
            } else {
                nextStage = outcome == 1
                    ? SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
                    : SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected;
                authorityKeyHash = _nonzero(authoritySeed);
            }
        } else if (currentStage == SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed) {
            previousEventHash = latestEventHash;
            nextExtensionKeyHash = extensionKeyHash;
            nextStage = outcomeSeed % 2 == 0
                ? SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
                : SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected;
            authorityKeyHash = _nonzero(authoritySeed);
        } else {
            return;
        }

        bytes32 eventHash =
            keccak256(abi.encode(eventSeed, receiptId, _successfulHashes.length, nextStage));
        if (eventHash == bytes32(0)) eventHash = bytes32(uint256(1));

        try REGISTRY.anchorEvent(
            receiptId,
            eventHash,
            previousEventHash,
            nextExtensionKeyHash,
            authorityKeyHash,
            nextStage
        ) {
            _successfulHashes.push(eventHash);
        } catch {}
    }

    function attemptReplay(uint8 successfulHashSeed, uint8 receiptSeed) external {
        if (_successfulHashes.length == 0) return;
        bytes32 eventHash =
            _successfulHashes[uint256(successfulHashSeed) % _successfulHashes.length];
        bytes32 receiptId = receiptIdAt(uint256(receiptSeed) % RECEIPT_LIMIT);
        REGISTRY.isAnchored(eventHash);
        try REGISTRY.anchorEvent(
            receiptId,
            eventHash,
            bytes32(0),
            bytes32(uint256(1)),
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.Attempted
        ) {}
            catch {}
    }

    function attemptWrongLink(uint8 receiptSeed, bytes32 eventSeed, bytes32 wrongPreviousSeed)
        external
    {
        bytes32 receiptId = receiptIdAt(uint256(receiptSeed) % RECEIPT_LIMIT);
        (
            SubmissionReceiptRegistry.ReceiptStage stage,
            bytes32 latestEventHash,
            bytes32 extensionKeyHash,,
        ) = REGISTRY.getReceipt(receiptId);
        if (stage != SubmissionReceiptRegistry.ReceiptStage.Attempted) return;

        bytes32 wrongPreviousHash = _nonzero(wrongPreviousSeed);
        if (wrongPreviousHash == latestEventHash) {
            wrongPreviousHash = keccak256(abi.encode(wrongPreviousHash));
        }
        bytes32 eventHash = _nonzero(keccak256(abi.encode(eventSeed, wrongPreviousHash)));
        try REGISTRY.anchorEvent(
            receiptId,
            eventHash,
            wrongPreviousHash,
            extensionKeyHash,
            bytes32(0),
            SubmissionReceiptRegistry.ReceiptStage.SiteConfirmed
        ) {}
            catch {}
    }

    function successfulHashCount() external view returns (uint256) {
        return _successfulHashes.length;
    }

    function successfulHashAt(uint256 index) external view returns (bytes32) {
        return _successfulHashes[index];
    }

    function receiptIdAt(uint256 index) public pure returns (bytes32) {
        return bytes32(index + 1);
    }

    function _nonzero(bytes32 value) private pure returns (bytes32) {
        return value == bytes32(0) ? bytes32(uint256(1)) : value;
    }
}

contract SubmissionReceiptRegistryInvariantTest is TestBase {
    SubmissionReceiptRegistry internal registry;
    SubmissionReceiptRegistryHandler internal handler;

    function setUp() public {
        registry = new SubmissionReceiptRegistry();
        handler = new SubmissionReceiptRegistryHandler(registry);
    }

    function invariantReceiptStateRemainsLinkedAndBounded() public view {
        for (uint256 index = 0; index < 4; index++) {
            bytes32 receiptId = handler.receiptIdAt(index);
            (
                SubmissionReceiptRegistry.ReceiptStage stage,
                bytes32 latestEventHash,
                bytes32 extensionKeyHash,,
                uint32 eventCount
            ) = registry.getReceipt(receiptId);

            assertTrue(eventCount <= 3);
            if (eventCount == 0) {
                assertEq(
                    uint256(uint8(stage)),
                    uint256(uint8(SubmissionReceiptRegistry.ReceiptStage.None))
                );
                assertEq(latestEventHash, bytes32(0));
                assertEq(extensionKeyHash, bytes32(0));
            } else {
                assertTrue(stage != SubmissionReceiptRegistry.ReceiptStage.None);
                assertTrue(latestEventHash != bytes32(0));
                assertTrue(extensionKeyHash != bytes32(0));
                assertTrue(registry.isAnchored(latestEventHash));
            }
            if (eventCount == 1) {
                assertEq(
                    uint256(uint8(stage)),
                    uint256(uint8(SubmissionReceiptRegistry.ReceiptStage.Attempted))
                );
            }
            if (eventCount == 3) {
                assertTrue(
                    stage == SubmissionReceiptRegistry.ReceiptStage.AuthorityAccepted
                        || stage == SubmissionReceiptRegistry.ReceiptStage.AuthorityRejected
                );
            }
        }
    }

    function invariantSuccessfulEventHashesRemainGloballyUnique() public view {
        uint256 hashCount = handler.successfulHashCount();
        assertTrue(hashCount <= 12);
        for (uint256 index = 0; index < hashCount; index++) {
            bytes32 eventHash = handler.successfulHashAt(index);
            assertTrue(registry.isAnchored(eventHash));
            for (uint256 otherIndex = index + 1; otherIndex < hashCount; otherIndex++) {
                assertTrue(eventHash != handler.successfulHashAt(otherIndex));
            }
        }
    }
}
