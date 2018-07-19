pragma solidity 0.4.24;

import "./CryptoCarzAuction.sol";

contract CryptoCarzAuctionMock is CryptoCarzAuction {

    constructor(address _owner, address _manager, address _token)
        CryptoCarzAuction(_owner, _manager, _token) public {

        SAFETY_TIMEOUT_BLOCKS = 10;
    }
}
