pragma solidity 0.4.24;

/// @title   CryptoCarzControl
/// @author  Jose Perez - <jose.perez@diginex.com>
/// @notice  Base contract to provide basic admin account management, pausing and contract
///          upgradeability logics.
/// @dev     This contract is to be inherited by other CryptoCarz contracts enhance them with:
///
///          1- A two-level permission management for better security: `manager` is intended to
///          perform frequent or urgent admin-related functions, which requires to be stored in a
///          hot wallet for practical reasons, whereas `owner` should only be used to sign security-
///          critical and infrequent operations and hence must always be kept off-line.
///
///          2- Pause/unpause setters and events. Pausing is intended to temporarily halt the most
///          important functionalities of the smart contract that inherits `CryptoCarzControl`.
///          Scenarios in which a contract needs to be paused should be rare and might require
///          an urgent action (e.g. an auction was created selling the wrong car tokens). Therefore,
///          the manager should be able to pause, whereas unpausing can only be done by the
///          owner once the issue is solved.
///
///          3- A simple contract upgrading logic. When `newContractAddress` is set, the contract
///          is paused forever. This is intended to disable the most important functionalities of
///          the contract that inherits `CryptoCarzControl`, forcing its users to repoint to the new
///          contract instance in `newContractAddress` instead of the old one.
contract CryptoCarzControl {

    address public owner;
    address public manager;
    bool public paused;
    
    // Address of a new version of the contract. Contract cannot be unpaused if `newContractAddress`
    // is different from 0x0.
    address public newContractAddress;

    event SetOwner(address indexed previousOwner, address indexed newOwner);
    event SetManager(address indexed previousManager, address indexed newManager);
    event Pause();
    event Unpause();
    event ContractUpgrade(address indexed newContractAddress);

    /// @dev Requires to be called by the owner.
    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    /// @dev Requires to be called by the manager.
    modifier onlyManager() {
        require(msg.sender == manager);
        _;
    }

    /// @dev Requires to be called by the owner or by the manager.
    modifier onlyControl() {
        require(
            msg.sender == owner ||
            msg.sender == manager
        );
        _;
    }

    /// @dev Throws if paused.
    modifier ifNotPaused() {
        require(!paused);
        _;
    }

    /// @dev Throws if not paused.
    modifier ifPaused() {
        require(paused);
        _;
    }

    /// @dev CryptoCarzControl constructor function.
    ///      Initializes the owner and manager accounts, which cannot be 0x0.
    ///      Owner and manager accounts must not be the same.
    /// @param _owner The owner account.
    /// @param _manager The manager account.
    constructor(address _owner, address _manager) public {
        require(_owner != address(0));
        require(_manager != address(0));
        require(_owner != _manager);
        owner = _owner;
        manager = _manager;
    }

    /// @dev Owner account setter.
    ///      Owner cannot be 0x0. Only the current owner can change the owner.
    ///      Owner and manager accounts must not be the same.
    /// @param _newOwner The new owner address.
    function setOwner(address _newOwner) external onlyOwner {
        require(_newOwner != address(0));
        require(_newOwner != manager);
        emit SetOwner(owner, _newOwner);
        owner = _newOwner;
    }

    /// @dev Manager account setter.
    ///      Manager cannot be 0x0. Only the current owner can change the manager.
    ///      Owner and manager accounts must not be the same.
    /// @param _newManager The new owner address.
    function setManager(address _newManager) external onlyOwner {
        require(_newManager != address(0));
        require(_newManager != owner);
        emit SetManager(manager, _newManager);
        manager = _newManager;
    }

    /// @dev Sets `paused` to true. It can only be called if not paused already.
    ///      Only control accounts can execute this function.
    function pause() external onlyControl ifNotPaused {
        paused = true;
        emit Pause();
    }

    /// @dev Sets `paused` to false. It can only be called if paused already.
    ///      Only the owner can execute this function.
    function unpause() external onlyOwner ifPaused {
        require(newContractAddress == address(0));
        paused = false;
        emit Unpause();
    }

    /// @dev Sets the address of the new version of the smart contract address. Pauses the contract
    ///      and cannot be unpaused back. The new contract address cannot be 0x0.
    /// @param _newContractAddress The new smart contract version address.
    function upgrade(address _newContractAddress) external onlyOwner ifNotPaused {
        require(_newContractAddress != address(0));
        require(_newContractAddress != address(this));
        newContractAddress = _newContractAddress;
        emit ContractUpgrade(newContractAddress);
        paused = true;
        emit Pause();
    }
}
