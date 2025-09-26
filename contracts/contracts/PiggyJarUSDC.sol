// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PiggyJarUSDC is ReentrancyGuard {
    using SafeERC20 for IERC20;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Broken(address indexed to, uint256 amount);
    event TargetSet(uint256 targetAmount);
    event Filled(uint256 totalDeposited);
    event ScheduleSet(uint8 period, uint256 recurringAmount);

    address public immutable owner;
    IERC20 public immutable token; // USDC or similar
    string public name; // jar name

    // Savings goal and progress (in token's smallest units)
    uint256 public targetAmount;      // optional; 0 means no cap
    uint256 public totalDeposited;    // cumulative deposited amount
    bool public filled;               // true once target reached

    // Optional scheduling meta (UI/off-chain automation hint)
    // period: 0=Daily, 1=Weekly, 2=Monthly
    uint8 public period;              // default 0 (Daily) unless set
    uint256 public recurringAmount;   // suggested per-period deposit amount

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _owner, address _token, string memory _name, uint8 _period, uint256 _recurringAmount, uint256 _targetAmount) {
        require(_owner != address(0), "owner");
        require(_token != address(0), "token");
        require(_period <= 2, "period");
        owner = _owner;
        token = IERC20(_token);
        name = _name;
        // initialize schedule
        period = _period;
        recurringAmount = _recurringAmount;
        emit ScheduleSet(_period, _recurringAmount);
        // optional target
        if (_targetAmount > 0) {
            targetAmount = _targetAmount;
            emit TargetSet(_targetAmount);
        }
    }

    // One-time setter to define a target cap after deployment if desired.
    function setTargetAmount(uint256 amount) external onlyOwner {
        require(targetAmount == 0, "target already set");
        require(amount > 0, "target");
        targetAmount = amount;
        emit TargetSet(amount);
    }

    // Set or update schedule meta used by the dApp/agents to automate deposits off-chain.
    // period: 0=Daily, 1=Weekly, 2=Monthly
    function setSchedule(uint8 _period, uint256 _recurringAmount) external onlyOwner {
        require(_period <= 2, "period");
        // _recurringAmount can be zero to clear the schedule
        period = _period;
        recurringAmount = _recurringAmount;
        emit ScheduleSet(_period, _recurringAmount);
    }

    function deposit(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "amount");
        if (targetAmount > 0) {
            require(!filled, "filled");
            uint256 remaining = targetAmount - totalDeposited;
            require(amount <= remaining, "exceeds target");
        }

        token.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);

        if (targetAmount > 0 && totalDeposited == targetAmount) {
            filled = true;
            emit Filled(totalDeposited);
        }
    }

    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "amount");
        uint256 bal = token.balanceOf(address(this));
        require(bal >= amount, "insufficient balance");
        token.safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
    }

    function breakJar() external onlyOwner nonReentrant {
        uint256 bal = token.balanceOf(address(this));
        token.safeTransfer(owner, bal);
        emit Broken(owner, bal);
    }

    function balance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
