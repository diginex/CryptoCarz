
import * as Web3 from 'web3';
import * as EthereumTx from 'ethereumjs-tx';

const PRIVATE_KEY = '<PASTE_PRIVATE_KEY_HERE>';
const ADDRESS = '0x618d2eF18bA58077D0e4a1b8911180C97604E4Ae';
const RPC_SERVER_ADDRESS = 'https://ropsten.infura.io';

const web3 = new Web3(new Web3.providers.HttpProvider(RPC_SERVER_ADDRESS));

async function getContractRawData(contractName: string) {
    const path = `../truffle/build/contracts/${contractName}.json`;
    return require(path);
}

async function createSignedSmartContractCreationTransaction(
    fromPrivateKey: string, abi: any[], bytecode: string, constructorParameters: any[],
    nonce: number, gasPrice: number, gasEstimate: number) {

    let contractData;
    if (constructorParameters.length > 0) {
        const Contract = web3.eth.contract(abi);
        constructorParameters.push({ data: bytecode });
        contractData = Contract.new.getData(...constructorParameters);
    } else {
        contractData = bytecode;
    }

    const privateKeyBuff = new Buffer(fromPrivateKey, 'hex');
    const rawTx = {
        nonce: nonce,
        gasPrice: gasPrice,
        gasLimit: gasEstimate,
        value: '0x00',
        data: contractData
    };
    const tx = new EthereumTx(rawTx);
    tx.sign(privateKeyBuff);
    return '0x' + tx.serialize().toString('hex');
}


async function deployContract(contractName: string): Promise<string> {
    const rawData = getContractRawData(contractName);
    const fromPrivateKey = PRIVATE_KEY;
    const nonce = web3.eth.getTransactionCount(ADDRESS);
    const gasPriceGWei = 1;
    const gasPrice = gasPriceGWei * 10 ** 9;
    const abi = rawData['abi'];
    const bytecode = rawData['bytecode'];
    const constructorParameters = new Array<any>();
    const gasEstimate = 700000;

    const serializedTx = await createSignedSmartContractCreationTransaction(
        fromPrivateKey, abi, bytecode, constructorParameters,
        nonce, gasPrice, gasEstimate);
    console.log(`serializedTx = ${serializedTx}`);
    const txHash = await web3.eth.sendRawTransaction(serializedTx);
    console.log(`txHash = ${txHash}`);
    return txHash;
}

function test() {
    deployContract('CryptoCarzToken');
}

test();
