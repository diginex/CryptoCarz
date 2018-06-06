pragma solidity 0.4.21;

import "../ERC721Token.sol";
import "./CryptoCarzControl.sol";

contract CryptoCarzToken is ERC721Token, CryptoCarzControl {

    mapping(uint256 => uint256) public tokenSeries;
    mapping(uint256 => uint256) public seriesTokensCount;
    uint256[] public seriesMaxTokens;

    event CreateSeries(uint256 indexed seriesId, uint256 indexed seriesMaxTokens);
    event MintTokens(uint256[] tokenIds, uint256 indexed seriesId);

    function CryptoCarzToken(address _owner, address _manager)
        CryptoCarzControl(_owner, _manager)
        ERC721Token("CryptoCarz", "CARZ") public {
    }

    function totalSeries() public view returns(uint256) {
        return seriesMaxTokens.length;
    }

    function getSeriesMaxTokens(uint256 _seriesId) external view returns(uint256) {
        return seriesMaxTokens[_seriesId];
    }

    function createSeries(uint256 _seriesMaxTokens) external ifNotPaused onlyManager returns (uint256) {
        require(_seriesMaxTokens > 0);
        seriesMaxTokens.push(_seriesMaxTokens);
        emit CreateSeries(seriesMaxTokens.length - 1, _seriesMaxTokens);
        return seriesMaxTokens.length - 1;
    }

    function mintTokens(uint256[] _tokenIds, uint256 _seriesId) external ifNotPaused onlyManager {
        require(seriesMaxTokens[_seriesId] > 0);
        for (uint256 i = 0; i < _tokenIds.length; i++) {
            _mint(msg.sender, _tokenIds[i]);
            tokenSeries[_tokenIds[i]] = _seriesId;
            seriesTokensCount[_seriesId]++;
        }
        require(seriesTokensCount[_seriesId] <= seriesMaxTokens[_seriesId]);
        emit MintTokens(_tokenIds, _seriesId);
    }

    function transfersFrom(address _from, address _to, uint256[] _tokenIds) external ifNotPaused {
        require(_tokenIds.length > 0);
        for (uint256 i = 0; i < _tokenIds.length; i++) {
            transferFrom(_from, _to, _tokenIds[i]);
        }
    }
}
