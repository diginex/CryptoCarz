"use strict";

const CryptoCarzAuction = artifacts.require('./CryptoCarzAuction.sol');
const CryptoCarzToken = artifacts.require('./CryptoCarzToken.sol');
import assertRevert from './assertRevert';
import increaseTime from './increaseTime';
const seedrandom = require('seedrandom');
const BigNumber = require('bignumber.js');
require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bignumber')(BigNumber))
    .should();

contract('CryptoCarzAuction', function (accounts) {

    let ETHER = new BigNumber('1e18');

    const MINUTE = 60;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const WEEK = 7 * DAY;
    const MONTH = 30 * DAY;
    const YEAR = 12 * MONTH;

    const MAX_ERROR = 10000000;

    let GAS_TOLERANCE_PERCENT = 5;

    const BIDDING_PERIOD = 1 * WEEK;

    const AUCTION_NUM_WINNERS = 3;
    const CARD_IDS = [1, 2, 3, 4, 5];
    const SERIES_ID = 0;

    const ETH_BLOCK_GAS_LIMIT = 7500000;

    const NUM_ACCOUNTS = process.env.NUM_ACCOUNTS || 30;
    let owner = accounts[NUM_ACCOUNTS - 1];
    let manager = accounts[NUM_ACCOUNTS - 2];
    let someoneElse = accounts[NUM_ACCOUNTS - 3];
    let users = accounts.slice(1, NUM_ACCOUNTS - 4);

    const REALISTIC_AUCTION_PARAMS = {
        NUM_BIDDERS: NUM_ACCOUNTS - 10,
        NUM_BID_UPGRADES: 2,
        AUCTION_NUM_WINNERS: 10
    };

    let token;
    let auction;

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
        const bidderAmountBefore = new BigNumber(await auction.getBidderAmount(bidder));
        const bid = await auction.bid({ from: bidder, value: bidAmount });
        const balanceAfter = new BigNumber(await web3.eth.getBalance(bidder));
        const bidderAmountAfter = new BigNumber(await auction.getBidderAmount(bidder));
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

    async function assertedRedeemCar(auction, token, redeemer) {
        const isWinner = await auction.isWinner(redeemer, { from: someoneElse });
        assert.equal(isWinner, true, `bidder needs to be a winner to be eligible to a car`);
        const redeemCar = await auction.redeemCar({ from: redeemer });
        assert.equal(redeemCar.logs[0].event, 'CarRedeemed');
        assert.equal(redeemCar.logs[0].args.redeemer.valueOf(), redeemer);
        const carId = redeemCar.logs[0].args.carId.valueOf();
        assert.equal(redeemer, await token.ownerOf(carId),
            `error when checking ownerwship of carId = ${carId} by redeemer = ${redeemer}`);
        return carId;
    }

    async function assertedWithdraw(auction, withdrawer) {
        const isWinner = await auction.isWinner(redeemer, { from: someoneElse });
        assert.equal(isWinner, false, `bidder needs to be a loser to be eligible to withdraw`);
        const withdraw = await auction.withdraw({ from: withdrawer });
        assert.equal(redeemCar.logs[0].event, 'CarRedeemed');
        assert.equal(redeemCar.logs[0].args.redeemer.valueOf(), redeemer);
        const carId = redeemCar.logs[0].args.carId.valueOf();
        assert.equal(redeemer, await token.ownerOf(carId),
            `error when checking ownerwship of carId = ${carId} by redeemer = ${redeemer}`);
        return carId;
    }

    async function createToken() {
        return await CryptoCarzToken.new(owner, manager, { from: someoneElse });
    }

    async function createAuction(token, carIds, biddingPeriod, maxNumWinners) {
        await token.createSeries(carIds.length, { from: manager });
        await token.mintTokens(CARD_IDS, 0, { from: manager });
        const auction = await CryptoCarzAuction.new(owner, manager, token.address, CARD_IDS, BIDDING_PERIOD, AUCTION_NUM_WINNERS, { from: someoneElse });
        await token.transferFrom(manager, auction.address, CARD_IDS[0], { from: manager });
        return auction;
    }

    describe('auction workflow', async function () {

        // WIP

        let token = null;
        let auction = null;

        describe('full auction', async function () {
            before(async function () {
                token = await createToken();
                auction = await createAuction(token, CARD_IDS, BIDDING_PERIOD, AUCTION_NUM_WINNERS);
            });

            it('full auction', async function () {
                const rng = seedrandom('seed');
                const bidAmounts = {};
                for (let t = 0; t < REALISTIC_AUCTION_PARAMS.NUM_BID_UPGRADES; t++) {
                    for (let i = 0; i < REALISTIC_AUCTION_PARAMS.NUM_BIDDERS; i++) {
                        const user = users[i];
                        const bidAmount = ETHER.times(new BigNumber(`${rng()}`)).round();
                        if (!bidAmounts[user]) {
                            bidAmounts[user] = new BigNumber(0);
                        }
                        bidAmounts[user] = bidAmounts[user].plus(bidAmount);
                        console.log(`bid round = ${t}/${REALISTIC_AUCTION_PARAMS.NUM_BID_UPGRADES}, ` +
                            `bidder = ${i}/${REALISTIC_AUCTION_PARAMS.NUM_BIDDERS}, ` +
                            `amount = ${web3.fromWei(bidAmount, 'ether')}`);
                        await assertedBid(auction, user, bidAmount);
                    }
                }

                // print out bids
                for (let i = 0; i < REALISTIC_AUCTION_PARAMS.NUM_BIDDERS; i++) {
                    const user = users[i];
                    console.log(`${i},${web3.fromWei(bidAmounts[user], 'ether')}`);
                }
                // 0,1.2572979031141229
                // 1,1.5276522980328274
                // 2,0.37707904596853842
                // 3,0.97391569726276947
                // 4,1.04022123688020275
                // 5,0.86903661366605477
                // 6,0.69149852780543028
                // 7,1.01438868584953007
                // 8,1.4028551534013854
                // 9,1.3238318021259011
                // 10,1.0223862742732441
                // 11,0.65200512853794046
                // 12,1.5798274897657981
                // 13,0.341819224851156614
                // 14,0.9180615409183977
                // 15,1.2971149278029534
                // 16,0.43439851128307989
                // 17,0.60439319256917789
                // 18,1.12730429775218267
                // 19,1.437755121600653

                // auction ends
                //console.log(`${web3.eth.getBlock('latest').timestamp}`);
                await increaseTime(BIDDING_PERIOD + 1);
                //console.log(`${web3.eth.getBlock('latest').timestamp}`);
                //console.log(`${await auction.biddingEndTime.call()}`);

                // set auction's final car price
                const carPrice = new BigNumber(ETHER.times('0.9074015751'));
                const setCarPrice = await auction.setCarPrice(carPrice, { from: manager });

                await assertedRedeemCar(auction, token, users[1]);

                // WIP
                //await withdraw()
            });
        });
    });
});
