pragma solidity 0.4.24;

import "../../node_modules/openzeppelin-solidity/contracts/token/ERC721/ERC721Token.sol";
import "./CryptoCarzControl.sol";
import "./CryptoCarzAuction.sol";

/// @title   CryptoCarzToken
/// @author  Jose Perez - <jose.perez@diginex.com>
/// @notice  ERC721 implementation of CryptoCarz token.
/// @dev     - Each car token must belong to a series. Each series has a maximum number of cars that
///          can be minted in the series. The number of series that can be created is unlimited and
///          cannot be changed. Only the manager account can create new series and cars.
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

    event CreateSeries(uint256 indexed seriesId, uint256 indexed seriesMaxCars);
    event CreateCars(uint256[] tokenIds, uint256 indexed seriesId);
    event CreateAuction(address contractAddress);

    constructor(address _owner, address _manager)
        CryptoCarzControl(_owner, _manager)
        ERC721Token("CryptoCarz", "CARZ") public {
    }

    /// @dev Creates a new car series. All cars must belong to a series. The number of cars that can
    ///      ever minted within a series is fixed and cannot be changed.
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

    /// @dev Creates new cars and assigns them to an existing series. No new cars can be created
    ///      while the contract is paused. Only the manager can call this function.
    /// @param _tokenIds List of car ids to be created.
    /// @param _seriesId Id of the series the new cars will be assign to.
    function createCars(uint256[] _tokenIds, uint256 _seriesId) external ifNotPaused onlyManager {
        require(seriesMaxCars[_seriesId] > 0);
        for (uint256 i = 0; i < _tokenIds.length; i++) {
            require(carSeries[_tokenIds[i]] == 0);
            _mint(manager, _tokenIds[i]);
            carSeries[_tokenIds[i]] = _seriesId;
        }

        seriesCarCount[_seriesId] += _tokenIds.length;
        require(seriesCarCount[_seriesId] <= seriesMaxCars[_seriesId]);
        emit CreateCars(_tokenIds, _seriesId);
    }

    /// @dev Transfers multiple cars from one address to another.
    /// @param _from The cars current owner's address.
    /// @param _to The address to transfer the cars to.
    /// @param _tokenIds The car ids.
    function transfersFrom(address _from, address _to, uint256[] _tokenIds) external {
        require(_tokenIds.length > 0);
        for (uint256 i = 0; i < _tokenIds.length; i++) {
            transferFrom(_from, _to, _tokenIds[i]);
        }
    }

    /// @dev Factory function that allows the verified creation of CryptoCarzAuction contracts,
    ///      instead of deploying standalone CryptoCarzAuction contracts every time a new auction
    ///      needs to be created, which would require the verification of every new auction contract.
    ///      Only the manager account can create new auction contracts.
    /// @return The new auction contract address.
    function createAuction() external ifNotPaused
        onlyManager returns (address) {

        CryptoCarzAuction auction = new CryptoCarzAuction(owner, manager, address(this));

        emit CreateAuction(auction);
        return auction;
    }
}
