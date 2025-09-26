// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

contract PiggyJar is Initializable {
    event Created(address indexed owner, uint256 targetUsd, uint256 thresholdUsd, bytes32 nameHash);

    address public owner;
    uint256 public targetUsd;
    uint256 public thresholdUsd;
    bytes32 public nameHash;

    function initialize(address _owner, uint256 _targetUsd, uint256 _thresholdUsd, string memory _name) external initializer {
        require(_owner != address(0), "owner");
        require(_thresholdUsd > 0 && _thresholdUsd <= _targetUsd, "threshold");
        owner = _owner;
        targetUsd = _targetUsd;
        thresholdUsd = _thresholdUsd;
        nameHash = keccak256(bytes(_name));
        emit Created(_owner, _targetUsd, _thresholdUsd, nameHash);
    }
}
