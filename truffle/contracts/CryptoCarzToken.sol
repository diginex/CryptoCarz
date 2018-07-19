pragma solidity 0.4.24;

import "../../node_modules/openzeppelin-solidity/contracts/token/ERC721/ERC721Token.sol";
import "./CryptoCarzControl.sol";
import "./CryptoCarzAuction.sol";

/// @title   CryptoCarzToken
/// @author  Jose Perez - <jose.perez@diginex.com>
/// @notice  ERC721 implementation of CryptoCarz token.
/// @dev     - Each car token must belong to a series. Each series has a maximum number of cars that
///          can be minted in the series. This number cannot be changed. There is not limit in
///          number of series that can be created. Only the manager account can create new series
///          and cars.
///
///          - Cars can be auctioned through a CryptoCarzAuction contract, which can be instantiated
///          by calling the `createAuction` factory function. Only the manager account can create
///          new auctions.
///
///          - The CryptoCarzToken contract can be upgraded by the contract owner.
contract CryptoCarzToken is ERC721Token, CryptoCarzControl {

    mapping(uint256 => uint256) public carSeries;
    mapping(uint256 => uint256) public seriesCarCount;
    uint256[] public seriesMaxCars;

    // Address to which the auction funds will be sent (e.g. a multi-signature wallet belonging
    // to CryptoCarz trusted parties).
    address public treasurer;

    event CreateSeries(uint256 indexed seriesId, uint256 indexed seriesMaxCars);
    event CreateCars(uint256[] tokenIds, uint256 indexed seriesId);
    event CreateAuction(address contractAddress);
    event SetTreasurer(address indexed previousTreasurer, address indexed newTreasurer);
    event SafeTransfersFrom(address indexed from, address indexed to, uint256[] tokenIds);

    /// @dev Overrides ERC721Token's `canTransfer` modifier to check if contract is paused.
    /// @param _tokenId ID of the token to validate
    modifier canTransfer(uint256 _tokenId) {
        require(isApprovedOrOwner(msg.sender, _tokenId));
        require(!paused);
        _;
    }

    /// @dev The treasurer address cannot be 0x0, nor the same as the owner or the manager.
    /// @param _treasurer The new treasurer address.
    modifier checkTreasurer(address _treasurer) {
        require(_treasurer != address(0));
        require(_treasurer != owner);
        require(_treasurer != manager);
        _;
    }

    constructor(address _owner, address _manager, address _treasurer)
        CryptoCarzControl(_owner, _manager)
        ERC721Token("CryptoCarz", "CARZ") public checkTreasurer(_treasurer) {
        treasurer = _treasurer;
    }

    /// @dev Treasurer account setter. Only the owner can change the treasurer.
    /// @param _treasurer The new treasurer address.
    function setTreasurer(address _treasurer) external checkTreasurer(_treasurer) onlyOwner {
        emit SetTreasurer(treasurer, _treasurer);
        treasurer = _treasurer;
    }

    /// @dev Treasurer account getter.
    /// @return Returns the current treasurer address.
    function getTreasurer() external view returns (address) {
        return treasurer;
    }

    /// @dev Creates a new car series. All cars must belong to a series. The number of cars that can
    ///      ever be minted within a series is fixed and cannot be changed.
    ///      No new series can be created while the contract is paused.
    ///      Only the manager can call this function.
    /// @param _seriesMaxCars Maximum number of cars in the series.
    /// @return Returns the new series id.
    function createSeries(uint256 _seriesMaxCars) external ifNotPaused onlyManager returns (uint256) {
        require(_seriesMaxCars > 0);

        uint256 seriesId = seriesMaxCars.length;
        seriesMaxCars.push(_seriesMaxCars);
        emit CreateSeries(seriesId, _seriesMaxCars);
        return seriesId;
    }

    /// @dev Given a car id, it returns the series in which the car belongs.
    /// @param _tokenId The car token id.
    /// @return Returns the series id of the car.
    function getCarSeries(uint256 _tokenId) external view returns(uint256) {
        return carSeries[_tokenId];
    }

    /// @dev Creates new cars and assigns them to an existing series. No new cars can be created
    ///      while the contract is paused. Only the manager can call this function.
    /// @param _tokenIds List of car ids to be created.
    /// @param _seriesId Id of the series the new cars will be assigned to.
    function createCars(uint256[] _tokenIds, uint256 _seriesId) external ifNotPaused onlyManager {
        require(seriesMaxCars[_seriesId] > 0);
        seriesCarCount[_seriesId] += _tokenIds.length;
        require(seriesCarCount[_seriesId] <= seriesMaxCars[_seriesId]);

        for (uint256 i = 0; i < _tokenIds.length; i++) {
            _mint(manager, _tokenIds[i]);
            carSeries[_tokenIds[i]] = _seriesId;
        }

        emit CreateCars(_tokenIds, _seriesId);
    }

    /// @dev Transfers multiple cars from one address to another address.
    /// @param _from The cars current owner's address.
    /// @param _to The address to transfer the cars to.
    /// @param _tokenIds The car ids.
    function safeTransfersFrom(address _from, address _to, uint256[] _tokenIds) external ifNotPaused {
        require(_tokenIds.length > 0);

        for (uint256 i = 0; i < _tokenIds.length; i++) {
            safeTransferFrom(_from, _to, _tokenIds[i]);
        }

        emit SafeTransfersFrom(_from, _to, _tokenIds);
    }

    /// @dev Factory function that allows the verified creation of CryptoCarzAuction contracts,
    ///      instead of deploying standalone CryptoCarzAuction contracts every time a new auction
    ///      needs to be created, which would require the verification of every new auction contract.
    ///      No new auctions can be created while the contract is paused.
    ///      Only the manager account can create new auction contracts.
    /// @return The new auction contract address.
    function createAuction() external ifNotPaused
        onlyManager returns (address) {

        CryptoCarzAuction auction = new CryptoCarzAuction(owner, manager, address(this));

        emit CreateAuction(auction);
        return auction;
    }
}
