"use strict";

const CryptoCarzAuction = artifacts.require('./CryptoCarzAuction.sol');
const CryptoCarzAuctionMock = artifacts.require('./CryptoCarzAuctionMock.sol');
const CryptoCarzToken = artifacts.require('./CryptoCarzToken.sol');
import assertRevert from './assertRevert';
import increaseBlocks from './increaseBlocks';
import constants from './constants';
const seedrandom = require('seedrandom');
const BigNumber = web3.BigNumber;
require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bignumber')(BigNumber))
    .should();

contract('CryptoCarzAuction', function (accounts) {

    const ETHER = new BigNumber('1e18');

    // Maximum gas a transaction should used. This values is chosen
    // as a compromise taken into account current mainnet's block
    // gas limit and utilization.
    const MAX_GAS_USED = 4000000;

    // All transactions require to pay gas fees. This parameters serves as
    // a rough estimation of what the maximum percentage of the total transaction
    // ETH difference would be due to gas fees.
    let GAS_TOLERANCE_PERCENT = 5;

    const CAR_IDS = [1, 2, 3, 4, 5];
    const CAR_PRICE = 100;

    // Generic bidding period, enough to run most tests before hitting SAFETY_TIMEOUT_BLOCKS.
    // If you're going to make actual bids, increment this by the number of bids you'll make as they
    // will be mined instantly.
    const BIDDING_PERIOD = 2 * constants.MINUTE / constants.AVERAGE_BLOCK_TIME;

    // Number of transactions needed for `validateCarPrice()` to complete the
    // car price validation
    const NUM_VALIDATION_TRANSACTIONS = 2;

    const NUM_ACCOUNTS = process.env.NUM_ACCOUNTS;
    const owner = accounts[NUM_ACCOUNTS - 1];
    const manager = accounts[NUM_ACCOUNTS - 2];
    const treasurer = accounts[NUM_ACCOUNTS - 3];
    const someoneElse = accounts[NUM_ACCOUNTS - 4];
    const users = accounts.slice(1, NUM_ACCOUNTS - 5);

    // realistic auction test parameters
    const NUM_BIDDERS = NUM_ACCOUNTS - 10;
    const NUM_BID_UPGRADES = 2;

    // Maximum number of loop iterations inside `validateCarPrice()`
    // MAX_ITER = 50  => ~450k gas per validateCarPrice() call
    // MAX_ITER = 500 => ~3.5m gas per validateCarPrice() call
    const MAX_ITER = 500;

    let token;
    let auction;
    let bids, losers, winners, bidders;
    let expectedSeriesId;

    function assertSimilarBalance(current, expected) {
        let diff = current.minus(expected);
        let percentageGas = diff.dividedBy(current).times(100);
        if (!percentageGas.abs().lt(GAS_TOLERANCE_PERCENT)) {
            // debugging logs
            // console.log(`current = ${current}`);
            // console.log(`expected = ${expected}`); 
            // console.log(`diff = ${diff}`);
            // console.log(`percentageGas = ${percentageGas}`);
            assert.equal(true, false);
        }
        return true;
    }

    async function assertedBid(auction, bidder, bidAmount) {
        const balanceBefore = new BigNumber(await web3.eth.getBalance(bidder));
        const bidderAmountBefore = new BigNumber(await auction.getBidAmount(bidder));
        const bid = await auction.bid({ from: bidder, value: bidAmount });
        const balanceAfter = new BigNumber(await web3.eth.getBalance(bidder));
        const bidderAmountAfter = new BigNumber(await auction.getBidAmount(bidder));
        const expectedBidderAmountAfter = bidderAmountBefore.add(bidAmount);

        // debugging logs
        // console.log(`balanceBefore = ${balanceBefore}`);
        // console.log(`bidderAmountBefore = ${bidderAmountBefore}`);
        // console.log(`bidAmount = ${bidAmount}`);
        // console.log(`balanceAfter = ${balanceAfter}`);
        // console.log(`bidderAmountAfter = ${bidderAmountAfter}`);
        // console.log(`expectedBidderAmountAfter = ${expectedBidderAmountAfter}`);

        assert.equal(bid.logs[0].event, 'Bid');
        assert.equal(bid.logs[0].args.bidder.valueOf(), bidder);
        bidAmount.should.be.bignumber.equal(new BigNumber(bid.logs[0].args.bidAmount.valueOf()), `wrong bidAmount for bidder ${bidder}`);
        expectedBidderAmountAfter.should.be.bignumber.equal(new BigNumber(bid.logs[0].args.accumulatedBidAmount.valueOf()), `wrong accumulatedBidAmount for bidder ${bidder}`);
        expectedBidderAmountAfter.should.be.bignumber.equal(bidderAmountAfter, `wrong bidderAmountAfter for bidder ${bidder}`);
        assertSimilarBalance(balanceAfter, balanceBefore.minus(bidAmount));
    }

    async function assertedCancelBid(auction, bidder) {
        const balanceBefore = new BigNumber(await web3.eth.getBalance(bidder));
        const bidderAmountBefore = new BigNumber(await auction.getBidAmount(bidder));

        const cancelBid = await auction.cancelBid({ from: bidder });

        const balanceAfter = new BigNumber(await web3.eth.getBalance(bidder));
        const bidderAmountAfter = new BigNumber(await auction.getBidAmount(bidder));

        const expectedBalanceAfter = balanceBefore.add(bidderAmountBefore);

        assertSimilarBalance(balanceAfter, expectedBalanceAfter);
        //expectedBalanceAfter.should.be.bignumber.equal(balanceAfter, `wrong expectedBalanceAfter for bidder ${bidder}`);
        '0'.should.be.bignumber.equal(bidderAmountAfter, `wrong bidderAmountAfter for bidder ${bidder}`);
    }

    async function assertedExtendAuction(newBiddingEndBlockNumber, account) {
        const extendAuction = await auction.extendAuction(newBiddingEndBlockNumber, { from: account });
        assert.equal(extendAuction.logs[0].event, 'AuctionExtended');
        assert.equal(extendAuction.logs[0].args.biddingEndBlockNumber.valueOf(), newBiddingEndBlockNumber);
        assert.equal((await auction.biddingEndBlockNumber.call()).toNumber(), newBiddingEndBlockNumber);
    }

    async function assertedRedeemCar(auction, token, redeemer, carPrice, bidAmount) {

        const isWinner = await auction.isWinner(redeemer, { from: someoneElse });
        assert.equal(isWinner, true, `bidder needs to be an auction winner to redeem a car`);

        const balanceBefore = new BigNumber(await web3.eth.getBalance(redeemer));

        const redeemCar = await auction.redeemCar({ from: redeemer });

        assert.equal(redeemCar.logs[0].event, 'CarRedeemed');
        assert.equal(redeemCar.logs[0].args.redeemer.valueOf(), redeemer);
        const carId = redeemCar.logs[0].args.carId.valueOf();
        const bidExcessAmount = new BigNumber(redeemCar.logs[0].args.bidExcessAmount.valueOf());

        assert.equal(redeemer, await token.ownerOf(carId),
            `error when checking ownerwship of carId = ${carId} by redeemer = ${redeemer}`);
        const balanceAfter = new BigNumber(await web3.eth.getBalance(redeemer));
        // balanceAfter = balanceBefore + bidExcessAmount = balanceBefore + (bidAmount - carPrice)

        bidExcessAmount.should.be.bignumber.equal(new BigNumber(bidAmount).minus(carPrice),
            `wrong bidExcessAmount for redeemer ${redeemer}`);
        assertSimilarBalance(balanceAfter, balanceBefore.plus(bidExcessAmount));
        return carId;
    }

    async function assertedWithdrawBid(auction, withdrawer, bidAmount) {
        const isWinner = await auction.isWinner(withdrawer, { from: someoneElse });
        assert.isBoolean(isWinner, `isWinner did not return a boolean ${isWinner}`);
        if (isWinner) {
            const numCarsTransferred = (await auction.numCarsTransferred.call()).toNumber();
            assert.equal(numCarsTransferred, CAR_IDS.length,
                `auction winners need to wait until cars are sold out before withdrawing a bid`);
        }
        const balanceBefore = new BigNumber(await web3.eth.getBalance(withdrawer));

        const withdrawBid = await auction.withdrawBid({ from: withdrawer });
        assert.equal(withdrawBid.logs[0].event, 'WithdrawBid');
        assert.equal(withdrawBid.logs[0].args.withdrawer.valueOf(), withdrawer);
        const bidAmount2 = new BigNumber(withdrawBid.logs[0].args.bidAmount.valueOf());

        const balanceAfter = new BigNumber(await web3.eth.getBalance(withdrawer));
        // balanceAfter = balanceBefore + bidaAmount
        bidAmount.should.be.bignumber.equal(bidAmount2,
            `wrong bidAmount for withdrawer ${withdrawer}`);

        assertSimilarBalance(balanceAfter, balanceBefore.plus(bidAmount));
    }

    async function assertedWithdraw(
        auction, expectedEtherAmountInWei, expectNumCars, account) {
        const balanceBefore = new BigNumber(await web3.eth.getBalance(treasurer));

        const numCars = (await token.balanceOf(auction.address)).toNumber();
        const tokenIds = await Promise.all(Array.from(Array(numCars).keys()).map((index) => {
            return token.tokenOfOwnerByIndex(auction.address, index);
        }));
        const carsOwned = (await Promise.all(tokenIds.map((id) => token.ownerOf(id))))
            .filter((owner) => owner === auction.address)
            .length;
        assert.equal(carsOwned, numCars,
            `not all tokens are owned by auction contract`);

        assert.isFalse(await auction.withdrawn.call());
        const withdraw = await auction.withdraw({ from: account });
        assert.isTrue(await auction.withdrawn.call());

        assert.equal(withdraw.logs[0].event, 'ManagerWithdrawEther');
        assert.equal(withdraw.logs[0].args.etherTo.valueOf(), treasurer);
        assert.equal(withdraw.logs[0].args.amount.valueOf(), expectedEtherAmountInWei);
        assert.equal(withdraw.logs[1].event, 'ManagerWithdrawCars');
        assert.equal(withdraw.logs[1].args.carsTo.valueOf(), account);
        assert.equal(withdraw.logs[1].args.numCars.valueOf(), expectNumCars);

        const balanceAfter = new BigNumber(await web3.eth.getBalance(treasurer));
        const carsOwnedAfter = (await Promise.all(tokenIds.map((id) => token.ownerOf(id))))
            .filter((owner) => owner === account)
            .length;

        balanceAfter.should.be.bignumber.equal(balanceBefore.plus(expectedEtherAmountInWei),
            `wrong balance amount ${balanceAfter}`);
        assert.equal(carsOwnedAfter, expectNumCars,
            `wrong number of cars owned by manager ${carsOwnedAfter}`);
    }

    async function assertedCreateTokenContract() {
        token = await CryptoCarzToken.new(owner, manager, treasurer, { from: someoneElse });
        assert.equal(await token.owner.call(), owner);
        assert.equal(await token.manager.call(), manager);
        assert.equal(await token.treasurer.call(), treasurer);
        expectedSeriesId = 0;
        return token
    }

    async function assertedCreateAuctionContract(tokenContractAddress) {
        auction = await CryptoCarzAuction.new(owner, manager, tokenContractAddress, { from: someoneElse });
        assert.equal(await auction.owner.call(), owner);
        assert.equal(await auction.manager.call(), manager);
        assert.equal(await auction.token.call(), tokenContractAddress);
        assert.equal((await auction.maxIter.call()).toNumber(), (await auction.DEFAULT_MAX_ITER.call()).toNumber());
        assert.isFalse(await auction.initialized.call());
        assert.isFalse(await auction.cancelled.call());
        return auction;
    }

    async function assertedCreateCars(token, carIds) {
        const createSeries = await token.createSeries(carIds.length, { from: manager });
        assert.equal(createSeries.logs[0].event, 'CreateSeries');
        assert.equal(createSeries.logs[0].args.seriesId.valueOf(), expectedSeriesId);
        assert.equal(createSeries.logs[0].args.seriesMaxCars.valueOf(), carIds.length);
        expectedSeriesId += 1;
        await token.createCars(carIds, createSeries.logs[0].args.seriesId, { from: manager });
    }

    async function assertedCreateAuction(token, auction, carIds, biddingPeriod, account) {
        if (carIds.length > 0) {
            await token.safeTransfersFrom(manager, auction.address, carIds, { from: manager });
        }
        const biddingEndBlockNumber = web3.eth.blockNumber + biddingPeriod;
        await auction.newAuction(carIds, biddingEndBlockNumber, { from: account });
        return auction;
    }

    async function assertedCancelAuction(auction) {
        assert.equal(await auction.cancelled.call(), false);
        const carIds = (await auction.getCarIds({ from: someoneElse })).map(Number);
        for (let i = 0; i < carIds.length; i++) {
            assert.equal(auction.address, await token.ownerOf(carIds[i]),
                `carId = ${carIds[i]} should belong to auction address ${auction.address}`);
        }
        const cancelAuction = await auction.cancelAuction({ from: manager });
        assert.equal(cancelAuction.logs[cancelAuction.logs.length - 1].event, 'AuctionCancelled');
        assert.equal(await auction.cancelled.call(), true);
        for (let i = 0; i < carIds.length; i++) {
            assert.equal(manager, await token.ownerOf(carIds[i]),
                `carId = ${carIds[i]} should belong to manager address ${manager}`);
        }
    }

    async function assertedSetCarPrice(auction, carPrice, account) {
        await auction.setCarPrice(carPrice, { from: account });
        carPrice.should.be.bignumber.equal(await auction.getCarPrice(), `Wrong car price`);
        const numWinnersCounted = (await auction.numWinnersCounted.call()).toNumber();
        assert.equal(0, numWinnersCounted,
            `numWinnersCounted should be reset to 0`);
        assert.equal(0, (await auction.lastCheckedBidderIndex.call()).toNumber(),
            `lastCheckedBidderIndex should be reset to 0`);

        const numBidders = (await auction.getBidders()).length;
        const numCars = (await auction.getCarIds()).length;
        const numCarsSold = (await auction.numCarsSold.call()).toNumber();
        if (numCars >= numBidders) {
            assert.equal(numCarsSold, numBidders, `Not enough bidders to sell all cars`);
        } else {
            assert.equal(numCarsSold, numCars, `Enough bidders to sell all cars`);
        }
    }

    async function assertedValidateCarPriceInMultipleTransactions(
        auction, account, carPrice, carIdsLength, biddersLength, numTransactions) {

        const maxIter = Math.ceil(biddersLength / numTransactions);
        assert.isAtLeast(maxIter, 2, `The number of iterations should at least be 2`);
        await auction.setMaxIter(maxIter, { from: account });

        for (let i = 0; i < numTransactions; i++) {
            // console.log(`------------`);
            // console.log(`carPrice = ${(await auction.carPrice.call()).toNumber()}`);
            // console.log(`lastCheckedBidderIndex = ${(await auction.lastCheckedBidderIndex.call()).toNumber()}`);
            // console.log(`numWinnersCounted = ${(await auction.numWinnersCounted.call()).toNumber()}`);
            // console.log(`numCarsSold = ${(await auction.numCarsSold.call()).toNumber()}`);
            // console.log(`------------`);
            await assertedValidateCarPrice(auction, manager, carPrice, carIdsLength, biddersLength, i == (numTransactions - 1));
        }
    }

    async function assertedValidateCarPrice(
        auction, account, carPrice, carIdsLength, biddersLength, isValidated) {
        const validateCarPrice = await auction.validateCarPrice({ from: account });
        const gasUsed = parseInt(validateCarPrice['receipt']['gasUsed']);
        //console.log(`validateCarPrice: gasUsed = ${gasUsed}`);
        assert.isAtMost(gasUsed, MAX_GAS_USED, `Transaction used too much gas`);
        const carPrice2 = await auction.getCarPrice();
        carPrice.should.be.bignumber.equal(carPrice2, `Wrong car price`);
        const carPriceValidated = await auction.carPriceValidated.call({ from: someoneElse });

        if (typeof carIdsLength !== 'undefined' &&
            typeof biddersLength !== 'undefined' &&
            typeof isValidated !== 'undefined') {
            assert.equal(carPriceValidated, isValidated, `Unexpected carPriceValidated result`);
            if (carPriceValidated === true) {
                assert.equal(validateCarPrice.logs[0].event, 'CarPrice');
                carPrice.should.be.bignumber.equal(validateCarPrice.logs[0].args.carPrice.valueOf());

                const numCarsSold =
                    (await auction.numCarsSold.call({ from: someoneElse })).toNumber();

                if (biddersLength <= carIdsLength) {
                    assert.equal(numCarsSold, biddersLength,
                        `If there are less or the same amount of bidders than cars,` +
                        ` the num of cars sold is the num of bidders`);
                } else {
                    assert.equal(numCarsSold, carIdsLength,
                        `If there are more bidders than cars, all cars must be sold out`);
                    const numWinnersCounted =
                        (await auction.numWinnersCounted.call({ from: someoneElse })).toNumber();

                    assert.equal(numWinnersCounted, numCarsSold,
                        `If there are more bidders than cars,` +
                        ` the number of winners must be at lesat the number of cars`);
                }
            }
        }
    }

    async function assertNumWinners(auction, expectedNumWinners, message) {
        const numWinnersPromise = Array.from(Array(users.length).keys()).map((index) => {
            return auction.isWinner(users[index]);
        });
        const numWinners = await Promise.all(numWinnersPromise);
        assert.equal(numWinners.filter((isWinner) => isWinner === true).length, expectedNumWinners, message);
    }

    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    async function buildTestAuction(biddingPeriod) {
        token = await assertedCreateTokenContract();
        auction = await assertedCreateAuctionContract(token.address);

        // Create a few random car series to ensure we're not relying on seriesId 0.
        for (let i = 0; i < getRandomInt(1, 5); i++) {
            await assertedCreateCars(token, [CAR_IDS.length + 1 + i]);
        }
        await assertedCreateCars(token, CAR_IDS);
        await assertedCreateAuction(token, auction, CAR_IDS, biddingPeriod, manager);
    }

    async function buildTestBids() {
        const numWinners = CAR_IDS.length + 1; // more winners than cars
        const numLosers = 5;

        let j = 0;
        bids = {};
        bidders = [];
        losers = [];
        winners = [];
        // loser bids
        for (let i = 0; i < numLosers; i++) {
            const bid = CAR_PRICE - 1;
            bids[users[j]] = bid;
            await assertedBid(auction, users[j], bid);
            losers.push(users[j]);
            j++;
        }
        // winner bids
        for (let i = 0; i < numWinners; i++) {
            const bid = CAR_PRICE;
            bids[users[j]] = bid;
            await assertedBid(auction, users[j], bid);
            winners.push(users[j]);
            j++;
        }
        bidders = losers.concat(winners);
    }

    describe('constructor', async function () {
        it('token contract address cannot be 0x0', async function () {
            await assertedCreateAuctionContract(accounts[0]);
            await assertRevert(assertedCreateAuctionContract(constants.ZERO_ADDRESS));
        });
    });

    describe('payable fallback', async function () {
        before(async function () {
            token = await assertedCreateTokenContract();
            auction = await assertedCreateAuctionContract(token.address);
        });

        it('is not supposed to receive Ether via payable fallback function', async function () {
            await assertRevert(auction.sendTransaction({
                from: someoneElse,
                value: 1
            }));
        });
    });

    describe('factory', async function () {
        beforeEach(async function () {
            token = await assertedCreateTokenContract();
        });

        it('only manager can create auctions', async function () {
            await assertRevert(token.createAuction({ from: owner }));
        });

        it('cannot create auctions if paused', async function () {
            await token.pause({ from: manager })
            await assertRevert(token.createAuction({ from: manager }));
        });

        it('create and validate auction', async function () {
            const createAuction = await token.createAuction({ from: manager });
            const auctionAddress = createAuction.logs[0].args.contractAddress;
            const auction = (web3.eth.contract(CryptoCarzAuction.abi)).at(auctionAddress);
            assert.equal(await auction.token.call(), token.address,
                `auction contract\'s token address should be the actual token address`);
        });
    });

    describe('initialize auction', async function () {
        beforeEach(async function () {
            token = await assertedCreateTokenContract();
            auction = await assertedCreateAuctionContract(token.address);
            await assertedCreateCars(token, CAR_IDS);
        });

        it('contract can only be initialized once', async function () {
            await assertedCreateAuction(token, auction, CAR_IDS, BIDDING_PERIOD, manager);
            await assertRevert(auction.newAuction(CAR_IDS, web3.eth.blockNumber + BIDDING_PERIOD, { from: manager }));
        });

        it('at least 1 car must be auctioned', async function () {
            await assertRevert(assertedCreateAuction(token, auction, [], BIDDING_PERIOD, manager));
            await assertedCreateAuction(token, auction, [CAR_IDS[0]], BIDDING_PERIOD, manager);
        });

        it('all auctioned cars must belong to the same series', async function () {
            const createSeries = await token.createSeries(1, { from: manager });
            const newCarIds = [CAR_IDS[CAR_IDS.length -1] + 1];
            await token.createCars(newCarIds, createSeries.logs[0].args.seriesId, { from: manager });
            await token.safeTransfersFrom(manager, auction.address, CAR_IDS.concat(newCarIds), { from: manager });
            await assertRevert(auction.newAuction(CAR_IDS.concat(newCarIds), web3.eth.blockNumber + BIDDING_PERIOD, { from: manager }));
        });

        it('bidding end time must be in the future', async function () {
            await assertRevert(assertedCreateAuction(token, auction, CAR_IDS, -BIDDING_PERIOD, manager));
        });

        it('auction cannot be too short or too long', async function () {
            const minAuctionPeriodBlocks = (await auction.MIN_AUCTION_PERIOD_BLOCKS.call({ from: someoneElse })).toNumber();
            const maxAuctionPeriodBlocks = (await auction.MAX_AUCTION_PERIOD_BLOCKS.call({ from: someoneElse })).toNumber();
            await token.safeTransfersFrom(manager, auction.address, CAR_IDS, { from: manager });
            await assertRevert(auction.newAuction(CAR_IDS, web3.eth.blockNumber + minAuctionPeriodBlocks - 1, { from: manager }));
            // This needs to be + 2 as by the time the function reaches block.number, it will have incremented by 1.
            await assertRevert(auction.newAuction(CAR_IDS, web3.eth.blockNumber + maxAuctionPeriodBlocks + 2, { from: manager }));
        });

        it('only manager can create a new auction', async function () {
            await assertRevert(assertedCreateAuction(token, auction, CAR_IDS, BIDDING_PERIOD, owner));
        });

        it('car tokens need to belong to auction contract to start the auction', async function () {
            await assertRevert(auction.newAuction(CAR_IDS, web3.eth.blockNumber + BIDDING_PERIOD, { from: manager }));
            await token.safeTransfersFrom(manager, auction.address, CAR_IDS, { from: manager });
            await auction.newAuction(CAR_IDS, web3.eth.blockNumber + BIDDING_PERIOD, { from: manager });
        });
    });


    describe('auction initialized', async function () {
        beforeEach(async function () {
            token = await assertedCreateTokenContract();
            auction = await assertedCreateAuctionContract(token.address);

            // Create a few random car series to ensure we're not relying on seriesId 0.
            for (let i = 0; i < getRandomInt(1, 5); i++) {
                await assertedCreateCars(token, [CAR_IDS.length + 1 + i]);
            }
            await assertedCreateCars(token, CAR_IDS);
            await assertedCreateAuction(token, auction, CAR_IDS, BIDDING_PERIOD, manager);
        });

        describe('extend auction', async function () {
            it('can extend bidding end time', async function () {
                await assertedExtendAuction(web3.eth.blockNumber + 10, manager);
            });

            it('cannot be earlier than current bidding end time', async function () {
                await increaseBlocks(BIDDING_PERIOD - 10);
                await assertRevert(auction.extendAuction(web3.eth.blockNumber - BIDDING_PERIOD - 11, { from: manager }));
            });

            it('cannot extend longer than a maximum', async function () {
                const maxAuctionPeriodBlocks = (await auction.MAX_AUCTION_PERIOD_BLOCKS.call(
                    { from: someoneElse })).toNumber();
                await assertedExtendAuction(web3.eth.blockNumber + maxAuctionPeriodBlocks, manager);
                // This needs to be + 2 as by the time the function reaches block.number, it will have incremented by 1.
                await assertRevert(auction.extendAuction(web3.eth.blockNumber + maxAuctionPeriodBlocks + 2,
                    { from: manager }));
            });

            it('cannot extend after bidding end time', async function () {
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertRevert(auction.extendAuction(web3.eth.blockNumber + 1, { from: manager }));
            });
        });

        describe('pause auction', async function () {
            it('cannot bid when paused', async function () {
                await auction.pause({ from: manager });
                await assertRevert(auction.bid({ from: users[0], value: 1 }));
                await auction.unpause({ from: owner });
                await assertedBid(auction, users[0], 1);
            });
        });

        describe('cancel auction', async function () {
            it('unsold cars must be transferred back to manager', async function () {
                await assertedCancelAuction(auction);
            });
        });

        describe('bid', async function () {
            it('cannot bid if not yet initialized', async function () {
                token = await assertedCreateTokenContract();
                auction = await assertedCreateAuctionContract(token.address);
                await assertedCreateCars(token, CAR_IDS);
                await assertRevert(auction.bid({ from: users[0], value: 1 }));
                await assertedCreateAuction(token, auction, CAR_IDS, BIDDING_PERIOD, manager);
                await auction.bid({ from: users[0], value: 1 });
            });

            it('cannot bid 0 ether', async function () {
                await assertRevert(auction.bid({ from: users[0], value: 0 }));
            });

            it('should be able to increase a bid', async function () {
                const bid1 = new BigNumber(web3.toWei('1.123456789012345678', 'ether'));
                const bid2 = new BigNumber(web3.toWei('4.123456789012345678', 'ether'));
                await assertedBid(auction, users[0], bid1);
                await assertedBid(auction, users[0], bid2);
                const bidAmount = new BigNumber(await auction.getBidAmount(users[0],
                    { from: someoneElse }));
                (bid1.plus(bid2)).should.be.bignumber.equal(bidAmount);
            });

            it('should be able to cancel a bid', async function () {
                await assertedBid(auction, users[0], 1);
                await assertedCancelBid(auction, users[0]);
            });

            it('cannot cancel bid if never bidded', async function () {
                await assertRevert(auction.cancelBid({ from: users[0] }));
            });

            it('cannot bid if auction was cancelled', async function () {
                await assertedCancelAuction(auction);
                await assertRevert(auction.bid({ from: users[0], value: 1 }));
            });
        });

        describe('set car price', async function () {
            it('cannot set car price before bidding end time', async function () {
                await assertedBid(auction, users[0], 1);
                await assertRevert(auction.setCarPrice(1, { from: manager }));
            });

            it('cannot set car price if there are no bidders', async function () {
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertRevert(auction.setCarPrice(1, { from: manager }));
            });

            it('cannot set car price to 0', async function () {
                await assertedBid(auction, users[0], 1);
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertRevert(auction.setCarPrice(0, { from: manager }));
            });

            it('cannot set same car price', async function () {
                await assertedBid(auction, users[0], 1);
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, 1, manager);
                await assertRevert(auction.setCarPrice(1, { from: manager }));
            });

            it('number of winners can be larger than number of auctioned cars', async function () {
                for (let i = 0; i <= CAR_IDS.length; i++) {
                    await assertedBid(auction, users[i], 2);
                }
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, 1, manager);
                await assertedValidateCarPrice(auction, manager, 1, CAR_IDS.length, CAR_IDS.length + 1, true);
                await assertNumWinners(auction, CAR_IDS.length + 1,
                    `Number of winners should be the number of auctioned cars plus 1`);
            });

            it('cannot set car price if auction was cancelled', async function () {
                await assertedBid(auction, users[0], 1);
                await assertedCancelAuction(auction);
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertRevert(auction.setCarPrice(1, { from: manager }));
            });

            it('cannot set car price if it is already validated', async function () {
                await assertedBid(auction, users[0], 2);
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, 1, manager);
                await assertedValidateCarPrice(auction, manager, 1, CAR_IDS.length, 1, true);
                await assertRevert(auction.setCarPrice(2, { from: manager }));
            });
        });

        describe('validate car price', async function () {
            it('cannot validate if car price is 0', async function () {
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertRevert(auction.validateCarPrice({ from: manager }));
            });

            it('cannot validate twice', async function () {
                await assertedBid(auction, users[0], 2);
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, 1, manager);
                await assertedValidateCarPrice(auction, manager, 1, CAR_IDS.length, 1, true);
                await assertRevert(auction.validateCarPrice({ from: manager }));
            });

            it('cannot set maximum iterations to 0', async function () {
                await assertRevert(auction.setMaxIter(0, { from: manager }));
            });

            it('cannot set the same maximum iterations', async function () {
                assert.equal((await auction.maxIter.call()).toNumber(), 500);
                await assertRevert(auction.setMaxIter(500, { from: manager }));
            });
        });
    });

    describe('more winners than auctioned cars', async function () {
        beforeEach(async function () {
            await buildTestAuction(BIDDING_PERIOD + CAR_IDS.length + 6);
            await buildTestBids();
        });

        describe('redeem car & withdraw bid', async function () {
            it('cannot redeem car if car price has not been validated yet', async function () {
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertRevert(auction.redeemCar({ from: winners[0] }));
            });

            it('cannot withdraw bid if car price has not been validated yet', async function () {
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertRevert(auction.withdrawBid({ from: losers[0] }));
            });

            it('number of winners should be as expected', async function () {
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, CAR_PRICE, manager);
                await assertedValidateCarPriceInMultipleTransactions(
                    auction, manager, CAR_PRICE, CAR_IDS.length, bidders.length, NUM_VALIDATION_TRANSACTIONS);
                await assertNumWinners(auction, winners.length, 'incorrect number of winners');
            });

            it('only winners can redeem car and losers withdraw bids AND' +
                'bidder cannot redeem or withdraw more than once AND' +
                'remaining winners can withdraw their bid AND' +
                'winnner cannot withdraw if already redeemed a car', async function () {
                    await increaseBlocks(BIDDING_PERIOD + 1);
                    await assertedSetCarPrice(auction, CAR_PRICE, manager);
                    await assertedValidateCarPriceInMultipleTransactions(
                        auction, manager, CAR_PRICE, CAR_IDS.length, bidders.length, NUM_VALIDATION_TRANSACTIONS);

                    for (let i = 0; i < CAR_IDS.length; i++) { // winners with car
                        await assertRevert(auction.withdrawBid({ from: winners[i] }));
                        await assertedRedeemCar(auction, token, winners[i], CAR_PRICE, bids[winners[i]]);
                        await assertRevert(auction.redeemCar({ from: winners[i] }));
                        await assertRevert(auction.withdrawBid({ from: winners[i] }));
                    }

                    for (let i = CAR_IDS.length; i < winners.length; i++) { // winners without car
                        await assertRevert(auction.redeemCar({ from: winners[i] }));
                        await assertedWithdrawBid(auction, winners[i], bids[winners[i]]);
                        await assertRevert(auction.withdrawBid({ from: winners[i] }));

                    }

                    for (let i = 0; i < losers.length; i++) { // losers
                        await assertRevert(auction.redeemCar({ from: losers[i] }));
                        await assertedWithdrawBid(auction, losers[i], bids[losers[i]]);
                        await assertRevert(auction.withdrawBid({ from: losers[i] }));
                    }
                });

            it('cannot claim more cars than the number of auctioned cars', async function () {
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, CAR_PRICE, manager);
                await assertedValidateCarPriceInMultipleTransactions(
                    auction, manager, CAR_PRICE, CAR_IDS.length, bidders.length, NUM_VALIDATION_TRANSACTIONS);

                await assertNumWinners(auction, CAR_IDS.length + 1, `Number of winners should be the number of auctioned cars plus 1`);

                for (let i = 0; i < CAR_IDS.length; i++) { // winners with car
                    await assertedRedeemCar(auction, token, winners[i], CAR_PRICE, bids[winners[i]]);
                }

                let numCarsTransferred = (await auction.numCarsTransferred.call()).toNumber();
                assert.equal(numCarsTransferred, CAR_IDS.length,
                    `Number of cars transferred should be the number of auctioned cars`);

                await assertRevert(auction.redeemCar({ from: winners[CAR_IDS.length] }));
            });
        });

        describe('withdraw', async function () {
            it('cannot do it before bidding end time', async function () {
                await assertRevert(auction.withdraw({ from: manager }));
            });

            it('cannot do it if car price has not been set', async function () {
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertRevert(auction.withdraw({ from: manager }));
            });

            it('cannot do it if auction is not initialized', async function () {
                auction = await assertedCreateAuctionContract(token.address);
                await assertRevert(auction.withdraw({ from: manager }));
            });

            it('only manager can do it', async function () {
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, CAR_PRICE, manager);
                await assertedValidateCarPriceInMultipleTransactions(
                    auction, manager, CAR_PRICE, CAR_IDS.length, bidders.length, NUM_VALIDATION_TRANSACTIONS);
                await assertRevert(auction.withdraw({ from: owner }));
                await assertedWithdraw(auction, CAR_PRICE * CAR_IDS.length, 0, manager);
            });

            it('cannot withdraw more than once', async function () {
                await increaseBlocks(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, CAR_PRICE, manager);
                await assertedValidateCarPriceInMultipleTransactions(
                    auction, manager, CAR_PRICE, CAR_IDS.length, bidders.length, NUM_VALIDATION_TRANSACTIONS);
                await assertedWithdraw(auction, CAR_PRICE * CAR_IDS.length, 0, manager);
                await assertRevert(auction.withdraw({ from: manager }));
            });
        });
    });

    describe('less winners than auctioned cars', async function () {
        const numBidders = CAR_IDS.length - 1;

        before(async function () {
            await buildTestAuction(BIDDING_PERIOD + numBidders);
            assert.isBelow(numBidders, CAR_IDS.length);
        });

        it('all bidders can redeem a car and test withdraw', async function () {
            for (let i = 0; i < numBidders; i++) {
                await assertedBid(auction, users[i], CAR_PRICE + 1);
            }
            await increaseBlocks(BIDDING_PERIOD + 1);
            await assertedSetCarPrice(auction, CAR_PRICE, manager);
            await assertedValidateCarPriceInMultipleTransactions(auction, manager, CAR_PRICE, CAR_IDS.length, numBidders, 2);
            for (let i = 0; i < numBidders; i++) {
                await assertedRedeemCar(auction, token, users[i], CAR_PRICE, CAR_PRICE + 1);
            }
        });

        it('withdraw', async function () {
            await assertedWithdraw(auction, CAR_PRICE * numBidders, 1, manager);
        });
    });

    describe('destroy', async function () {
        beforeEach(async function () {
            await buildTestAuction(BIDDING_PERIOD);
        });

        it('contract must not own ether nor cars before destroying it', async function () {
            await assertedBid(auction, users[0], 1);
            await assertRevert(auction.destroy({ from: owner }));
            await assertedCancelBid(auction, users[0]);
            await assertRevert(auction.destroy({ from: owner }));
            await assertedCancelAuction(auction);
            await auction.destroy({ from: owner });
        });
    });

    describe('safety timeout', async function () {
        it('there can be no winners AND' +
            'bidders can withdraw their bids AND' +
            'car price cannot be set after timeout', async function () {
            token = await assertedCreateTokenContract();
            auction = await CryptoCarzAuctionMock.new(owner, manager, token.address, { from: someoneElse });
            await assertedCreateCars(token, CAR_IDS);
            await assertedCreateAuction(token, auction, CAR_IDS, BIDDING_PERIOD + 10, manager);
            for (let i = 0; i < 10; i++) {
                await assertedBid(auction, users[i], 10 * i + 1);
            }

            await increaseBlocks(BIDDING_PERIOD + 1);
            await assertedSetCarPrice(auction, 100, manager);
            await assertedValidateCarPrice(auction, manager, 100, CAR_IDS.length, 10, false);

            const SAFETY_TIMEOUT_BLOCKS = parseInt(await auction.SAFETY_TIMEOUT_BLOCKS.call());
            await increaseBlocks(SAFETY_TIMEOUT_BLOCKS);
            await assertNumWinners(auction, 0, `Number of winners should be zero`);

            for (let i = 0; i < 10; i++) {
                await assertedWithdrawBid(auction, users[i], 10 * i + 1);
            }

            await assertRevert(auction.setCarPrice(10, { from: manager }));
        });
    });

    describe('realistic full workflow', async function () {
        before(async function () {
            token = await assertedCreateTokenContract();
            auction = await assertedCreateAuctionContract(token.address);
            await assertedCreateCars(token, CAR_IDS);
            await assertedCreateAuction(token, auction, CAR_IDS, BIDDING_PERIOD + (NUM_BID_UPGRADES * NUM_BIDDERS), manager);
        });

        it('full auction', async function () {
            // This test case aims to be a realistic simulation of a whole CryptoCarz auction flow
            // in production. The test does the following steps:
            // 1- Deploys the token and auction contracts.
            // 2- Generates NUM_BID_UPGRADES random bids for NUM_BIDDERS bidders. In order for the
            //    test to be realistic, it should be run using:
            //      - NUM_BID_UPGRADES > 1
            //      - NUM_BIDDERS > 400.
            // 3- Goes fast forward in time until the bidding end time is passed
            // 4- Final auction car price is calculated.
            // 5- Executes the redeeming of cars and transfer of remaining bid amounts to the
            //    auction winners.
            // 6- Executes the transfer of bid amounts back to the auction losers.
            // 7- Executes the withdrawal of auction funds by the manager.

            this.timeout(3600000);

            const rng = seedrandom('seed');
            const bidAmounts = {};
            const maxNumWinners = CAR_IDS.length;

            // create random bids
            for (let t = 0; t < NUM_BID_UPGRADES; t++) {
                for (let i = 0; i < NUM_BIDDERS; i++) {
                    const user = users[i];
                    const bidAmount = ETHER.times(new BigNumber(`${rng()}`)).round();
                    if (!bidAmounts[user]) {
                        bidAmounts[user] = new BigNumber(0);
                    }
                    bidAmounts[user] = bidAmounts[user].plus(bidAmount);
                    console.log(`bid round = ${t}/${NUM_BID_UPGRADES}, ` +
                        `bidder = ${i}/${NUM_BIDDERS}, ` +
                        `amount = ${web3.fromWei(bidAmount, 'ether')}`);
                    await assertedBid(auction, user, bidAmount);
                }
            }

            // print out bids
            let bidTable = [];
            for (let i = 0; i < NUM_BIDDERS; i++) {
                const user = users[i];
                const amountEth = web3.fromWei(bidAmounts[user], 'ether');
                console.log(`Total bid from user ${user} (${i}/${NUM_BIDDERS}) = ${amountEth}`);
                bidTable.push([i, amountEth]);
            }

            // sort bids
            bidTable = bidTable.sort(function compareFunc(a, b) {
                const colNum = 1;
                if (a[colNum] === b[colNum]) {
                    return 0;
                }
                else {
                    return (a[colNum] < b[colNum]) ? -1 : 1;
                }
            });

            // reach auction's bidding end time
            await increaseBlocks(BIDDING_PERIOD + 1);

            // set auction's final car price
            const carPrice = new BigNumber(ETHER.times(bidTable[bidTable.length - maxNumWinners][1]));
            const bidderIds = bidTable.map(function (value, index) { return value[0]; });
            const winnerIds = bidderIds.slice(bidTable.length - maxNumWinners, bidTable.length);
            const loserIds = bidderIds.slice(0, bidTable.length - maxNumWinners);

            // debugging logs
            // console.log(`carPrice = ${carPrice}`);
            // console.log(`bidderIds = ${bidderIds}`);
            // console.log(`winnerIds = ${winnerIds}`);
            // console.log(`loserIds = ${loserIds}`);
            // console.log(`winnerIds.length= ${winnerIds.length}`);
            // console.log(`loserIds.length = ${loserIds.length}`);

            await assertedSetCarPrice(auction, carPrice, manager);

            const numValidateCarPriceCallsNeeded = Math.ceil(NUM_BIDDERS / MAX_ITER);

            // debugging logs
            console.log(`NUM_BIDDERS = ${NUM_BIDDERS}`);
            console.log(`MAX_ITER = ${MAX_ITER}`);
            console.log(`ValidateCarPrice() iterations needed = ${numValidateCarPriceCallsNeeded}`)

            const maxIter = parseInt(await auction.maxIter.call());
            if (maxIter != MAX_ITER) {
                await auction.setMaxIter(MAX_ITER, { from: manager });
            }

            for (let i = 0; i < (numValidateCarPriceCallsNeeded - 1); i++) {
                console.log(`ValidateCarPrice() iteration ${i}`);
                await assertedValidateCarPrice(auction, manager, carPrice, NUM_BIDDERS, false);
            }
            await assertedValidateCarPrice(auction, manager, carPrice, NUM_BIDDERS, true);

            const numCarsSold = await auction.numCarsSold.call();

            // send cars and remaining bid amount to the winners
            for (let i = 0; i < winnerIds.length; i++) {
                const winner = users[winnerIds[i]];
                console.log(`Winner ${winner}: ${i}/${winnerIds.length}`);
                await assertedRedeemCar(auction, token, winner, carPrice, bidAmounts[winner]);
            }

            // send bid amount back to the losers
            for (let i = 0; i < loserIds.length; i++) {
                const loser = users[loserIds[i]];
                console.log(`Loser ${loser}: ${i}/${loserIds.length}`);
                await assertedWithdrawBid(auction, loser, bidAmounts[loser]);
            }

            // withdraw profits
            const expectedAmount = carPrice.times(numCarsSold);
            await assertedWithdraw(auction, expectedAmount, 0, manager);
            '0'.should.be.bignumber.equal(await web3.eth.getBalance(auction.address));
        });
    });
});
