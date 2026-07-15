// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title SubmissionReceiptRegistry
/// @notice Anchors privacy-safe, linked SubmittedIt lifecycle event fingerprints.
/// @dev The registry validates structural progression only. Offchain clients remain responsible
///      for recomputing evidence hashes and verifying extension and authority signatures.
contract SubmissionReceiptRegistry {
    /// @notice Contract protocol major version, compatible with SubmittedIt receipt schema 1.x.
    uint16 public constant PROTOCOL_VERSION = 1;

    /// @notice Lifecycle stages shared with the SubmittedIt receipt protocol.
    /// @dev Numeric ordering is fixed: None=0, Attempted=1, SiteConfirmed=2,
    ///      AuthorityAccepted=3, AuthorityRejected=4.
    enum ReceiptStage {
        None,
        Attempted,
        SiteConfirmed,
        AuthorityAccepted,
        AuthorityRejected
    }

    /// @notice Reverts when a caller supplies the zero receipt identifier.
    error ZeroReceiptId();

    /// @notice Reverts when a caller supplies the zero event fingerprint.
    error ZeroEventHash();

    /// @notice Reverts when a caller supplies the zero extension-key fingerprint.
    error ZeroExtensionKeyHash();

    /// @notice Reverts when an event fingerprint was already anchored anywhere in the registry.
    /// @param eventHash The globally duplicated event fingerprint.
    error DuplicateEventHash(bytes32 eventHash);

    /// @notice Reverts when the first event refers to an earlier event.
    /// @param provided The nonzero previous-event fingerprint supplied by the caller.
    error UnexpectedPreviousEventHash(bytes32 provided);

    /// @notice Reverts when a linked event supplies the zero previous-event fingerprint.
    error ZeroPreviousEventHash();

    /// @notice Reverts when a linked event does not refer to the current event tip.
    /// @param expected The receipt's stored latest event fingerprint.
    /// @param provided The previous-event fingerprint supplied by the caller.
    error IncorrectPreviousEventHash(bytes32 expected, bytes32 provided);

    /// @notice Reverts when a receipt does not begin at Attempted.
    /// @param provided The invalid initial lifecycle stage.
    error InvalidInitialStage(ReceiptStage provided);

    /// @notice Reverts when a nonterminal receipt cannot progress to the requested stage.
    /// @param current The receipt's stored lifecycle stage.
    /// @param requested The requested next lifecycle stage.
    error InvalidTransition(ReceiptStage current, ReceiptStage requested);

    /// @notice Reverts when a caller tries to append to an accepted or rejected receipt.
    /// @param current The terminal lifecycle stage.
    error TerminalReceipt(ReceiptStage current);

    /// @notice Reverts when a later event changes the extension-key fingerprint.
    /// @param expected The extension-key fingerprint established by the first event.
    /// @param provided The extension-key fingerprint supplied by the caller.
    error ExtensionKeyMismatch(bytes32 expected, bytes32 provided);

    /// @notice Reverts when an authority outcome lacks an authority-key fingerprint.
    /// @param stage The authority lifecycle stage requiring the fingerprint.
    error MissingAuthorityKeyHash(ReceiptStage stage);

    /// @notice Reverts when a non-authority event includes false authority-key evidence.
    /// @param stage The non-authority lifecycle stage.
    /// @param provided The unexpected authority-key fingerprint.
    error UnexpectedAuthorityKeyHash(ReceiptStage stage, bytes32 provided);

    /// @notice Reverts rather than truncating a timestamp that cannot fit in receipt storage.
    /// @param timestamp The out-of-range block timestamp.
    error TimestampOverflow(uint256 timestamp);

    /// @notice Emitted once for every successfully anchored lifecycle event.
    /// @param receiptId Indexed opaque receipt identifier.
    /// @param eventHash Indexed globally unique event fingerprint.
    /// @param anchoredBy Indexed transaction sender; not a receipt owner or authority identity.
    /// @param previousEventHash Previous linked event fingerprint, or zero for Attempted.
    /// @param extensionKeyHash Fingerprint established by the receipt's first event.
    /// @param authorityKeyHash Authority-key fingerprint for terminal authority events, else zero.
    /// @param stage Newly anchored lifecycle stage.
    /// @param anchoredAt Block timestamp recorded as the onchain anchoring time.
    /// @param eventCount Resulting number of anchored events for the receipt.
    /// @param protocolVersion Registry protocol major version.
    event ReceiptEventAnchored(
        bytes32 indexed receiptId,
        bytes32 indexed eventHash,
        address indexed anchoredBy,
        bytes32 previousEventHash,
        bytes32 extensionKeyHash,
        bytes32 authorityKeyHash,
        ReceiptStage stage,
        uint64 anchoredAt,
        uint32 eventCount,
        uint16 protocolVersion
    );

    /// @notice Compact current state used to enforce future receipt progression.
    /// @dev History remains in ReceiptEventAnchored logs; no unbounded per-receipt array is stored.
    struct ReceiptState {
        bytes32 latestEventHash;
        bytes32 extensionKeyHash;
        uint64 updatedAt;
        uint32 eventCount;
        ReceiptStage currentStage;
    }

    mapping(bytes32 receiptId => ReceiptState state) private _receipts;
    mapping(bytes32 eventHash => bool anchored) private _anchoredEvents;

    /// @notice Anchors one linked lifecycle event fingerprint.
    /// @dev Any address may submit a structurally valid event. The sender is audit metadata only.
    /// @param receiptId Opaque 32-byte receipt identifier.
    /// @param eventHash Keccak-256 fingerprint of the immutable Goal 03 event core.
    /// @param previousEventHash Zero for the first event, otherwise the current event tip.
    /// @param extensionKeyHash Nonzero fingerprint fixed by the first event.
    /// @param authorityKeyHash Nonzero only for AuthorityAccepted or AuthorityRejected.
    /// @param stage Lifecycle stage represented by the supplied event fingerprint.
    function anchorEvent(
        bytes32 receiptId,
        bytes32 eventHash,
        bytes32 previousEventHash,
        bytes32 extensionKeyHash,
        bytes32 authorityKeyHash,
        ReceiptStage stage
    ) external {
        if (receiptId == bytes32(0)) revert ZeroReceiptId();
        if (eventHash == bytes32(0)) revert ZeroEventHash();
        if (extensionKeyHash == bytes32(0)) revert ZeroExtensionKeyHash();
        if (_anchoredEvents[eventHash]) revert DuplicateEventHash(eventHash);

        ReceiptState storage receipt = _receipts[receiptId];
        ReceiptStage currentStage = receipt.currentStage;

        if (currentStage == ReceiptStage.None) {
            if (previousEventHash != bytes32(0)) {
                revert UnexpectedPreviousEventHash(previousEventHash);
            }
            if (stage != ReceiptStage.Attempted) revert InvalidInitialStage(stage);
        } else {
            if (previousEventHash == bytes32(0)) revert ZeroPreviousEventHash();
            if (previousEventHash != receipt.latestEventHash) {
                revert IncorrectPreviousEventHash(receipt.latestEventHash, previousEventHash);
            }
            if (extensionKeyHash != receipt.extensionKeyHash) {
                revert ExtensionKeyMismatch(receipt.extensionKeyHash, extensionKeyHash);
            }
            if (_isTerminal(currentStage)) revert TerminalReceipt(currentStage);
            if (!_isValidTransition(currentStage, stage)) {
                revert InvalidTransition(currentStage, stage);
            }
        }

        _validateAuthorityKey(stage, authorityKeyHash);

        uint64 anchoredAt = _toUint64(block.timestamp);
        uint32 nextEventCount = receipt.eventCount + 1;

        receipt.latestEventHash = eventHash;
        receipt.updatedAt = anchoredAt;
        receipt.eventCount = nextEventCount;
        receipt.currentStage = stage;
        if (currentStage == ReceiptStage.None) receipt.extensionKeyHash = extensionKeyHash;
        _anchoredEvents[eventHash] = true;

        emit ReceiptEventAnchored(
            receiptId,
            eventHash,
            msg.sender,
            previousEventHash,
            extensionKeyHash,
            authorityKeyHash,
            stage,
            anchoredAt,
            nextEventCount,
            PROTOCOL_VERSION
        );
    }

    /// @notice Returns the compact current state for a receipt identifier.
    /// @dev An unknown identifier returns the all-zero state with currentStage None.
    /// @param receiptId Opaque receipt identifier to query.
    /// @return currentStage Current structurally anchored lifecycle stage.
    /// @return latestEventHash Most recently anchored event fingerprint.
    /// @return extensionKeyHash Extension-key fingerprint established by the first event.
    /// @return updatedAt Block timestamp of the latest successful anchor.
    /// @return eventCount Number of successfully anchored events for this receipt.
    function getReceipt(bytes32 receiptId)
        external
        view
        returns (
            ReceiptStage currentStage,
            bytes32 latestEventHash,
            bytes32 extensionKeyHash,
            uint64 updatedAt,
            uint32 eventCount
        )
    {
        ReceiptState storage receipt = _receipts[receiptId];
        return (
            receipt.currentStage,
            receipt.latestEventHash,
            receipt.extensionKeyHash,
            receipt.updatedAt,
            receipt.eventCount
        );
    }

    /// @notice Reports whether an event fingerprint was anchored for any receipt.
    /// @param eventHash Event fingerprint to query.
    /// @return anchored True only after a successful anchor transaction.
    function isAnchored(bytes32 eventHash) external view returns (bool anchored) {
        return _anchoredEvents[eventHash];
    }

    function _validateAuthorityKey(ReceiptStage stage, bytes32 authorityKeyHash) private pure {
        bool isAuthorityStage =
            stage == ReceiptStage.AuthorityAccepted || stage == ReceiptStage.AuthorityRejected;
        if (isAuthorityStage && authorityKeyHash == bytes32(0)) {
            revert MissingAuthorityKeyHash(stage);
        }
        if (!isAuthorityStage && authorityKeyHash != bytes32(0)) {
            revert UnexpectedAuthorityKeyHash(stage, authorityKeyHash);
        }
    }

    function _isTerminal(ReceiptStage stage) private pure returns (bool) {
        return stage == ReceiptStage.AuthorityAccepted || stage == ReceiptStage.AuthorityRejected;
    }

    function _isValidTransition(ReceiptStage current, ReceiptStage requested)
        private
        pure
        returns (bool)
    {
        if (current == ReceiptStage.Attempted) {
            return requested == ReceiptStage.SiteConfirmed
                || requested == ReceiptStage.AuthorityAccepted
                || requested == ReceiptStage.AuthorityRejected;
        }
        if (current == ReceiptStage.SiteConfirmed) {
            return requested == ReceiptStage.AuthorityAccepted
                || requested == ReceiptStage.AuthorityRejected;
        }
        return false;
    }

    function _toUint64(uint256 value) private pure returns (uint64) {
        if (value > type(uint64).max) revert TimestampOverflow(value);
        // The explicit bound above proves this conversion cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(value);
    }
}
