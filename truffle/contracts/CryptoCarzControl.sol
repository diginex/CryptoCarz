pragma solidity 0.4.23;

contract CryptoCarzControl {

    address public owner;
    address public manager;
    bool public paused = false;

    event SetOwner(address indexed previousOwner, address indexed newOwner);
    event SetManager(address indexed previousManager, address indexed newManager);
    event Pause();
    event Unpause();

    // control access

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    modifier onlyManager() {
        require(msg.sender == manager);
        _;
    }

    modifier onlyControl() {
        require(
            msg.sender == owner ||
            msg.sender == manager
        );
        _;
    }

    function CryptoCarzControl(address _owner, address _manager) public {
        require(_owner != address(0));
        require(_manager != address(0));
        owner = _owner;
        manager = _manager;
    }

    function setOwner(address _newOwner) external onlyOwner {
        require(_newOwner != address(0));
        SetOwner(owner, _newOwner);
        owner = _newOwner;
    }

    function setManager(address _newManager) external onlyOwner {
        require(_newManager != address(0));
        SetManager(manager, _newManager);
        manager = _newManager;
    }

    // pausing

    modifier ifNotPaused() {
        require(!paused);
        _;
    }

    modifier ifPaused() {
        require(paused);
        _;
    }

    function pause() external onlyControl ifNotPaused {
        paused = true;
        emit Pause();
    }

    function unpause() external onlyOwner ifPaused {
        paused = false;
        emit Unpause();
    }
}