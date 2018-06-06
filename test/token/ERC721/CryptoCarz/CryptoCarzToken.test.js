"use strict";

const CryptoCarzToken = artifacts.require("./CryptoCarzToken.sol");
import assertRevert from './assertRevert';


contract('CryptoCarzToken', function (accounts) {

    let owner = accounts[9];
    let manager = accounts[8]
    let someoneElse = accounts[7];
    let users = accounts.slice(1, 3);

    let token;

    async function checkMintTokens(token, mintTokens, tokenIds, seriesId, tokenOwner) {
        // TODO: use map instead of for loop
        for (let i = 0; i < tokenIds.length; i++) {
            assert.equal(await token.tokenSeries(tokenIds[i]), seriesId);
            assert.equal(await token.ownerOf(tokenIds[i]), tokenOwner);
            // console.log(`mintTokens.logs[i].event = ${mintTokens.logs[i].event}`);
            // console.log(`mintTokens.logs[i]._from = ${mintTokens.logs[i]._from}`);
            // console.log(`mintTokens.logs[i]._to = ${mintTokens.logs[i]._to}`);
            // console.log(`mintTokens.logs[i]._tokenId = ${mintTokens.logs[i]._tokenId}`);
        }
        const mintTokensLogIndex = mintTokens.logs.length - 1;
        assert.equal(mintTokens.logs[mintTokensLogIndex].event, 'MintTokens');
        assert.equal(`${mintTokens.logs[mintTokensLogIndex].args.tokenIds.valueOf()}`, `${tokenIds}`);
        assert.equal(mintTokens.logs[mintTokensLogIndex].args.seriesId.valueOf(), seriesId);
    }

    async function checkCreateSeries(token, createSeries, seriesId, seriesMaxTokens) {
        assert.equal(createSeries.logs[0].event, 'CreateSeries');
        assert.equal(createSeries.logs[0].args.seriesId.valueOf(), seriesId);
        assert.equal(createSeries.logs[0].args.seriesMaxTokens.valueOf(), seriesMaxTokens);
        assert.equal(await token.getSeriesMaxTokens(seriesId), seriesMaxTokens);
    }

    beforeEach(async function () {
        token = await CryptoCarzToken.new(owner, manager, { from: someoneElse });
        let createSeries = await token.createSeries(4, { from: manager });
        await checkCreateSeries(token, createSeries, 0, 4);
    });

    describe('mint tokens', async function () {
        it('mint tokens', async function () {
            let SERIES_COUNT = 3;
            let SERIES_TOKEN_COUNT = 5;

            for (let seriesId = 1; seriesId <= SERIES_COUNT; seriesId++) {
                let totalSupply = await token.totalSupply({ from: someoneElse });
                let createSeries = await token.createSeries(SERIES_TOKEN_COUNT, { from: manager });
                await checkCreateSeries(token, createSeries, seriesId, SERIES_TOKEN_COUNT);
                let tokenIds = Array(SERIES_TOKEN_COUNT).fill().map((x, i) => parseInt(i) + parseInt(totalSupply));
                let mintTokens = await token.mintTokens(tokenIds, seriesId, { from: manager });
                await checkMintTokens(token, mintTokens, tokenIds, seriesId, manager);
            }

            let totalSupply = await token.totalSupply({ from: someoneElse });
            assert.equal(totalSupply, SERIES_COUNT * SERIES_TOKEN_COUNT, 'basic tokens count');
        });

        it('cannot mint tokens that are already minted', async function () {
            let tokenIds = [0, 1, 2];
            let seriesId = 0;

            let mintTokens = await token.mintTokens(tokenIds, seriesId, { from: manager });
            await checkMintTokens(token, mintTokens, tokenIds, seriesId, manager);

            tokenIds = [1];
            await assertRevert(token.mintTokens(tokenIds, seriesId, { from: manager }));

            // can mint now with a new tokenId
            tokenIds = [3];
            mintTokens = await token.mintTokens(tokenIds, seriesId, { from: manager });
            await checkMintTokens(token, mintTokens, tokenIds, seriesId, manager);
        });

        it('only manager can mint tokens', async function () {
            const tokenIds = [0, 1, 2];
            const seriesId = 0;
            await assertRevert(token.mintTokens(tokenIds, seriesId, { from: owner }));
        });

        it('cannot mint tokens if paused', async function () {
            let tokenIds = [0, 1, 2];
            let seriesId = 0;

            let mintTokens = await token.mintTokens(tokenIds, seriesId, { from: manager });
            await checkMintTokens(token, mintTokens, tokenIds, seriesId, manager);

            await token.pause({ from: manager });

            tokenIds = [3];
            await assertRevert(token.mintTokens(tokenIds, seriesId, { from: manager }));

            await token.unpause({ from: owner });

            mintTokens = await token.mintTokens(tokenIds, seriesId, { from: manager });
            await checkMintTokens(token, mintTokens, tokenIds, seriesId, manager);
        });

        it('cannot mint tokens than the series max', async function () {
            let tokenIds = [0, 1, 2];
            let seriesId = 0;

            let mintTokens = await token.mintTokens(tokenIds, seriesId, { from: manager });
            await checkMintTokens(token, mintTokens, tokenIds, seriesId, manager);

            tokenIds = [3, 4, 5];
            await assertRevert(token.mintTokens(tokenIds, seriesId, { from: manager }));
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
            await token.mintTokens([0, 1, 2], 0, { from: manager });
        });

        it('transfer tokens', async function () {
            // TODO: clean
            let ownerOf = await token.ownerOf(2);
            console.log(`manager = ${manager}`);
            console.log(`ownerOf = ${ownerOf}`);

            await token.safeTransferFrom(manager, users[0], 2, { from: manager });

            ownerOf = await token.ownerOf(2);
            console.log(`users[0] = ${users[0]}`);
            console.log(`ownerOf = ${ownerOf}`);

        });
    });
});
