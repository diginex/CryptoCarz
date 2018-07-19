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
///          Once the bidding period ends, the car price needs to be set by calling the function
///          `setCarPrice()`. Then, the car price needs to be validated by calling the function
///          `validateCarPrice()`. Depending on the number of bids, this validation process may
///          require more gas than the block gas limit and therefore more than one call to the
///          function will be needed to fully validate the price.
///
///          Winners and losers can redeem their cars and withdraw their bids, respectively, after
///          the car price has been validated. To prevent user's funds to be stuck in the case of
///          an unexpected issue (e.g. `owner` account being compromised, all bidders will always be
///          able to withdraw their bids after a timeout period.
contract CryptoCarzAuction is ERC721Receiver, CryptoCarzControl {

    using SafeMath for uint256;

    // Prevent to accidentally create or extend auctions for too short or too long periods.
    uint256 private constant AVERAGE_BLOCK_TIME_SEC = 15;
    uint256 public constant MIN_AUCTION_PERIOD_BLOCKS = 60 / AVERAGE_BLOCK_TIME_SEC;
    uint256 public constant MAX_AUCTION_PERIOD_BLOCKS = 3600 * 24 * 30 / AVERAGE_BLOCK_TIME_SEC;

    // Maximum number of iterations during validation.
    uint256 public constant DEFAULT_MAX_ITER = 500;

    // As a safeguard mechanism, bidders can always transfer their bidden funds back after a safety
    // timeout period if the car price was not set.
    uint256 public SAFETY_TIMEOUT_BLOCKS = 3600 * 24 / AVERAGE_BLOCK_TIME_SEC;

    CryptoCarzToken public token;
    uint256[] public carIds;
    uint256 public biddingEndBlockNumber;
    bool public initialized;
    bool public cancelled;

    mapping(address => uint256) public bids;
    address[] public bidders;
    uint256 public carPrice;
    bool public carPriceValidated;
    uint256 public numCarsSold;
    uint256 public lastCheckedBidderIndex;
    uint256 public numWinnersCounted;
    uint256 public maxIter;
    mapping(address => bool) public carClaimed;
    uint256 public numCarsTransferred;
    bool public withdrawn;

    event NewAuction(address indexed auction, uint256[] carIds, uint256 biddingEndBlockNumber);
    event AuctionStarted();
    event Bid(address indexed bidder, uint256 bidAmount, uint256 accumulatedBidAmount);
    event CancelBid(address indexed bidder, uint256 bidAmount);
    event CarPrice(uint256 carPrice);
    event CarRedeemed(address indexed redeemer, uint256 indexed carId, uint256 bidExcessAmount);
    event WithdrawBid(address indexed withdrawer, uint256 bidAmount);
    event ManagerWithdrawEther(address indexed etherTo, uint256 amount);
    event ManagerWithdrawCars(address indexed carsTo, uint256 numCars);
    event AuctionExtended(uint256 biddingEndBlockNumber);
    event AuctionCancelled();

    /// @dev Throws if the auction has ended.
    ///      Auction must be initialized.
    modifier ifNotEnded() {
        require(initialized);
        require(block.number < biddingEndBlockNumber);
        _;
    }

    /// @dev Throws if the auction hasn't ended.
    ///      Auction must be initialized.
    modifier ifEnded() {
        require(initialized);
        require(block.number >= biddingEndBlockNumber);
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
        maxIter = DEFAULT_MAX_ITER;
    }

    /// @dev This contract is not supposed to receive Ether except when calling the `bid` function.
    function() external payable {
        revert();
    }

    /// @dev Implementation of ERC721Receiver interface as per EIP-721 specification:
    ///       https://github.com/ethereum/EIPs/blob/master/EIPS/eip-721.md
    /// @param _from The sending address.
    /// @param _tokenId The NFT identifier which is being transferred.
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
    /// @param _biddingEndBlockNumber Until when participants are allowed to bid, in absolute block
    ///        number.
    function newAuction(uint256[] _carIds, uint256 _biddingEndBlockNumber)
        external onlyManager ifNotCancelled {

        // contract can only be initialized once
        require(!initialized);

        // input validations
        require(_carIds.length > 0);
        require(block.number < _biddingEndBlockNumber);
        uint256 duration = _biddingEndBlockNumber.sub(block.number);
        require(duration >= MIN_AUCTION_PERIOD_BLOCKS);
        require(duration <= MAX_AUCTION_PERIOD_BLOCKS);

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
        biddingEndBlockNumber = _biddingEndBlockNumber;
        initialized = true;

        emit NewAuction(address(this), carIds, biddingEndBlockNumber);
    }

    /// @dev Cancels the auction. If an auction is cancelled, no cars are sold and so participants
    ///      can withdraw their bidding amounts. It is possible to cancel an auction only if the
    ///      bidding end block number has not yet been reached. This function can be called only if
    ///      the auction was not already cancelled. Only the manager can cancel an auction.
    function cancelAuction() external onlyManager ifNotEnded ifNotCancelled {
        cancelled = true;
        transferUnsoldCars(manager);

        emit AuctionCancelled();
    }

    /// @dev Extends the auction's bidding end block number. It is possible to extend an auction only
    ///      if the auction has not been cancelled and if the bidding end block number has not yet been
    ///      reached. Only the manager can extend an auction.
    /// @param _newBiddingEndBlockNumber The new bidding end block number, in absolute block number.
    function extendAuction(uint256 _newBiddingEndBlockNumber) external onlyManager
        ifNotEnded ifNotCancelled {

        require(_newBiddingEndBlockNumber > biddingEndBlockNumber);
        require(_newBiddingEndBlockNumber.sub(block.number) <= MAX_AUCTION_PERIOD_BLOCKS);

        biddingEndBlockNumber = _newBiddingEndBlockNumber;

        emit AuctionExtended(biddingEndBlockNumber);
    }

    /// @dev Auction participants can bid by sending ether to this function. It is possible to bid
    ///      only if the auction has not been cancelled or paused and if the bidding end block number
    ///      has not yet been reached. Cannot bid zero ether.
    function bid() external payable ifNotEnded ifNotCancelled ifNotPaused {
        require(msg.value > 0);

        uint256 currentAmount = bids[msg.sender];
        bids[msg.sender] = currentAmount.add(msg.value);
        if (currentAmount == 0) {
            bidders.push(msg.sender);
        }

        emit Bid(msg.sender, msg.value, bids[msg.sender]);
    }

    /// @dev Cancel the current bid. By calling this function, the participants gets his bidden
    ///      ether back. It is possible to cancel a bid only if the bidding end block number has not
    ///      yet been reached.
    function cancelBid() external ifNotEnded {
        uint256 bidAmount = bids[msg.sender];
        require(bidAmount > 0);

        bids[msg.sender] = 0; // prevent re-entrancy attack
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

    /// @dev Sets the maximum number of iterations in `validateCarPrice()` validation loop.
    ///      The new number of iterations cannot be zero or equal to the current one.
    /// @param _maxIter The new maximum number of iterations.
    function setMaxIter(uint256 _maxIter) external onlyManager {
        require(_maxIter > 0);
        require(_maxIter != maxIter);
        maxIter = _maxIter;
    }

    /// @dev Setter of the final car price. Only the bidders whose total bid amount is equal or
    ///      higher than the car price can redeem a car. These bidders are so called "auction
    ///      winners", whereas the rest of bidders are "auction losers".
    ///      If the number of auction winners is greater than the number of auctioned cars, the cars
    ///      will be transferred on a first-come first-served basis, that is, the last winners
    ///      to claim their cars will not get them if the cars have already been sold out. In that
    ///      case, those winners can withdraw their bids.
    ///      The car price can be set only after the bidding end block number has finalized, and only
    ///      by the manager.
    ///
    ///      Note that `_carPrice` is calculated off-chain. This is done to save gas fees.
    ///      After being set, the car price needs to be validated before winners redeem their cars,
    ///      losers withdraw their bids, and manager withdraw the auction profits. This is to
    ///      prevent the manager to choose a car price that maximizes his gains at the expense of
    ///      the bidders. The car price cannot be changed once it is validated. The car price
    ///      can be set until SAFETY_TIMEOUT_BLOCKS is reached.
    /// @param _carPrice The price of a car, in ether.
    function setCarPrice(uint256 _carPrice) external ifEnded ifNotCancelled onlyManager {
        require(_carPrice > 0);
        require(carPrice != _carPrice);
        require(bidders.length > 0);
        require(block.number.sub(biddingEndBlockNumber) < SAFETY_TIMEOUT_BLOCKS);
        require(!carPriceValidated);

        carPrice = _carPrice;
        numWinnersCounted = 0;
        lastCheckedBidderIndex = 0;

        if (bidders.length <= carIds.length) {
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

    /// @dev Car price validation check to prevent the manager to "game" the car price on his favour.
    ///      Example: 2 cars to be sold at the auction.
    ///      - Bidder A bids 1000 ether
    ///      - Bidder B bids 10 ether
    ///      - Bidder C bids 9 ether
    ///      Manager should set the car price to 10, selling the 2 cars with a profit of 20 ether.
    ///      Instead, he sets the car price to 1000, selling only 1 car with a profit of 1000 ether.
    ///      The validation check prevents this scenario to happen ensuring that the number of
    //       winners is always >= number of cars to be sold.
    ///
    ///      To prevent being unable to run the validation check due to block gas limit reached, the
    ///      function can be called several times in different blocks each time, if needed.
    ///      Worst case complexity is O(n), which is always equal or better than sorting the bids
    ///      regardless of the sorting algorithm used.
    /// @return Whether or not the car price has been successfully validated.
    function validateCarPrice() external ifEnded ifNotCancelled onlyManager
        returns (bool) {

        require(carPrice > 0);
        require(!carPriceValidated);

        uint256 maxCheckedBidderIndex = lastCheckedBidderIndex.add(maxIter);
        if (maxCheckedBidderIndex >= bidders.length) {
            maxCheckedBidderIndex = bidders.length - 1;
        }

        // the car price must be such that number of winners >= numCarsSold
        while(lastCheckedBidderIndex <= maxCheckedBidderIndex) {
            if (bids[bidders[lastCheckedBidderIndex]] >= carPrice) {
                numWinnersCounted++;
                if (numWinnersCounted == numCarsSold) {
                    carPriceValidated = true;
                    break; // no need to continue further, save gas
                }
            }
            lastCheckedBidderIndex++;
        }

        if(carPriceValidated) {
            emit CarPrice(carPrice);
        }
        return carPriceValidated;
    }

    /// @dev Returns whether or not a given address is an auction bidding winner. This function can
    ///      be called only after the bidding end block number.
    ///      It should be possible for anyone to call this function.
    /// @param _bidder The bidder address to check.
    /// @return Whether or not the bidder is a winner.
    function isWinner(address _bidder) public view ifEnded returns (bool) {
        // Consider that no bidders are auction winners if `carPrice` has not been set yet:
        if (!carPriceValidated) {
            return false;
        }
        // Otherwise, auction winners are those bidders whose total bid amount is equal or higher
        // than the auction car price:
        return bids[_bidder] >= carPrice;
    }

    /// @dev Transfers one of the auctioned cars to its rightful bidding winner. This function can
    ///      be called only after the bidding end block number. The winner himself must call this function
    ///      to redeem his car.
    function redeemCar() external ifEnded {
        require(carPriceValidated);
        require(isWinner(msg.sender));
        require(numCarsTransferred < carIds.length);
        require(!carClaimed[msg.sender]);

        // send car to its owner
        carClaimed[msg.sender] = true; // cannot claim more than once. Prevents re-entrancy attack
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

    /// @dev After the final car price has been set, auction losers can withdraw their bid
    ///      amounts. Also, if a winner cannot redeem a car because cars are already sold out (this
    ///      scenario is possible if number of winners is greater than the number of auctioned cars),
    ///      the winner can also withdraw his bid.
    ///      As a safety mechanism, if the car price is not set after a timeout period, all bidders
    ///      can transfer their bidden amounts back to their accounts.
    ///      Only the bidder himself can withdraw his bid.
    function withdrawBid() external ifEnded {
        if (!carPriceValidated) {
            require(block.number.sub(biddingEndBlockNumber) >= SAFETY_TIMEOUT_BLOCKS);
        } else {
            if (isWinner(msg.sender)) {
                // allow a winner to withdraw his bidden amount if cars are already sold out
                require(numCarsTransferred >= carIds.length);
                // as far as the winner did not redeem the car yet
                require(!carClaimed[msg.sender]);
            }
        }
        uint256 bidAmount = bids[msg.sender];
        require(bidAmount > 0);

        bids[msg.sender] = 0; // cannot withdraw bids more than once. Prevents re-entrancy attack
        msg.sender.transfer(bidAmount);

        emit WithdrawBid(msg.sender, bidAmount);
    }

    /// @dev Transfer out any unsold cars back to specific address given by the manager.
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
    ///      once after the bidding end block number, and only by the manager.
    function withdraw() external ifEnded onlyManager {
        require(carPriceValidated);
        require(!withdrawn);
        address treasurer = token.getTreasurer();
        require(treasurer != address(0));

        // transfer ether from sold cars
        withdrawn = true; // cannot withdraw more than once. Prevents re-entrancy attack
        uint256 amount = carPrice.mul(numCarsSold);
        treasurer.transfer(amount);

        emit ManagerWithdrawEther(treasurer, amount);

        // transfer unsold cars
        transferUnsoldCars(manager);
    }

    /// @dev Only the owner can destroy the auction contract, and only if no ether or cars are
    ///      stored in the contract.
    function destroy() external onlyOwner {
        require(address(this).balance == 0);
        require(numCarsTransferred == carIds.length);
        selfdestruct(owner);
    }
}
