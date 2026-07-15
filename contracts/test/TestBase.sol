// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IVm {
    function assume(bool condition) external;
    function chainId(uint256 newChainId) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData)
        external;
    function expectEmit(
        bool checkTopic1,
        bool checkTopic2,
        bool checkTopic3,
        bool checkData,
        address emitter
    ) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function warp(uint256 newTimestamp) external;
}

abstract contract TestBase {
    IVm internal constant VM = IVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error AssertionFailed();

    function assertEq(bytes32 actual, bytes32 expected) internal pure {
        if (actual != expected) revert AssertionFailed();
    }

    function assertEq(address actual, address expected) internal pure {
        if (actual != expected) revert AssertionFailed();
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        if (actual != expected) revert AssertionFailed();
    }

    function assertFalse(bool value) internal pure {
        if (value) revert AssertionFailed();
    }

    function assertTrue(bool value) internal pure {
        if (!value) revert AssertionFailed();
    }
}
