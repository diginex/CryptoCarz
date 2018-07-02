"use strict";

const CryptoCarzAuction = artifacts.require('./CryptoCarzAuction.sol');
const CryptoCarzToken = artifacts.require('./CryptoCarzToken.sol');
import assertRevert from './assertRevert';
import increaseTime from './increaseTime';
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

    let GAS_TOLERANCE_PERCENT = 5;

    const CAR_IDS = [1, 2, 3, 4, 5];
    const BIDDING_PERIOD = 1 * constants.WEEK;

    const DEFAULT_MAX_ITER = 15;

    const NUM_ACCOUNTS = process.env.NUM_ACCOUNTS || 30;
    const owner = accounts[NUM_ACCOUNTS - 1];
    const manager = accounts[NUM_ACCOUNTS - 2];
    const treasurer = accounts[NUM_ACCOUNTS - 3];
    const someoneElse = accounts[NUM_ACCOUNTS - 4];
    const users = accounts.slice(1, NUM_ACCOUNTS - 5);

    const NUM_BIDDERS = NUM_ACCOUNTS - 10;
    const NUM_BID_UPGRADES = 2;
    // MAX_ITER = 50  => ~450k gas per validateCarPrice() call
    // MAX_ITER = 500 => ~3.5m gas per validateCarPrice() call
    const MAX_ITER = 500;
    let token;
    let auction;
    let now;

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
        assert.equal(isWinner, false, `bidder needs to be an auction loser to withdraw a bid`);
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

        const withdraw = await auction.withdraw({ from: account });
        // TODO: check withdraw

        const balanceAfter = new BigNumber(await web3.eth.getBalance(treasurer));

        balanceAfter.should.be.bignumber.equal(balanceBefore.plus(expectedEtherAmountInWei),
            `wrong balance amount ${balanceAfter}`);
        // TODO: check num cars too
    }

    async function assertedCreateTokenContract() {
        token = await CryptoCarzToken.new(owner, manager, treasurer, { from: someoneElse });
        return token
    }

    async function assertedCreateAuctionContract(tokenContractAddress) {
        const auction = await CryptoCarzAuction.new(owner, manager, tokenContractAddress, { from: someoneElse });
        return auction;
    }

    async function assertedCreateCars(token, carIds) {
        await token.createSeries(carIds.length, { from: manager });
        await token.createCars(carIds, 0, { from: manager });
    }

    async function assertedCreateAuction(token, auction, carIds, biddingPeriod, account) {
        await token.safeTransfersFrom(manager, auction.address, carIds, { from: manager });
        const now = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
        const biddingEndTime = now + biddingPeriod;
        // console.log(`now = ${now}`);
        // console.log(`biddingPeriod = ${biddingPeriod}`);
        // console.log(`biddingEndTime = ${biddingEndTime}`);
        // console.log(`carIds = ${carIds}`);
        await auction.newAuction(carIds, biddingEndTime, { from: account });
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
        carPrice.should.be.bignumber.equal(await auction.carPrice.call(), `Wrong car price`);
        const numWinnersCounted = (await auction.numWinnersCounted.call()).toNumber();
        console.log(`numWinnersCounted = ${numWinnersCounted}`);
        assert.equal(0, numWinnersCounted,
            `numWinnersCounted should be reset to 0`);
        assert.equal(0, (await auction.lastCheckedBidderIndex.call()).toNumber(),
            `lastCheckedBidderIndex should be reset to 0`);
    }

    async function assertedValidateCarPrice(
        auction, account, carPrice, carIdsLength, biddersLength, isValidated) {

        const validateCarPrice = await auction.validateCarPrice({ from: account });
        //console.log(`validateCarPrice = ${JSON.stringify(validateCarPrice)}`);
        //console.log(`validateCarPrice.receipt.gasUsed = ${validateCarPrice['receipt']['gasUsed']}`);
        const gasUsed = parseInt(validateCarPrice['receipt']['gasUsed']);
        console.log(`validateCarPrice: gasUsed = ${gasUsed}`);
        assert.isAtMost(gasUsed, MAX_GAS_USED, `Transaction used too much gas`);

        const carPrice2 = await auction.carPrice.call({ from: someoneElse });
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
            now = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
        });

        it('at least 1 car must be auctioned', async function () {
            await assertRevert(assertedCreateAuction(token, auction, [], BIDDING_PERIOD, manager));
            await assertedCreateAuction(token, auction, [CAR_IDS[0]], BIDDING_PERIOD, manager);
        });

        it('all auctioned cars must belong to the same series', async function () {
            // TODO
        });

        it('bidding end time must be in the future', async function () {
            await assertRevert(assertedCreateAuction(token, auction, CAR_IDS, -BIDDING_PERIOD, manager));
        });

        it('auction cannot be too short or too long', async function () {
            const minAuctionPeriodSec = (await auction.MIN_AUCTION_PERIOD_SEC.call({ from: someoneElse })).toNumber();
            const maxAuctionPeriodSec = (await auction.MAX_AUCTION_PERIOD_SEC.call({ from: someoneElse })).toNumber();
            await token.safeTransfersFrom(manager, auction.address, CAR_IDS, { from: manager });
            await assertRevert(auction.newAuction(CAR_IDS, now + minAuctionPeriodSec - 1, { from: manager }));
            await assertRevert(auction.newAuction(CAR_IDS, now + maxAuctionPeriodSec + 1, { from: manager }));
        });

        it('only manager can create a new auction', async function () {
            await assertRevert(assertedCreateAuction(token, auction, CAR_IDS, BIDDING_PERIOD, owner));
        });

        it('car tokens need to belong to auction contract to start the auction', async function () {
            await assertRevert(auction.newAuction(CAR_IDS, now + BIDDING_PERIOD, { from: manager }));
            await token.safeTransfersFrom(manager, auction.address, CAR_IDS, { from: manager });
            await auction.newAuction(CAR_IDS, now + BIDDING_PERIOD, { from: manager });
        });
    });

    describe('auction initialized', async function () {
        // TODO: test create more series, not just one

        beforeEach(async function () {
            token = await assertedCreateTokenContract();
            auction = await assertedCreateAuctionContract(token.address);
            await assertedCreateCars(token, CAR_IDS);
            await assertedCreateAuction(token, auction, CAR_IDS, BIDDING_PERIOD, manager);
            now = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
        });

        describe('extend auction', async function () {
            it('cannot extend longer than a maximum', async function () {
                const maxAuctionPeriodSec = (await auction.MAX_AUCTION_PERIOD_SEC.call(
                    { from: someoneElse })).toNumber();
                now = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
                await auction.extendAuction(now + maxAuctionPeriodSec, { from: manager });
                now = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
                await assertRevert(auction.extendAuction(now + maxAuctionPeriodSec + constants.DAY,
                    { from: manager }));
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
                // TODO
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

            it('cannot bid if auction was cancelled', async function () {
                await assertedCancelAuction(auction);
                await assertRevert(auction.bid({ from: users[0], value: 1 }));
            });
        });

        describe('set car price', async function () {
            it('only manager can set and validate the car price', async function () {
                await assertedBid(auction, users[0], 1);
                await increaseTime(BIDDING_PERIOD + 1);
                await assertRevert(assertedSetCarPrice(auction, 1, owner));
                await assertedSetCarPrice(auction, 1, manager);
                await assertRevert(assertedValidateCarPrice(
                    auction, owner, 1, CAR_IDS.length, 1, true));
                assertedValidateCarPrice(auction, manager, 1, CAR_IDS.length, 1, true)
            });

            it('cannot set car price before bidding end time', async function () {
                await assertedBid(auction, users[0], 1);
                // TODO: do an assertedSetCarPrice function
                await assertRevert(auction.setCarPrice(1, { from: manager }));
                await increaseTime(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, 1, manager);
            });

            it('cannot set car price to 0', async function () {
                await assertedBid(auction, users[0], 1);
                await increaseTime(BIDDING_PERIOD + 1);
                await assertRevert(auction.setCarPrice(0, { from: manager }));
            });

            it('cannot set car price if auction was cancelled', async function () {
                await assertedBid(auction, users[0], 1);
                await assertedCancelAuction(auction);
                await increaseTime(BIDDING_PERIOD + 1);
                await assertRevert(auction.setCarPrice(1, { from: manager }));
            });

            describe('car price must enable to sell all possible auctioned cars', async function () {
                it('when there are less bidders than cars', async function () {
                    await assertedBid(auction, users[0], 10);
                    await assertedBid(auction, users[1], 20);
                    await increaseTime(BIDDING_PERIOD + 1);
                    await assertedSetCarPrice(auction, 15, manager);
                    await assertedValidateCarPrice(auction, manager, 15, CAR_IDS.length, 2, false)
                    await assertedSetCarPrice(auction, 10, manager);
                    await assertedValidateCarPrice(auction, manager, 10, CAR_IDS.length, 2, true);
                });

                it('when there are more bidders than cars', async function () {
                    const carPrice = 10;
                    for (let i = 0; i < CAR_IDS.length + 1; i++) {
                        await assertedBid(auction, users[i], carPrice);
                    }
                    await increaseTime(BIDDING_PERIOD + 1);
                    await assertedSetCarPrice(auction, carPrice, manager);
                    await assertedValidateCarPrice(
                        auction, manager, carPrice, CAR_IDS.length, CAR_IDS.length + 1, true);
                });
            });

            it('can validate car price in more than 1 transaction', async function () {
                const numBids = 10;
                const numTransactions = 2;
                const carPrice = 9;
                //await auction.setMaxIter(numBids / numTransactions, { from: manager });
                await auction.setMaxIter(5, { from: manager });
                for (let i = 0; i < numBids; i++) {
                    console.log(`${i} ${users[i]}`);
                    await assertedBid(auction, users[i], i + 1);
                }
                await increaseTime(BIDDING_PERIOD + 1);
                console.log(`setCarPrice`);
                await auction.setCarPrice(carPrice, { from: manager });

                console.log(`carPrice = ${(await auction.carPrice.call()).toNumber()}`);
                console.log(`lastCheckedBidderIndex = ${(await auction.lastCheckedBidderIndex.call()).toNumber()}`);
                console.log(`numWinnersCounted = ${(await auction.numWinnersCounted.call()).toNumber()}`);
                console.log(`numCarsSold = ${(await auction.numCarsSold.call()).toNumber()}`);

                console.log(`validateCarPrice`);
                await auction.validateCarPrice({ from: manager });

                console.log(`carPrice = ${(await auction.carPrice.call()).toNumber()}`);
                console.log(`lastCheckedBidderIndex = ${(await auction.lastCheckedBidderIndex.call()).toNumber()}`);
                console.log(`numWinnersCounted = ${(await auction.numWinnersCounted.call()).toNumber()}`);
                console.log(`numCarsSold = ${(await auction.numCarsSold.call()).toNumber()}`);

                console.log(`validateCarPrice`);
                await auction.validateCarPrice({ from: manager });

                console.log(`carPrice = ${(await auction.carPrice.call()).toNumber()}`);
                console.log(`lastCheckedBidderIndex = ${(await auction.lastCheckedBidderIndex.call()).toNumber()}`);
                console.log(`numWinnersCounted = ${(await auction.numWinnersCounted.call()).toNumber()}`);
                console.log(`numCarsSold = ${(await auction.numCarsSold.call()).toNumber()}`);

            });

            it('can ammend the car price only with a different price', async function () {
                await assertedBid(auction, users[0], 10);
                await increaseTime(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, 20, manager);
                await assertRevert(assertedSetCarPrice(auction, 20, manager));
                await assertedSetCarPrice(auction, 10, manager);
            });

            it('cannot change the car price once validated', async function () {
                await assertedBid(auction, users[0], 10);
                await increaseTime(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, 10, manager);
                await assertedValidateCarPrice(
                    auction, manager, 10, CAR_IDS.length, 1, true);
                await assertRevert(assertedSetCarPrice(auction, 20, manager));
            });
        });

        describe('redeem car & withdraw bid', async function () {
            it('cannot redeem car if car price has not been validated yet', async function () {
                const bidAmount = new BigNumber(3);
                await assertedBid(auction, users[0], bidAmount);
                await increaseTime(BIDDING_PERIOD + 1);
                await assertRevert(auction.redeemCar({ from: users[0] }));
            });

            it('cannot withdraw bid if car price has not been validated yet', async function () {
                const bidAmount = new BigNumber(3);
                await assertedBid(auction, users[0], bidAmount);
                await increaseTime(BIDDING_PERIOD + 1);
                await assertRevert(auction.withdrawBid({ from: users[0] }));
            });

            it('only winners can redeem car and losers withdraw bids', async function () {
                for (let i = 0; i < CAR_IDS.length + 1; i++) {
                    await assertedBid(auction, users[i], i + 1);
                }
                await increaseTime(BIDDING_PERIOD + 1);
                await assertedSetCarPrice(auction, 2, manager);
                await assertedValidateCarPrice(
                    auction, manager, 2, CAR_IDS.length, CAR_IDS.length + 1, true);
                await assertRevert(auction.redeemCar({ from: users[0] }));
                await assertRevert(auction.withdrawBid({ from: users[1] }));
                await assertedRedeemCar(auction, token, users[1], 2, 2);
                await assertedWithdrawBid(auction, users[0], 1);
            });

            describe('more winners than auctioned cars', async function () {
                // TODO
                describe('cars are sold out', async function () {
                    it('remaining winners can withdraw their bids', async function () {
                    });

                    it('winner cannot withdraw if already redeemed a car', async function () {
                    });
                });
            });

            describe('less bidders than auctioned cars', async function () {
                // TODO
            });

            it('bidder cannot be redeem or withdraw more than once', async function () {
                const carPrice = new BigNumber(1);
                const bidAmount = new BigNumber(3);
                await assertedBid(auction, users[0], bidAmount);
                await increaseTime(BIDDING_PERIOD + 1);
                await auction.setCarPrice(carPrice, { from: manager });
                await auction.validateCarPrice({ from: manager });
                await assertedRedeemCar(auction, token, users[0], carPrice, bidAmount);
                await assertRevert(auction.redeemCar({ from: users[0] }));
                // TODO: withdraw bid
            });

            it('cannot claim more cars than the number of auctioned cars',
                async function () {

                    // TODO

                    // const carPrice = new BigNumber(1);
                    // const bidAmount = new BigNumber(2);
                    // for (let i = 0; i <= CAR_IDS.length; i++) {
                    //     await assertedBid(auction, users[i], bidAmount);
                    // }
                    // await increaseTime(BIDDING_PERIOD + 1);
                    // await auction.setCarPrice(carPrice, { from: manager });
                    // let numWinners = (await auction.numWinners.call()).toNumber();

                    // assert.equal(numWinners, CAR_IDS.length + 1,
                    //     `Number of winners should be the number of auctioned cars plus 1`);

                    // for (let i = 0; i < CAR_IDS.length; i++) {
                    //     await assertedRedeemCar(auction, token, users[i], carPrice, bidAmount);
                    // }

                    // numWinners = (await auction.numWinners.call()).toNumber();
                    // let numCarsTransferred = (await auction.numCarsTransferred.call()).toNumber();

                    // // TODO: check numWinners and numCarsTransferred and CAR_IDS.length

                    // await assertRevert(auction.redeemCar({ from: users[CAR_IDS.length] }));

                });

        });

        describe('withdraw', async function () {
            const carPrice = new BigNumber(3);
            const bidAmounts = [
                new BigNumber(2),
                new BigNumber(3),
                new BigNumber(3),
                new BigNumber(3),
                new BigNumber(3),
                new BigNumber(10)];

            beforeEach(async function () {
                for (let i = 0; i < bidAmounts.length; i++) {
                    await assertedBid(auction, users[i], bidAmounts[i]);
                }
            });

            it('cannot do it before bidding end time', async function () {
                await assertRevert(assertedWithdraw(auction, carPrice, 4, manager));
            });

            it('cannot do it if car price has not been set', async function () {
                await increaseTime(BIDDING_PERIOD + 1);
                await assertRevert(assertedWithdraw(auction, carPrice, 4, manager));
            });

            describe('ready to withdraw', async function () {
                beforeEach(async function () {
                    await increaseTime(BIDDING_PERIOD + 1);
                    await auction.setCarPrice(carPrice, { from: manager });
                    await auction.validateCarPrice({ from: manager });
                });

                it('only manager can do it', async function () {
                    await assertRevert(assertedWithdraw(
                        auction, carPrice, 0, owner));
                    await assertedWithdraw(auction, carPrice.times(5), 0, manager);
                });
            });
        });

        describe('destroy', async function () {
            it('contract must not own ether nor cars before destroying it', async function () {
                await assertedBid(auction, users[0], 1);
                await assertRevert(auction.destroy({ from: owner }));
                await assertedCancelBid(auction, users[0]);
                await assertRevert(auction.destroy({ from: owner }));
                await assertedCancelAuction(auction);
                await auction.destroy({ from: owner });
            });
        });
    });

    describe('safety timeout', async function () {
        before(async function () {
            token = await assertedCreateTokenContract();
            auction = await assertedCreateAuctionContract(token.address);
            await assertedCreateCars(token, CAR_IDS);
            await assertedCreateAuction(token, auction, CAR_IDS, BIDDING_PERIOD, manager);
            for (let i = 0; i < 10; i++) {
                await assertedBid(auction, users[i], 10 * i + 1);
            }
            const SAFETY_TIMEOUT_SEC = parseInt(await auction.SAFETY_TIMEOUT_SEC.call());
            await increaseTime(BIDDING_PERIOD + SAFETY_TIMEOUT_SEC + 1);
        });

        it('bidders can withdraw their bids', async function () {
            for (let i = 0; i < 10; i++) {
                await assertedWithdrawBid(auction, users[i], 10 * i + 1);
            }
        });

        it('car price cannot be set after timeout', async function () {
            await assertRevert(auction.setCarPrice(10, { from: manager }));
        });
    });

    describe('realistic full workflow', async function () {
        before(async function () {
            token = await assertedCreateTokenContract();
            auction = await assertedCreateAuctionContract(token.address);
            await assertedCreateCars(token, CAR_IDS);
            await assertedCreateAuction(token, auction, CAR_IDS, BIDDING_PERIOD, manager);
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
            await increaseTime(BIDDING_PERIOD + 1);

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
