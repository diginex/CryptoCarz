"use strict";

const CryptoCarzAuction = artifacts.require('./CryptoCarzAuction.sol');
const CryptoCarzToken = artifacts.require("./CryptoCarzToken.sol");
import assertRevert from './assertRevert';
import constants from './constants';


contract('CryptoCarzToken', function (accounts) {

    const owner = accounts[9];
    const manager = accounts[8]
    const treasurer = accounts[7]
    const someoneElse = accounts[6];
    const users = accounts.slice(1, 3);

    let token;

    async function checkCreateCars(token, createCars, carIds, seriesId, tokenOwner) {
        for (let i = 0; i < carIds.length; i++) {
            assert.equal(await token.carSeries(carIds[i]), seriesId);
            assert.equal(await token.ownerOf(carIds[i]), tokenOwner);
        }
        const createCarsLogIndex = createCars.logs.length - 1;
        assert.equal(createCars.logs[createCarsLogIndex].event, 'CreateCars');
        assert.equal(`${createCars.logs[createCarsLogIndex].args.tokenIds.valueOf()}`, `${carIds}`);
        assert.equal(createCars.logs[createCarsLogIndex].args.seriesId.valueOf(), seriesId);
    }

    async function checkCreateSeries(token, createSeries, seriesId, seriesMaxCars) {
        assert.equal(createSeries.logs[0].event, 'CreateSeries');
        assert.equal(createSeries.logs[0].args.seriesId.valueOf(), seriesId);
        assert.equal(createSeries.logs[0].args.seriesMaxCars.valueOf(), seriesMaxCars);
        assert.equal(await token.seriesMaxCars(seriesId), seriesMaxCars);
    }

    async function checkPause(contract, pause) {
        assert.equal(pause.logs[0].event, 'Pause');
        const paused = await contract.paused();
        assert.equal(paused, true, "paused should be true");
    }

    async function checkUnpause(contract, unpause) {
        assert.equal(unpause.logs[0].event, 'Unpause');
        const paused = await contract.paused();
        assert.equal(paused, false, "paused should be false");
    }

    async function checkTokensOwnedBy(token, tokenIds, owner) {
        if (typeof tokenIds[Symbol.iterator] !== 'function') {
            tokenIds = [tokenIds];
        }

        for (let tokenId of tokenIds) {
            assert.equal(await token.ownerOf(tokenId), owner);
        }
    }

    async function assertedTransferFrom(token, from, to, tokenId, account) {
        const fromBalance = (await token.balanceOf(from)).toNumber();
        const toBalance = (await token.balanceOf(to)).toNumber();
        await checkTokensOwnedBy(token, tokenId, from);
        await token.transferFrom(from, to, tokenId, { from: account });
        await checkTokensOwnedBy(token, tokenId, to);
        assert.equal(await token.balanceOf(from), fromBalance - 1);
        assert.equal(await token.balanceOf(to), toBalance + 1);
    }

    async function assertedSafeTransferFrom(token, from, to, tokenId, account) {
        const fromBalance = (await token.balanceOf(from)).toNumber();
        const toBalance = (await token.balanceOf(to)).toNumber();
        await checkTokensOwnedBy(token, tokenId, from);
        await token.safeTransferFrom(from, to, tokenId, { from: account });
        await checkTokensOwnedBy(token, tokenId, to);
        assert.equal(await token.balanceOf(from), fromBalance - 1);
        assert.equal(await token.balanceOf(to), toBalance + 1);
    }

    async function assertedSafeTransfersFrom(token, from, to, tokenIds, account) {
        const fromBalance = (await token.balanceOf(from)).toNumber();
        const toBalance = (await token.balanceOf(to)).toNumber();
        await checkTokensOwnedBy(token, tokenIds, from);
        await token.safeTransfersFrom(from, to, tokenIds, { from: account });
        await checkTokensOwnedBy(token, tokenIds, to);
        assert.equal(await token.balanceOf(from), fromBalance - tokenIds.length);
        assert.equal(await token.balanceOf(to), toBalance + tokenIds.length);
    }

    beforeEach(async function () {
        token = await CryptoCarzToken.new(owner, manager, treasurer, { from: someoneElse });
        const createSeries = await token.createSeries(4, { from: manager });
        await checkCreateSeries(token, createSeries, 0, 4);
    });

    describe('constructor', async function () {
        it('treasurer cannot be 0x0', async function () {
            await assertRevert(CryptoCarzToken.new(owner, manager, constants.ZERO_ADDRESS, { from: someoneElse }));
        });

        it('treasurer cannot be the same as the owner or the manager', async function () {
            await assertRevert(CryptoCarzToken.new(owner, manager, owner, { from: someoneElse }));
            await assertRevert(CryptoCarzToken.new(owner, manager, manager, { from: someoneElse }));
        });
    });

    describe('treasurer', async function () {
        it('treasurer can be changed', async function () {
            await token.setTreasurer(someoneElse, { from: owner });
        });

        it('treasurer cannot be changed to 0x0', async function () {
            await assertRevert(token.setTreasurer(constants.ZERO_ADDRESS, { from: owner }));
        });

        it('treasurer cannot be changed to be the same as the owner or the manager',
            async function () {
                await assertRevert(token.setTreasurer(owner, { from: owner }));
                await assertRevert(token.setTreasurer(manager, { from: owner }));
            });
    });

    describe('create cars', async function () {
        it('create some cars', async function () {
            const SERIES_COUNT = 3;
            const SERIES_MAX_CARS = 5;

            for (let seriesId = 1; seriesId <= SERIES_COUNT; seriesId++) {
                const totalSupply = await token.totalSupply({ from: someoneElse });
                const createSeries = await token.createSeries(SERIES_MAX_CARS, { from: manager });
                await checkCreateSeries(token, createSeries, seriesId, SERIES_MAX_CARS);
                const carIds = Array(SERIES_MAX_CARS).fill().map((x, i) => parseInt(i) + parseInt(totalSupply));
                const createCars = await token.createCars(carIds, seriesId, { from: manager });
                await checkCreateCars(token, createCars, carIds, seriesId, manager);
            }

            const totalSupply = await token.totalSupply({ from: someoneElse });
            assert.equal(totalSupply, SERIES_COUNT * SERIES_MAX_CARS, 'basic tokens count');
        });

        it('cannot create cars which were already created', async function () {
            let carIds = [0, 1, 2];
            const seriesId = 0;

            let createCars = await token.createCars(carIds, seriesId, { from: manager });
            await checkCreateCars(token, createCars, carIds, seriesId, manager);

            carIds = [1];
            await assertRevert(token.createCars(carIds, seriesId, { from: manager }));

            // can create a car now with a new carId
            carIds = [3];
            createCars = await token.createCars(carIds, seriesId, { from: manager });
            await checkCreateCars(token, createCars, carIds, seriesId, manager);
        });

        it('only manager can create new cars', async function () {
            const carIds = [0, 1, 2];
            const seriesId = 0;
            await assertRevert(token.createCars(carIds, seriesId, { from: owner }));
        });

        it('cannot create new cars when paused', async function () {
            let carIds = [0, 1, 2];
            const seriesId = 0;

            let createCars = await token.createCars(carIds, seriesId, { from: manager });
            await checkCreateCars(token, createCars, carIds, seriesId, manager);

            await token.pause({ from: manager });

            carIds = [3];
            await assertRevert(token.createCars(carIds, seriesId, { from: manager }));

            await token.unpause({ from: owner });

            createCars = await token.createCars(carIds, seriesId, { from: manager });
            await checkCreateCars(token, createCars, carIds, seriesId, manager);
        });

        it('cannot create more cars within a series than the series max number of cars',
            async function () {
                let carIds = [0, 1, 2];
                const seriesId = 0;

                let createCars = await token.createCars(carIds, seriesId, { from: manager });
                await checkCreateCars(token, createCars, carIds, seriesId, manager);

                carIds = [3, 4, 5];
                await assertRevert(token.createCars(carIds, seriesId, { from: manager }));
            });

        it('cannot create new cars within non-existent series', async function () {
            try {
                await token.createCars([0], Number.MAX_SAFE_INTEGER, { from: manager });
                assert.fail('Expected invalid opcode not received');
            } catch (error) {
                const revertFound = error.message.search('invalid opcode') >= 0;
                assert(revertFound, `Expected "invalid opcode", got ${error} instead`);
            }
        });
    });

    describe('series', async function () {
        it('create series', async function () {
            await assertRevert(token.createSeries(0, { from: manager }));
        });

        it('cannot create a series of max 0 tokens', async function () {
            await assertRevert(token.createSeries(0, { from: manager }));
        });

        it('only manager can create series', async function () {
            await assertRevert(token.createSeries(1, { from: owner }));
        });

        it('cannot create series if paused', async function () {
            await token.pause({ from: manager });
            await assertRevert(token.createSeries(1, { from: manager }));
            await token.unpause({ from: owner });
            let createSeries = await token.createSeries(1, { from: manager });
            checkCreateSeries(token, createSeries, 1, 1);
        });
    });

    describe('transfer', async function () {
        beforeEach(async function () {
            await token.createCars([0, 1, 2], 0, { from: manager });
        });

        // Solidity coverage for CryptoCarzToken.canTransfer().
        it('cannot transfer tokens not owned by sender', async function () {
            await assertRevert(token.transferFrom(manager, users[0], 0, { from: owner }));
        });

        it('cannot transfer 0 tokens', async function () {
            await assertRevert(token.safeTransfersFrom(manager, users[0], [], { from: manager }));
        });

        it('cannot transfer tokens if paused', async function () {
            const pause = await token.pause({ from: manager });
            await checkPause(token, pause);
            await assertRevert(token.transferFrom(manager, users[0], 0, { from: manager }));
            await assertRevert(token.safeTransferFrom(manager, users[0], 1, { from: manager }));
            await assertRevert(token.safeTransfersFrom(manager, users[0], [2], { from: manager }));
            const unpause = await token.unpause({ from: owner });
            await checkUnpause(token, unpause);
            await assertedTransferFrom(token, manager, users[0], 0, manager);
            await assertedSafeTransferFrom(token, manager, users[0], 1, manager);
            await assertedSafeTransfersFrom(token, manager, users[0], [2], manager);
        });
    });

    describe('auction', async function () {
        it('can create auctions', async function () {
            const createAuction = await token.createAuction({ from: manager });
            assert.equal(createAuction.logs[0].event, 'CreateAuction');
            const auction = CryptoCarzAuction.at(createAuction.logs[0].args.contractAddress.valueOf());
            const initialized = await auction.initialized.call();
            assert.isBoolean(initialized);
            assert.isFalse(initialized);
        });
    });

    describe('upgrade', async function () {
        // TODO
    });
});
