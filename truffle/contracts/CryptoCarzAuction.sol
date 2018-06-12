pragma solidity 0.4.23;

import "../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./CryptoCarzToken.sol";
import "./CryptoCarzControl.sol";

contract CryptoCarzAuction is CryptoCarzControl {

    using SafeMath for uint256;

    uint256[] public carIds;
    uint256 public biddingEndTime;
    CryptoCarzToken public token;
    uint256 public maxNumWinners;

    mapping(address => uint256) public bids;
    address[] public bidders;
    uint256[] public sortedBids;
    mapping(address => bool) public winners;
    uint256 public numWinners;
    bool public cancelled;

    uint256 public carPrice;
    bool public carsAssigned = false;
    uint256 public numCarsTransferred = 0;
    mapping(address => bool) public carClaimed;

    // events
    event NewAuction(address indexed auction, uint256[] carIds, uint256 biddingEndTime, uint256 maxNumWinners);
    event Bid(address indexed bidder, uint256 bidAmount, uint256 accumulatedBidAmount);
    event CancelBid(address indexed bidder, uint256 bidAmount);
    event Withdraw(address indexed bidder, uint256 bidAmount);
    event CarRedeemed(address indexed redeemer, uint256 indexed carId);
    event AuctionExtended(uint256 biddingEndTime);
    event AuctionCancelled();
    
    
    // modifiers
    modifier beforeBiddingEndTime() {
        require(now < biddingEndTime);
        _;
    }

    modifier afterBiddingEndTime() {
        require(now >= biddingEndTime);
        _;
    }

    modifier ifNotCancelled() {
        require(!cancelled);
        _;
    }

    modifier ifCancelled() {
        require(cancelled);
        _;
    }    

    // functions
    function CryptoCarzAuction(address _owner, address _manager, address _token, uint256[] _carIds, uint256 _biddingPeriod, uint256 _maxNumWinners)
        CryptoCarzControl(_owner, _manager) public {
        token = CryptoCarzToken(_token);
        carIds = _carIds;
        biddingEndTime = now + _biddingPeriod;
        maxNumWinners = _maxNumWinners;
        emit NewAuction(address(this), _carIds, biddingEndTime, maxNumWinners);
    }

    function extendAuction(uint256 _extraBiddingTime) external onlyManager beforeBiddingEndTime ifNotCancelled {
        biddingEndTime += _extraBiddingTime;
        emit AuctionExtended(biddingEndTime);
    }

    function cancelAuction() external onlyManager ifNotCancelled {
        cancelled = true;
        emit AuctionCancelled();
    }    

    function bid() external payable beforeBiddingEndTime ifNotCancelled ifNotPaused {
        uint256 currentAmount = bids[msg.sender];
        bids[msg.sender] = currentAmount.add(msg.value);
        if (currentAmount == 0) {
            bidders.push(msg.sender);
        }
        emit Bid(msg.sender, msg.value, bids[msg.sender]);
    }

    function getCarIds() external view returns (uint256[]) {
        return carIds;
    }

    function getBidders() external view returns (address[]) {
        return bidders;
    }

    function getBidderAmount(address _bidder) external view returns (uint256) {
        return bids[_bidder];
    }

    function setCarPrice(uint256 _carPrice) external afterBiddingEndTime onlyManager {
        carPrice = _carPrice;
    }  

    function getCarPrice() external view returns (uint256) {
        return carPrice;
    }    
    
    function isWinner(address _bidder) public view afterBiddingEndTime returns (bool) {
        require(carPrice > 0);
        require(bids[_bidder] > 0);
        return bids[_bidder] >= carPrice;
    }
        
    function redeemCar() external afterBiddingEndTime {
        require(numCarsTransferred < carIds.length);
        require(!carClaimed[msg.sender]);
        require(isWinner(msg.sender));
        uint carId = carIds[numCarsTransferred];

        carClaimed[msg.sender] = true;
        numCarsTransferred++;
        token.transferFrom(address(this), msg.sender, carId);
        emit CarRedeemed(msg.sender, carId);
    }

    function cancelBid() external beforeBiddingEndTime {
        uint256 bidAmount = bids[msg.sender];
        require(bidAmount > 0);
        bids[msg.sender] = 0;
        msg.sender.transfer(bidAmount);
        emit CancelBid(msg.sender, bidAmount);
    }

    function withdraw() external afterBiddingEndTime {
        require(!isWinner(msg.sender));
        uint256 bidAmount = bids[msg.sender];
        require(bidAmount > 0);
        bids[msg.sender] = 0;
        msg.sender.transfer(bidAmount);
        emit Withdraw(msg.sender, bidAmount);
    }

}

