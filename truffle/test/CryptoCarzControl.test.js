'use strict';

const CryptoCarzControl = artifacts.require("./CryptoCarzControl.sol");
import assertRevert from './assertRevert';
import constants from './constants';

contract('CryptoCarzControl', function (accounts) {

    const owner = accounts[1];
    const manager = accounts[2]
    const someoneElse = accounts[3];
    const newOwner = accounts[4];
    const newManager = accounts[5]

    let controlContract;

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

    async function checkUpgrade(contract, upgrade, _newContractAddress) {
        assert.equal(upgrade.logs[0].event, 'ContractUpgrade');
        assert.equal(upgrade.logs[0].args.newContractAddress.valueOf(), _newContractAddress);
        assert.equal(upgrade.logs[1].event, 'Pause');
        const newContractAddress = await contract.newContractAddress();
        assert.equal(newContractAddress, _newContractAddress, "wrong new contract address");
        const paused = await contract.paused();
        assert.equal(paused, true, "paused should be true");
    }

    beforeEach(async function () {
        controlContract = await CryptoCarzControl.new(owner, manager, { from: someoneElse });
    });

    describe('constructor', async function () {
        it('owner should be owner', async function () {
            const ownerAccount = await controlContract.owner();
            assert.equal(ownerAccount, owner, 'got wrong owner address');
        });

        it('manager should be manager', async function () {
            const managerAccount = await controlContract.manager();
            assert.equal(managerAccount, manager, 'got wrong manager address');
        });

        it('owner cannot be 0x0', async function () {
            await assertRevert(CryptoCarzControl.new(constants.ZERO_ADDRESS, manager, { from: someoneElse }));
        });

        it('manager cannot be 0x0', async function () {
            await assertRevert(CryptoCarzControl.new(owner, constants.ZERO_ADDRESS, { from: someoneElse }));
        });

        it('owner and manager cannot be same account', async function () {
            await assertRevert(CryptoCarzControl.new(owner, owner, { from: someoneElse }));
        });
    });

    describe('setters', async function () {
        it('only the owner can change the owner', async function () {
            await assertRevert(controlContract.setOwner(newOwner, { from: someoneElse }));
            const setOwner = await controlContract.setOwner(newOwner, { from: owner });
            await checkSetOwner(controlContract, setOwner, owner, newOwner);
        });

        it('only the owner can change the manager', async function () {
            await assertRevert(controlContract.setManager(newManager, { from: someoneElse }));
            const setManager = await controlContract.setManager(newManager, { from: owner });
            await checkSetManager(controlContract, setManager, manager, newManager);
        });

        it('owner cannot be set to 0x0', async function () {
            await assertRevert(controlContract.setOwner(constants.ZERO_ADDRESS, { from: owner }));
        });

        it('manager cannot be set to 0x0', async function () {
            await assertRevert(controlContract.setManager(constants.ZERO_ADDRESS, { from: owner }));
        });

        it('owner and manager cannot be same account', async function () {
            await controlContract.setManager(newManager, { from: owner });
            await assertRevert(controlContract.setOwner(newManager, { from: owner }));
            await assertRevert(controlContract.setManager(owner, { from: owner }));
        });
    });

    describe('pause/unpause', async function () {
        it('only control accounts can pause/unpause', async function () {
            await assertRevert(controlContract.pause({ from: someoneElse }));
            await controlContract.pause({ from: owner });
            await assertRevert(controlContract.unpause({ from: someoneElse }));
        });

        it('owner can pause and unpause', async function () {
            const pause = await controlContract.pause({ from: owner });
            await checkPause(controlContract, pause);
            const unpause = await controlContract.unpause({ from: owner });
            await checkUnpause(controlContract, unpause);
        });

        it('manager can pause but cannot unpause', async function () {
            const pause = await controlContract.pause({ from: manager });
            await checkPause(controlContract, pause);
            await assertRevert(controlContract.unpause({ from: manager }));
        });

        it('can only unpause if paused', async function () {
            await assertRevert(controlContract.unpause({ from: owner }));
            const pause = await controlContract.pause({ from: manager });
            await checkPause(controlContract, pause);
            const unpause = await controlContract.unpause({ from: owner });
            await checkUnpause(controlContract, unpause);
        });

        it('cannot unpause if upgraded', async function () {
            const upgrade = await controlContract.upgrade(someoneElse, { from: owner });
            await checkUpgrade(controlContract, upgrade, someoneElse);
            await assertRevert(controlContract.unpause({ from: owner }));
        });
    });

    describe('upgrade', async function () {
        it('non-owner accounts cannot upgrade', async function () {
            await assertRevert(controlContract.upgrade(someoneElse, { from: manager }));
            await assertRevert(controlContract.upgrade(someoneElse, { from: someoneElse }));
        });

        it('cannot upgrade if paused', async function () {
            await controlContract.pause({ from: owner });
            assertRevert(controlContract.upgrade(someoneElse, { from: owner }));
            await controlContract.unpause({ from: owner });
        });

        it('cannot upgrade to address 0x0', async function () {
            assertRevert(controlContract.upgrade(constants.ZERO_ADDRESS, { from: owner }));
        });

        it('owner can upgrade, new contract address should be set and contract paused', async function () {
            const upgrade = await controlContract.upgrade(someoneElse, { from: owner });
            await checkUpgrade(controlContract, upgrade, someoneElse);
        });
    });
});
