"use strict";

const CryptoCarzControl = artifacts.require("./CryptoCarzControl.sol");
import assertRevert from './assertRevert';


contract('CryptoCarzControl', function (accounts) {

    let owner = accounts[9];
    let manager = accounts[8]
    let someoneElse = accounts[7];
    let newOwner = accounts[6];
    let newManager = accounts[5]

    let control;

    async function checkSetOwner(contract, setOwner, owner, newOwner) {
        assert.equal(setOwner.logs[0].event, 'SetOwner');
        assert.equal(setOwner.logs[0].args.previousOwner.valueOf(), owner);
        assert.equal(setOwner.logs[0].args.newOwner.valueOf(), newOwner);
        const currentOwner = await contract.owner();
        assert.equal(currentOwner, newOwner, 'got wrong new owner address');
    }

    async function checkSetManager(contract, setManager, manager, newManager) {
        assert.equal(setManager.logs[0].event, 'SetManager');
        assert.equal(setManager.logs[0].args.previousManager.valueOf(), manager);
        assert.equal(setManager.logs[0].args.newManager.valueOf(), newManager);
        const currentManager = await contract.manager();
        assert.equal(currentManager, newManager, 'got wrong new manager address');
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

    beforeEach(async function () {
        control = await CryptoCarzControl.new(owner, manager, { from: someoneElse });
    });

    describe('constructor', async function () {
        it('owner should be owner', async function () {
            let ownerAccount = await control.owner();
            assert.equal(ownerAccount, owner, 'got wrong owner address');
        });

        it('manager should be manager', async function () {
            let managerAccount = await control.manager();
            assert.equal(managerAccount, manager, 'got wrong manager address');
        });
    });

    describe('setters', async function () {
        it('set owner', async function () {
            await assertRevert(control.setOwner(newOwner, { from: someoneElse }));
            let setOwner = await control.setOwner(newOwner, { from: owner });
            await checkSetOwner(control, setOwner, owner, newOwner);
        });

        it('set manager', async function () {
            await assertRevert(control.setManager(newManager, { from: someoneElse }));
            let setManager = await control.setManager(newManager, { from: owner });
            await checkSetManager(control, setManager, manager, newManager);
        });
    });

    describe('pause/unpause', async function () {
        it('pause', async function () {
            await assertRevert(control.pause({ from: someoneElse }));
            let pause = await control.pause({ from: manager });
            await checkPause(control, pause);
        });

        it('only control accounts can pause', async function () {
            // TODO
        });

        it('cannot pause if already paused', async function () {
            // TODO
        });

        it('unpause', async function () {
            let pause = await control.pause({ from: manager });
            await assertRevert(control.unpause({ from: manager }));
            let unpause = await control.unpause({ from: owner });
            await checkUnpause(control, unpause);
        });

        it('cannot unpause if not paused', async function () {
            // TODO
        });

        it('only owner can unpause', async function () {
            // TODO
        });
    });
});

