pragma solidity 0.4.24;

import "../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./CryptoCarzToken.sol";
import "./CryptoCarzControl.sol";

/// @title   CryptoCarzAuction
/// @author  Jose Perez - <jose.perez@diginex.com>
/// @notice  Implementation of a uniform price multi-unit auction (a.k.a "clearing price auction").
///          See https://en.wikipedia.org/wiki/Multiunit_auction as reference.
///
///          A fixed number of cars are sold for the same price. Each bidder in the auction can
///          submit one or multiple bids to buy one car token. Bids are public (i.e. not sealed).
///          Participants bid by sending ether to `bid` function. Participants can top and cancel
///          their bids anytime until the bidding period is ended.
///
///          Once the bidding period ends, the final car prize is calculated off-chain (to save gas
///          fees) and set in the contract by the manager account. Winning bidders are those whose
///          total bid amount is equal or greater than car prize, whereas the rest of bidders are
///          losing bidders.
///
///          All winning bidders pay a per-unit price equal to the lowest winning bid regardless of
///          their actual bid. Winning bidders must redeem their car tokens and request to transfer
///          any bidden ether amount exceding the final car prize back to their accounts.
///          Losing bidders must request to transfer the bidding amount back to their accounts.
///
///          The manager account can extend the bidding period, pause the auction or cancel it.
/// @dev     The auctioned tokens need to be transferred to the contract before the auction starts.
contract CryptoCarzAuction is CryptoCarzControl {

    using SafeMath for uint256;

    // Prevent to accidentally create or extend auctions for too short or too long periods.
    uint256 public constant MIN_AUCTION_PERIOD_SEC = 60;
    uint256 public constant MAX_AUCTION_PERIOD_SEC = 3600 * 24 * 30;

    CryptoCarzToken public token;
    uint256[] public carIds;
    uint256 public biddingEndTime;
    bool public initialized;
    bool public cancelled;

    mapping(address => uint256) public bids;
    address[] public bidders;
    uint256 public carPrice;
    uint256 public numWinners;
    mapping(address => bool) public carClaimed;
    uint256 public numCarsTransferred;
    bool public withdrawn;

    event NewAuction(address indexed auction, uint256[] carIds, uint256 biddingEndTime);
    event AuctionStarted();
    event Bid(address indexed bidder, uint256 bidAmount, uint256 accumulatedBidAmount);
    event CancelBid(address indexed bidder, uint256 bidAmount);
    event CarRedeemed(address indexed redeemer, uint256 indexed carId, uint256 bidExcessAmount);
    event WithdrawBid(address indexed withdrawer, uint256 bidAmount);
    event ManagerWithdrawEther(address indexed etherTo, uint256 amount);
    event ManagerWithdrawCars(address indexed carsTo, uint256 numCars);
    event AuctionExtended(uint256 biddingEndTime);
    event AuctionCancelled();
    
    
    /// @dev Throws if the current time is not before the bidding end time.
    ///      Auction must be initialized.
    modifier beforeBiddingEndTime() {
        require(initialized);
        require(now < biddingEndTime);
        _;
    }

    /// @dev Throws if the current time is not after or at the bidding end time.
    ///      Auction must be initialized.
    modifier afterBiddingEndTime() {
        require(initialized);
        require(now >= biddingEndTime);
        _;
    }

    /// @dev Throws if the auction was cancelled.
    modifier ifNotCancelled() {
        require(!cancelled);
        _;
    }

    /// @dev The auction constructor function.
    /// @param _owner The contract owner.
    /// @param _manager The contract _manager.
    /// @param _token The address of the CryptoCarzToken contract where the car tokens to be
    ///         auctioned are stored in.
    constructor(address _owner, address _manager, address _token)
        CryptoCarzControl(_owner, _manager) public {

        require(_token != address(0));
        token = CryptoCarzToken(_token);
    }

    /// @dev Starts the auction. Performs necessary preliminary checks before allowing bidding and
    ///      bid cancellations:
    ///      1- Check that auction contract actually owns the auctioned car tokens.
    ///      2- Duration of the auction is within defined limits.
    /// @param _carIds The ids of the cars to be auctioned.
    /// @param _biddingEndTime Until when participants are allowed to bids, in seconds since Unix
    ///        epoch.
    function newAuction(uint256[] _carIds, uint256 _biddingEndTime)
        external onlyManager ifNotCancelled {

        // contract can only be initialized once
        require(!initialized);

        // input validations
        require(_carIds.length > 0);
        require(now < _biddingEndTime);
        uint256 duration = _biddingEndTime.sub(now);
        require(duration > MIN_AUCTION_PERIOD_SEC);
        require(duration < MAX_AUCTION_PERIOD_SEC);

        // check that the auction contract actually owns the auctioned car tokens.
        for (uint256 i = 0; i < carIds.length; i++) {
            require(token.ownerOf(carIds[i]) == address(this));
        }

        // initialize contract
        carIds = _carIds;
        biddingEndTime = _biddingEndTime;
        initialized = true;

        emit NewAuction(address(this), carIds, biddingEndTime);
    }

    /// @dev Cancels the auction. If an auction is cancelled, no cars are sold and so participants
    ///      can withdraw their bidding amounts. It is possible to cancel an auction only if the
    ///      bidding end time has not yet been reached. Only the manager can cancel an auction.
    function cancelAuction() external onlyManager beforeBiddingEndTime ifNotCancelled {
        transferUnsoldCars(manager);

        cancelled = true;

        emit AuctionCancelled();
    }

    /// @dev Extends the auction's bidding end time. It is possible to extend an auction only if the
    ///      the auction has not been cancelled and if the bidding end time has not yet been reached.
    ///      Only the manager can extend an auction.
    /// @param _newBiddingEndTime The new bidding end time, in seconds.
    function extendAuction(uint256 _newBiddingEndTime) external onlyManager 
        beforeBiddingEndTime ifNotCancelled {

        require(_newBiddingEndTime > biddingEndTime);
        require(_newBiddingEndTime.sub(now) <= MAX_AUCTION_PERIOD_SEC);

        biddingEndTime = _newBiddingEndTime;

        emit AuctionExtended(biddingEndTime);
    }

    /// @dev Auction participants can bid by sending ether to this function. It is possible to bid
    ///      only if the auction has not been cancelled or paused and if the bidding end time has
    ///      not yet been reached. Cannot bid zero ether.
    function bid() external payable beforeBiddingEndTime ifNotCancelled ifNotPaused {
        require(msg.value > 0);

        uint256 currentAmount = bids[msg.sender];
        bids[msg.sender] = currentAmount.add(msg.value);
        if (currentAmount == 0) {
            bidders.push(msg.sender);
        }

        emit Bid(msg.sender, msg.value, bids[msg.sender]);
    }

    /// @dev Cancel the current bid. By calling this function, the participants gets his bidden
    ///      ether back. It is possible to cancel a bid only if the bidding end time has not yet
    ///      been reached.
    function cancelBid() external beforeBiddingEndTime {
        uint256 bidAmount = bids[msg.sender];
        require(bidAmount > 0);

        bids[msg.sender] = 0;
        msg.sender.transfer(bidAmount);

        emit CancelBid(msg.sender, bidAmount);
    }

    /// @dev Returns the ids of the cars to be auctioned.
    /// @return The car ids.
    function getCarIds() external view returns (uint256[]) {
        return carIds;
    }

    /// @dev Returns the auction participant addresses.
    /// @return The list of bidders.
    function getBidders() external view returns (address[]) {
        return bidders;
    }

    /// @dev Returns the amount bid by a participant.
    /// @return The current total amount bid by the bidder.
    function getBidAmount(address _bidder) external view returns (uint256) {
        return bids[_bidder];
    }

    /// @dev Setter of the final car prize. Only the bidders whose total bid amount is equal or
    ///      higher than the car prize can redeem a car. These bidders are so called "auction
    ///      winners", whereas the rest of bidders are "auction losers".
    ///      If the number of auction winners is greater than the number of auctioned cars, they
    ///      will be transferred to th winners on a first-come first-served basis.
    ///      The number of auction winners can be zero.
    ///      The car prize can be set only after the bidding time has finalized.
    ///      Only the manager can call this function.
    ///      Note that the car prize is calculated off-chain. This is done to save gas fees.
    /// @param _carPrice The price of a car, in ether.
    function setCarPrice(uint256 _carPrice) external afterBiddingEndTime ifNotCancelled onlyManager {
        require(carPrice == 0);
        require(_carPrice > 0);
        require(bidders.length > 0);

        // Calculate number of winners for the given car price.
        carPrice = _carPrice;
        for (uint256 i = 0; i < bidders.length; i++) {
            if (bids[bidders[i]] >= carPrice) {
                numWinners++;
            }
        }
    }

    /// @dev Getter of the final car prize.
    /// @return The car prize.
    function getCarPrice() external view returns (uint256) {
        return carPrice;
    }

    /// @dev Returns whether or not a given address is an auction bidding winner. This function can
    ///      be called only after the bidding end time.
    ///      It should be possible for anyone to call this function.
    /// @param _bidder The bidder address to check.
    /// @return Whether or not the bidder is a winner.
    function isWinner(address _bidder) public view afterBiddingEndTime returns (bool) {
        // Consider that no bidders are auction winners if `carPrice` has not been set yet:
        if (carPrice == 0) {
            return false;
        }
        // Otherwise, auction winners are those bidders whose total bid amount is equal or higher
        // than the auction car price:
        return bids[_bidder] >= carPrice;
    }

    /// @dev Transfers one of the auctioned cars to its rightful bidding winner. This function can
    ///      be called only after the bidding end time.
    ///      Optionally, anyone can call this function on behalf of the bidder (e.g. an account
    ///      belonging to CryptoCarz, so that the bidder does not need to redeem the car himself).
    /// @param _bidder The bidder address.
    function redeemCar(address _bidder) external afterBiddingEndTime {
        require(carPrice > 0);
        require(isWinner(_bidder));
        require(numCarsTransferred < carIds.length);
        require(!carClaimed[_bidder]);

        // send car to its owner
        carClaimed[_bidder] = true; // cannot claim more than once
        uint256 carId = carIds[numCarsTransferred];
        numCarsTransferred++;
        token.transferFrom(address(this), _bidder, carId);

        // return any excess of bidden ether to the bidder
        uint256 bidExcessAmount = bids[_bidder].sub(carPrice);
        _bidder.transfer(bidExcessAmount);

        emit CarRedeemed(_bidder, carId, bidExcessAmount);
    }

    /// @dev All bidders can withdraw their bid amounts after the bidding end time.
    ///      Once the final car prize has been set, only auction losers can withdraw their bid
    ///      amounts after the bidding end time.
    ///      Only the bidders themselves can call this function on their behalf.
    function withdrawBid() external afterBiddingEndTime {
        require(!isWinner(msg.sender));
        uint256 bidAmount = bids[msg.sender];
        require(bidAmount > 0);

        bids[msg.sender] = 0; // cannot withdraw bids more than once
        msg.sender.transfer(bidAmount);

        emit WithdrawBid(msg.sender, bidAmount);
    }

    /// @dev Transfer out the any unsold cars back to specific address given by the manager.
    /// @param _to The address to send the unsold cars to.
    function transferUnsoldCars(address _to) internal onlyManager {
        require(_to != address(0));

        uint256 numCars = carIds.length.sub(numWinners);
        for (uint256 i = 0; i < numCars; i++) {
            uint256 carId = carIds[numCarsTransferred];
            numCarsTransferred++;
            token.transferFrom(address(this), _to, carId);
        }

        emit ManagerWithdrawCars(_to, numCars);
    }

    /// @dev Transfer out the earnings from the auctioned cars to a specific address. Also, transfer
    //       any cars that were not sold in the auction. This function can be called only once after
    ///      the bidding end time, and only by the manager.
    /// @param _etherTo The address to send the ether to.
    /// @param _carsTo The address to send the unsold cars to.
    function withdraw(address _etherTo, address _carsTo) external afterBiddingEndTime onlyManager {
        require(carPrice > 0);
        require(!withdrawn);
        require(_etherTo != address(0));
        require(_carsTo != address(0));

        // transfer ether from sold cars
        uint256 amount = carPrice.mul(numWinners);
        _etherTo.transfer(amount);

        emit ManagerWithdrawEther(_etherTo, amount);

        // transfer unsold cars
        transferUnsoldCars(_carsTo);

        withdrawn = true; // cannot withdraw more than once
    }

    /// @dev Only the owner can destroy the auction contract, and only if no ether or cars are
    ///      stored in the contract.
    function destroy() external onlyOwner {
        require(address(this).balance == 0);
        require(numCarsTransferred == carIds.length);
        selfdestruct(owner);
    }
}
