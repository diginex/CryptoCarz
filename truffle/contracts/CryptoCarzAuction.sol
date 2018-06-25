pragma solidity 0.4.24;

import "../../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";
import "../../node_modules/openzeppelin-solidity/contracts/token/ERC721/ERC721Receiver.sol";
import "./CryptoCarzToken.sol";
import "./CryptoCarzControl.sol";

/// @title   CryptoCarzAuction
/// @author  Jose Perez - <jose.perez@diginex.com>
/// @notice  Implementation of a uniform price multi-unit auction (a.k.a "clearing price auction").
///          See https://en.wikipedia.org/wiki/Multiunit_auction as reference.
///
///          A fixed number of cars are sold for the same price. Each bidder in the auction can
///          submit one or multiple bids to buy one car token. Bids are public (i.e. not sealed).
///          Participants bid by sending ether to the `bid` function. Participants can top and
///          cancel their bids anytime until the bidding period is ended.
///
///          Once the bidding period ends, the final car price is calculated off-chain (to save gas
///          fees) and set in the contract by the manager account. Winning bidders are those whose
///          total bid amount is equal or greater than car price, whereas the rest of bidders are
///          losing bidders.
///
///          All winning bidders pay a per-unit price equal to the lowest winning bid regardless of
///          their actual bid. Winning bidders must redeem their car tokens and request to transfer
///          any bidden ether amount exceeding the final car price back to their accounts.
///          Losing bidders must request to transfer the bidding amount back to their accounts.
///
///          The manager account can extend the bidding period, pause the auction or cancel it.
/// @dev     The auctioned tokens need to be transferred to the contract before the auction starts.
contract CryptoCarzAuction is ERC721Receiver, CryptoCarzControl {

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
    uint256 public numCarsSold;
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
        require(block.timestamp < biddingEndTime);
        _;
    }

    /// @dev Throws if the current time is not after or at the bidding end time.
    ///      Auction must be initialized.
    modifier afterBiddingEndTime() {
        require(initialized);
        require(block.timestamp >= biddingEndTime);
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

    /// @dev This contract is not supposed to receive Ether except when calling the `bid` function.
    function() external payable {
        revert();
    }

    /// @dev Implementation of ERC721Receiver interface as per EIP-721 specification:
    ///       https://github.com/ethereum/EIPs/blob/master/EIPS/eip-721.md
    /// @param _from The sending address.
    /// @param _tokenId The NFT identifier which is being transfered.
    /// @param _data Additional data with no specified format.
    /// @return `bytes4(keccak256("onERC721Received(address,uint256,bytes)"))`
    function onERC721Received(address _from, uint256 _tokenId, bytes _data) public returns(bytes4) {
        return ERC721_RECEIVED;
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
        require(block.timestamp < _biddingEndTime);
        uint256 duration = _biddingEndTime.sub(block.timestamp);
        require(duration > MIN_AUCTION_PERIOD_SEC);
        require(duration < MAX_AUCTION_PERIOD_SEC);

        uint256 carSeries = token.getCarSeries(_carIds[0]);
        for (uint256 i = 0; i < _carIds.length; i++) {
            // check that the auction contract actually owns the auctioned car tokens
            require(token.ownerOf(_carIds[i]) == address(this));
            if (i > 0) {
                if (carSeries != token.getCarSeries(_carIds[i])) {
                    // all auctioned cars should belong to the same series
                    revert();
                }
            }
        }

        // initialize contract
        carIds = _carIds;
        biddingEndTime = _biddingEndTime;
        initialized = true;

        emit NewAuction(address(this), carIds, biddingEndTime);
    }

    /// @dev Cancels the auction. If an auction is cancelled, no cars are sold and so participants
    ///      can withdraw their bidding amounts. It is possible to cancel an auction only if the
    ///      bidding end time has not yet been reached. This function can be called only if the
    ///      auction was not already cancelled. Only the manager can cancel an auction.
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
        require(_newBiddingEndTime.sub(block.timestamp) <= MAX_AUCTION_PERIOD_SEC);

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
    /// @param _bidder The bidder address from which to return the amount bidden.
    /// @return The current total amount bid by the bidder.
    function getBidAmount(address _bidder) external view returns (uint256) {
        return bids[_bidder];
    }

    /// @dev Setter of the final car price. Only the bidders whose total bid amount is equal or
    ///      higher than the car price can redeem a car. These bidders are so called "auction
    ///      winners", whereas the rest of bidders are "auction losers".
    ///      If the number of auction winners is greater than the number of auctioned cars, the cars
    ///      will be transferred on a first-come first-served basis, that is, the last winners
    ///      to claim their cars will not get them if the cars have already been sold out. In that
    ///      case, those winners can withdraw their bids.
    ///      The number of auction winners can be zero.
    ///      The car price can be set only after the bidding time has finalized.
    ///      Only the manager can call this function.
    ///      Note that `_carPrice` is calculated off-chain. This is done to save gas fees.
    ///      The value of `_carPrice` must always maximize the number of cars sold.
    /// @param _carPrice The price of a car, in ether.
    function setCarPrice(uint256 _carPrice) external afterBiddingEndTime ifNotCancelled onlyManager {
        require(carPrice == 0);
        require(_carPrice > 0);
        require(bidders.length > 0);

        carPrice = _carPrice;
        if (bidders.length < carIds.length) {
            numCarsSold = bidders.length;
        } else {
            numCarsSold = carIds.length;
        }
    }

    /// @dev Getter of the car price.
    /// @return The current car price.
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
    ///      be called only after the bidding end time. The winner himself must call this function
    ///      to redeem his car.
    function redeemCar() external afterBiddingEndTime {
        require(carPrice > 0);
        require(isWinner(msg.sender));
        require(numCarsTransferred < carIds.length);
        require(!carClaimed[msg.sender]);

        // send car to its owner
        carClaimed[msg.sender] = true; // cannot claim more than once
        uint256 carId = carIds[numCarsTransferred];
        numCarsTransferred++;
        token.safeTransferFrom(address(this), msg.sender, carId);

        // return any excess of bidden ether to the bidder
        uint256 bidExcessAmount = bids[msg.sender].sub(carPrice);
        if (bidExcessAmount > 0) {
            msg.sender.transfer(bidExcessAmount);
        }

        emit CarRedeemed(msg.sender, carId, bidExcessAmount);
    }

    /// @dev All bidders can withdraw their bid amounts after the bidding end time.
    ///      Once the final car price has been set, auction losers can withdraw their bid
    ///      amounts after the bidding end time. Also, if a winner cannot redeem a car because cars
    ///      are already sold out (this scenario is possible if number of winners is greater than
    ///      the number of auctioned cars), the winner can also withdraw his bid.
    ///      Optionally, anyone can call this function on behalf of a bidder.
    /// @param _bidder The bidder address.
    function withdrawBid(address _bidder) external afterBiddingEndTime {
        if (isWinner(_bidder)) {
            // allow a winner to withdraw his bidden amount if cars are already sold out
            require(numCarsTransferred >= carIds.length);
            // as far as the winner did not redeem the car yet
            require(!carClaimed[_bidder]);
        }
        uint256 bidAmount = bids[_bidder];
        require(bidAmount > 0);

        bids[_bidder] = 0; // cannot withdraw bids more than once
        _bidder.transfer(bidAmount);

        emit WithdrawBid(_bidder, bidAmount);
    }

    /// @dev Transfer out the any unsold cars back to specific address given by the manager.
    /// @param _to The address to send the unsold cars to.
    function transferUnsoldCars(address _to) internal onlyManager {
        require(_to != address(0));

        uint256 numCars = carIds.length.sub(numCarsSold);
        for (uint256 i = 0; i < numCars; i++) {
            uint256 carId = carIds[numCarsTransferred];
            numCarsTransferred++;
            token.safeTransferFrom(address(this), _to, carId);
        }

        emit ManagerWithdrawCars(_to, numCars);
    }

    /// @dev Transfer out the earnings from the auctioned cars to CryptoCarz's treasurer. Transfer
    //       any cars that were not sold in the auction to manager. This function can be called only
    ///      once after the bidding end time, and only by the manager.
    function withdraw() external afterBiddingEndTime onlyManager {
        require(carPrice > 0);
        require(!withdrawn);
        address treasurer = token.getTreasurer();
        require(treasurer != address(0));

        // transfer ether from sold cars
        uint256 amount = carPrice.mul(numCarsSold);
        treasurer.transfer(amount);

        emit ManagerWithdrawEther(treasurer, amount);

        // transfer unsold cars
        transferUnsoldCars(manager);

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
