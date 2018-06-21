"use strict";

const CryptoCarzAuction = artifacts.require('./CryptoCarzAuction.sol');
const CryptoCarzToken = artifacts.require('./CryptoCarzToken.sol');
import assertRevert from './assertRevert';
import increaseTime from './increaseTime';
const seedrandom = require('seedrandom');
const BigNumber = web3.BigNumber;
require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bignumber')(BigNumber))
    .should();

contract('CryptoCarzAuction', function (accounts) {

    const ETHER = new BigNumber('1e18');
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

    const MINUTE = 60;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const WEEK = 7 * DAY;
    const MONTH = 30 * DAY;
    const YEAR = 12 * MONTH;

    let GAS_TOLERANCE_PERCENT = 5;

    const SERIES_ID = 0;
    const CARD_IDS = [1, 2, 3, 4, 5];
    const BIDDING_PERIOD = 1 * WEEK;

    const NUM_ACCOUNTS = process.env.NUM_ACCOUNTS || 30;
    const owner = accounts[NUM_ACCOUNTS - 1];
    const manager = accounts[NUM_ACCOUNTS - 2];
    const someoneElse = accounts[NUM_ACCOUNTS - 3];
    const users = accounts.slice(1, NUM_ACCOUNTS - 4);

    const NUM_BIDDERS = NUM_ACCOUNTS - 10;
    const NUM_BID_UPGRADES = 2;

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

        const redeemCar = await auction.redeemCar(redeemer, { from: someoneElse });

        assert.equal(redeemCar.logs[0].event, 'CarRedeemed');
        assert.equal(redeemCar.logs[0].args.redeemer.valueOf(), redeemer);
        const carId = redeemCar.logs[0].args.carId.valueOf();
        const bidExcessAmount = new BigNumber(redeemCar.logs[0].args.bidExcessAmount.valueOf());

        assert.equal(redeemer, await token.ownerOf(carId),
            `error when checking ownerwship of carId = ${carId} by redeemer = ${redeemer}`);
        const balanceAfter = new BigNumber(await web3.eth.getBalance(redeemer));
        // balanceAfter = balanceBefore + bidExcessAmount = balanceBefore + (bidAmount - carPrice)
        bidExcessAmount.should.be.bignumber.equal(bidAmount.minus(carPrice),
            `wrong bidExcessAmount for redeemer ${redeemer}`);
        balanceAfter.should.be.bignumber.equal(balanceBefore.plus(bidExcessAmount),
            `wrong balanceAfter for redeemer ${redeemer}`);
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
        auction, etherTo, expectedEtherAmountInWei, carsTo, expectNumCars, account) {
        const balanceBefore = new BigNumber(await web3.eth.getBalance(etherTo));

        const withdraw = await auction.withdraw(etherTo, carsTo, { from: account });
        // TODO: check withdraw

        const balanceAfter = new BigNumber(await web3.eth.getBalance(etherTo));

        balanceAfter.should.be.bignumber.equal(balanceBefore.plus(expectedEtherAmountInWei),
            `wrong balance amount ${balanceAfter}`);

        // TODO: check num cars too
    }

    async function assertedCreateTokenContract() {
        token = await CryptoCarzToken.new(owner, manager, { from: someoneElse });
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
        await token.transfersFrom(manager, auction.address, carIds, { from: manager });
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

    describe('constructor', async function () {
        it('token contract address cannot be 0x0', async function () {
            await assertedCreateAuctionContract(accounts[0]);
            await assertRevert(assertedCreateAuctionContract(ZERO_ADDRESS));
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
            await assertedCreateCars(token, CARD_IDS);
            now = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
        });

        it('at least 1 car must be auctioned', async function () {
            await assertRevert(assertedCreateAuction(token, auction, [], BIDDING_PERIOD, manager));
            await assertedCreateAuction(token, auction, [CARD_IDS[0]], BIDDING_PERIOD, manager);
        });

        it('bidding end time must be in the future', async function () {
            await assertRevert(assertedCreateAuction(token, auction, CARD_IDS, -BIDDING_PERIOD, manager));
        });

        it('auction cannot be too short or too long', async function () {
            const minAuctionPeriodSec = (await auction.MIN_AUCTION_PERIOD_SEC.call({ from: someoneElse })).toNumber();
            const maxAuctionPeriodSec = (await auction.MAX_AUCTION_PERIOD_SEC.call({ from: someoneElse })).toNumber();
            await token.transfersFrom(manager, auction.address, CARD_IDS, { from: manager });
            await assertRevert(auction.newAuction(CARD_IDS, now + minAuctionPeriodSec - 1, { from: manager }));
            await assertRevert(auction.newAuction(CARD_IDS, now + maxAuctionPeriodSec + 1, { from: manager }));
        });

        it('only manager can create a new auction', async function () {
            await assertRevert(assertedCreateAuction(token, auction, CARD_IDS, BIDDING_PERIOD, owner));
        });

        it('car tokens need to belong to auction contract to start the auction', async function () {
            await auction.newAuction(CARD_IDS, now + BIDDING_PERIOD, { from: manager });
            await assertRevert(auction.newAuction(CARD_IDS, now + BIDDING_PERIOD, { from: manager }));
        });
    });


    describe('auction initialized', async function () {

        beforeEach(async function () {
            token = await assertedCreateTokenContract();
            auction = await assertedCreateAuctionContract(token.address);
            await assertedCreateCars(token, CARD_IDS);
            await assertedCreateAuction(token, auction, CARD_IDS, BIDDING_PERIOD, manager);
            now = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
        });

        describe('extend auction', async function () {
            it('cannot extend longer than a maximum', async function () {
                const maxAuctionPeriodSec = (await auction.MAX_AUCTION_PERIOD_SEC.call({ from: someoneElse })).toNumber();
                now = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
                await auction.extendAuction(now + maxAuctionPeriodSec, { from: manager });
                now = web3.eth.getBlock(web3.eth.blockNumber).timestamp;
                await assertRevert(auction.extendAuction(now + maxAuctionPeriodSec + DAY, { from: manager }));
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
                await assertedCreateCars(token, CARD_IDS);
                await assertRevert(auction.bid({ from: users[0], value: 1 }));
                await assertedCreateAuction(token, auction, CARD_IDS, BIDDING_PERIOD, manager);
                await auction.bid({ from: users[0], value: 1 });
            });

            it('cannot bid 0 ether', async function () {

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
            it('cannot set car price before bidding end time', async function () {
                await assertedBid(auction, users[0], 1);
                await assertRevert(auction.setCarPrice(1, { from: manager }));
            });

            it('cannot set car price to 0', async function () {
                await assertedBid(auction, users[0], 1);
                await increaseTime(BIDDING_PERIOD + 1);
                await assertRevert(auction.setCarPrice(0, { from: manager }));
            });

            it('number of winners can be larger than number of auctioned cars', async function () {
                for (let i = 0; i <= CARD_IDS.length; i++) {
                    await assertedBid(auction, users[i], 2);
                }
                await increaseTime(BIDDING_PERIOD + 1);
                await auction.setCarPrice(1, { from: manager });
                const numWinners = (await auction.numWinners.call()).toNumber();
                assert.equal(numWinners, CARD_IDS.length + 1,
                    `Number of winners should be the number of auctioned cars plus 1`);
            });

            it('there can be no winners', async function () {
                await assertedBid(auction, users[0], 1);
                await increaseTime(BIDDING_PERIOD + 1);
                await auction.setCarPrice(2, { from: manager });
                const numWinners = (await auction.numWinners.call()).toNumber();
                assert.equal(numWinners, 0, `Number of winners should be zero`);
                await assertedWithdrawBid(auction, users[0], 1);
            });

            it('cannot set car price if auction was cancelled', async function () {
                await assertedBid(auction, users[0], 1);
                await assertedCancelAuction(auction);
                await increaseTime(BIDDING_PERIOD + 1);
                await assertRevert(auction.setCarPrice(1, { from: manager }));
            });
        });

        describe('redeem car & withdraw bid', async function () {
            it('cannot redeem car if car price has not been set', async function () {
                const bidAmount = new BigNumber(3);
                await assertedBid(auction, users[0], bidAmount);
                await increaseTime(BIDDING_PERIOD + 1);
                await assertRevert(auction.redeemCar(users[0], { from: someoneElse }));
            });

            it('can withdraw bid even if car price has not been set', async function () {
                const bidAmount = new BigNumber(3);
                await assertedBid(auction, users[0], bidAmount);
                await increaseTime(BIDDING_PERIOD + 1);
                await assertedWithdrawBid(auction, users[0], bidAmount);
            });

            it('only winners can redeem car and losers can withdraw bid', async function () {
                const carPrice = new BigNumber(5);
                const bidAmounts = [new BigNumber(3), new BigNumber(10)];
                await assertedBid(auction, users[0], bidAmounts[0]);
                await assertedBid(auction, users[1], bidAmounts[1]);
                await increaseTime(BIDDING_PERIOD + 1);
                await auction.setCarPrice(carPrice, { from: manager });
                await assertRevert(auction.redeemCar(users[0], { from: someoneElse }));
                await assertRevert(auction.withdrawBid({ from: users[1] }));
                await assertedRedeemCar(auction, token, users[1], carPrice, bidAmounts[1]);
                await assertedWithdrawBid(auction, users[0], bidAmounts[0]);
            });


            it('cannot be done more than once by the same account', async function () {
                const carPrice = new BigNumber(1);
                const bidAmount = new BigNumber(3);
                await assertedBid(auction, users[0], bidAmount);
                await increaseTime(BIDDING_PERIOD + 1);
                await auction.setCarPrice(carPrice, { from: manager });
                await assertedRedeemCar(auction, token, users[0], carPrice, bidAmount);
                await assertRevert(auction.redeemCar(users[0], { from: someoneElse }));
                // TODO: withdraw bid
            });

            it('cannot claim more cars than the number of auctioned cars',
                async function () {
                    const carPrice = new BigNumber(1);
                    const bidAmount = new BigNumber(2);
                    for (let i = 0; i <= CARD_IDS.length; i++) {
                        await assertedBid(auction, users[i], bidAmount);
                    }
                    await increaseTime(BIDDING_PERIOD + 1);
                    await auction.setCarPrice(carPrice, { from: manager });
                    let numWinners = (await auction.numWinners.call()).toNumber();

                    assert.equal(numWinners, CARD_IDS.length + 1,
                        `Number of winners should be the number of auctioned cars plus 1`);

                    for (let i = 0; i < CARD_IDS.length; i++) {
                        await assertedRedeemCar(auction, token, users[i], carPrice, bidAmount);
                    }

                    numWinners = (await auction.numWinners.call()).toNumber();
                    let numCarsTransferred = (await auction.numCarsTransferred.call()).toNumber();

                    // TODO: check numWinners and numCarsTransferred and CARD_IDS.length

                    await assertRevert(auction.redeemCar(users[CARD_IDS.length],
                        { from: someoneElse }));
                });

            it('can redeem cars and withdraw bids', async function () {
                const carPrice = new BigNumber(5);
                const bidAmounts = [new BigNumber(3), new BigNumber(10)];
                await assertedBid(auction, users[0], bidAmounts[0]);
                await assertedBid(auction, users[1], bidAmounts[1]);
                await increaseTime(BIDDING_PERIOD + 1);
                await auction.setCarPrice(carPrice, { from: manager });
                await assertedWithdrawBid(auction, users[0], bidAmounts[0])
                await assertedRedeemCar(auction, token, users[1], carPrice, bidAmounts[1]);
            });
        });

        describe('withdraw', async function () {
            const carPrice = new BigNumber(5);
            const bidAmounts = [new BigNumber(3), new BigNumber(10)];

            beforeEach(async function () {
                for (let i = 0; i < bidAmounts.length; i++) {
                    await assertedBid(auction, users[i], bidAmounts[i]);
                }
            });

            it('cannot do it before bidding end time', async function () {
                await assertRevert(assertedWithdraw(auction, owner, carPrice, owner, 4, manager));
            });

            it('cannot do it if car price has not been set', async function () {
                await increaseTime(BIDDING_PERIOD + 1);
                await assertRevert(assertedWithdraw(auction, owner, carPrice, owner, 4, manager));
            });

            describe('ready to withdraw', async function () {
                beforeEach(async function () {
                    await increaseTime(BIDDING_PERIOD + 1);
                    await auction.setCarPrice(carPrice, { from: manager });
                });

                it('withdraw addresses cannot be 0x0', async function () {
                    await assertRevert(assertedWithdraw(
                        auction, ZERO_ADDRESS, carPrice, owner, 4, manager));
                    await assertRevert(assertedWithdraw(
                        auction, owner, carPrice, ZERO_ADDRESS, 4, manager));
                    await assertedWithdraw(auction, owner, carPrice, owner, 4, manager);
                });

                it('only manager can do it', async function () {
                    await assertRevert(assertedWithdraw(
                        auction, owner, carPrice, owner, 4, owner));
                    await assertedWithdraw(auction, owner, carPrice, owner, 4, manager);
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

    describe('realistic full workflow', async function () {
        before(async function () {
            token = await assertedCreateTokenContract();
            auction = await assertedCreateAuctionContract(token.address);
            await assertedCreateCars(token, CARD_IDS);
            await assertedCreateAuction(token, auction, CARD_IDS, BIDDING_PERIOD, manager);
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

            const rng = seedrandom('seed');
            const bidAmounts = {};
            const maxNumWinners = CARD_IDS.length;

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

            await auction.setCarPrice(carPrice, { from: manager });
            const numWinners = await auction.numWinners.call();

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
            const expectedAmount = carPrice.times(numWinners);
            await assertedWithdraw(auction, owner, expectedAmount, manager, 0, manager);
            '0'.should.be.bignumber.equal(await web3.eth.getBalance(auction.address));
        });
    });
});
