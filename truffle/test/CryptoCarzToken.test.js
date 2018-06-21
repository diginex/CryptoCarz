"use strict";

const CryptoCarzToken = artifacts.require("./CryptoCarzToken.sol");
import assertRevert from './assertRevert';


contract('CryptoCarzToken', function (accounts) {

    const owner = accounts[9];
    const manager = accounts[8]
    const someoneElse = accounts[7];
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

    beforeEach(async function () {
        token = await CryptoCarzToken.new(owner, manager, { from: someoneElse });
        const createSeries = await token.createSeries(4, { from: manager });
        await checkCreateSeries(token, createSeries, 0, 4);
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

        it('cannot create more cars within a series than the series max number of cars', async function () {
            let carIds = [0, 1, 2];
            const seriesId = 0;

            let createCars = await token.createCars(carIds, seriesId, { from: manager });
            await checkCreateCars(token, createCars, carIds, seriesId, manager);

            carIds = [3, 4, 5];
            await assertRevert(token.createCars(carIds, seriesId, { from: manager }));
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

        it('transfer tokens', async function () {
            // TODO: clean
            let ownerOf = await token.ownerOf(2);
            await token.safeTransferFrom(manager, users[0], 2, { from: manager });
            ownerOf = await token.ownerOf(2);
        });
    });
});
