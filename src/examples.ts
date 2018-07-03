
import * as Web3 from 'web3';
import * as EthereumTx from 'ethereumjs-tx';
import * as SolidityFunction from 'web3/lib/web3/function';
import * as lodash from 'lodash';

const PRIVATE_KEY = 'PASTE_HERE';
const ADDRESS = '0x7d068eB54D3160a24e3a80A4C4D148d07FB3F4e1';
const RPC_SERVER_ADDRESS = 'https://rinkeby.infura.io';
//const RPC_SERVER_ADDRESS = 'https://ropsten.infura.io';
//const RPC_SERVER_ADDRESS = 'http://localhost:8545';

const TOKEN_CONTRACT_ADDRESS = '0x00033CeD3f3dcdD0825D5f56f98cF402BC94fcFA'; // Rinkeby
//const TOKEN_CONTRACT_ADDRESS = '0x49df2ba30b88114191f48c58377E67306f874286'; // Ropsten


function getWeb3() {
    const web3 = new Web3(new Web3.providers.HttpProvider(RPC_SERVER_ADDRESS));
    console.log(`web3.eth.blockNumber = ${web3.eth.blockNumber}`);
    return web3;
}

function getContractRawData(contractName: string): any {
    const path = `../truffle/build/contracts/${contractName}.json`;
    return require(path);
}

function createContract(contractName: string) {
    const rawData = getContractRawData(contractName);
    console.log(`rawData = ${rawData}`);
    console.log(`rawData['abi'] = ${rawData['abi']}`);
    return getWeb3().eth.contract([rawData['abi']]);
}

async function createSignedSmartContractCreationTransaction(
    fromPrivateKey: string, abi: any[], bytecode: string, constructorParameters: any[],
    nonce: number, gasPrice: number, gasEstimate: number) {

    let contractData;
    if (constructorParameters.length > 0) {
        const Contract = getWeb3().eth.contract(abi);
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
    console.log(`deployContract`);
    const rawData = await getContractRawData(contractName);
    const fromPrivateKey = PRIVATE_KEY;
    const nonce = getWeb3().eth.getTransactionCount(ADDRESS);
    const gasPriceGWei = 1;
    const gasPrice = gasPriceGWei * 10 ** 9;
    const abi = rawData['abi'];
    const bytecode = rawData['bytecode'];
    const constructorParameters = [ '0xcE1b28c91391E29ce0c69172Fe992793c1B4Ad96',
                                    '0x7d068eB54D3160a24e3a80A4C4D148d07FB3F4e1',
                                    '0xa9B8Fd4e7199E108bb28c6ed1c3C6fC79f1Dc1e3'
    ];
    const gasEstimate = 4200000;

    const serializedTx = await createSignedSmartContractCreationTransaction(
        fromPrivateKey, abi, bytecode, constructorParameters,
        nonce, gasPrice, gasEstimate);
    console.log(`serializedTx.length = ${serializedTx.length}`);
    const txHash = await getWeb3().eth.sendRawTransaction(serializedTx);
    console.log(`txHash = ${txHash}`);
    return txHash;
}

async function createSignedFunctionCallTransaction(
    contract: any, methodName: string, methodParams: any[],
    gasPrice: number, gasEstimate: number) {

    const abi = contract.abi;
    const solidityFunction = new SolidityFunction('', lodash.find(abi, { name: methodName }), '');
    const payloadData = solidityFunction.toPayload(methodParams).data;

    const nonce = getWeb3().eth.getTransactionCount(ADDRESS);

    const privateKeyBuff = new Buffer(PRIVATE_KEY, 'hex');
    const rawTx = {
        nonce,
        gasPrice,
        gasLimit: gasEstimate,
        to: contract.address,
        value: '0x00',
        data: payloadData
    };
    const tx = new EthereumTx(rawTx);
    tx.sign(privateKeyBuff);
    return '0x' + tx.serialize().toString('hex');
}

async function createAuction(tokenContract: any) {
    const serializedTx = await createSignedFunctionCallTransaction(
        tokenContract, 'createAuction', [], 10 ** 9, 1700000);
    console.log(`serializedTx = ${serializedTx}`);
    console.log(`serializedTx.length = ${serializedTx.length}`);
    const txHash = await getWeb3().eth.sendRawTransaction(serializedTx);
    console.log(`txHash = ${txHash}`);
}

async function loadContractAndCreateAuction() {
    const web3 = getWeb3();
    const abiArray = [
        {
            "constant": true,
            "inputs": [],
            "name": "name",
            "outputs": [
                {
                    "name": "",
                    "type": "string"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {
                    "name": "_tokenId",
                    "type": "uint256"
                }
            ],
            "name": "getApproved",
            "outputs": [
                {
                    "name": "",
                    "type": "address"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {
                    "name": "_newContractAddress",
                    "type": "address"
                }
            ],
            "name": "upgrade",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {
                    "name": "_to",
                    "type": "address"
                },
                {
                    "name": "_tokenId",
                    "type": "uint256"
                }
            ],
            "name": "approve",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {
                    "name": "_newOwner",
                    "type": "address"
                }
            ],
            "name": "setOwner",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "totalSupply",
            "outputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "name": "seriesCarCount",
            "outputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {
                    "name": "_from",
                    "type": "address"
                },
                {
                    "name": "_to",
                    "type": "address"
                },
                {
                    "name": "_tokenId",
                    "type": "uint256"
                }
            ],
            "name": "transferFrom",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {
                    "name": "_owner",
                    "type": "address"
                },
                {
                    "name": "_index",
                    "type": "uint256"
                }
            ],
            "name": "tokenOfOwnerByIndex",
            "outputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "name": "carSeries",
            "outputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [],
            "name": "unpause",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {
                    "name": "_from",
                    "type": "address"
                },
                {
                    "name": "_to",
                    "type": "address"
                },
                {
                    "name": "_tokenId",
                    "type": "uint256"
                }
            ],
            "name": "safeTransferFrom",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "manager",
            "outputs": [
                {
                    "name": "",
                    "type": "address"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "name": "seriesMaxCars",
            "outputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {
                    "name": "_tokenId",
                    "type": "uint256"
                }
            ],
            "name": "exists",
            "outputs": [
                {
                    "name": "",
                    "type": "bool"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {
                    "name": "_index",
                    "type": "uint256"
                }
            ],
            "name": "tokenByIndex",
            "outputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "paused",
            "outputs": [
                {
                    "name": "",
                    "type": "bool"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {
                    "name": "_tokenId",
                    "type": "uint256"
                }
            ],
            "name": "ownerOf",
            "outputs": [
                {
                    "name": "",
                    "type": "address"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "newContractAddress",
            "outputs": [
                {
                    "name": "",
                    "type": "address"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {
                    "name": "_owner",
                    "type": "address"
                }
            ],
            "name": "balanceOf",
            "outputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [],
            "name": "pause",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "owner",
            "outputs": [
                {
                    "name": "",
                    "type": "address"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "symbol",
            "outputs": [
                {
                    "name": "",
                    "type": "string"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {
                    "name": "_to",
                    "type": "address"
                },
                {
                    "name": "_approved",
                    "type": "bool"
                }
            ],
            "name": "setApprovalForAll",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {
                    "name": "_from",
                    "type": "address"
                },
                {
                    "name": "_to",
                    "type": "address"
                },
                {
                    "name": "_tokenId",
                    "type": "uint256"
                },
                {
                    "name": "_data",
                    "type": "bytes"
                }
            ],
            "name": "safeTransferFrom",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {
                    "name": "_tokenId",
                    "type": "uint256"
                }
            ],
            "name": "tokenURI",
            "outputs": [
                {
                    "name": "",
                    "type": "string"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {
                    "name": "_newManager",
                    "type": "address"
                }
            ],
            "name": "setManager",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {
                    "name": "_owner",
                    "type": "address"
                },
                {
                    "name": "_operator",
                    "type": "address"
                }
            ],
            "name": "isApprovedForAll",
            "outputs": [
                {
                    "name": "",
                    "type": "bool"
                }
            ],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        },
        {
            "inputs": [
                {
                    "name": "_owner",
                    "type": "address"
                },
                {
                    "name": "_manager",
                    "type": "address"
                }
            ],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "constructor"
        },
        {
            "anonymous": false,
            "inputs": [
                {
                    "indexed": true,
                    "name": "seriesId",
                    "type": "uint256"
                },
                {
                    "indexed": true,
                    "name": "seriesMaxCars",
                    "type": "uint256"
                }
            ],
            "name": "CreateSeries",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {
                    "indexed": false,
                    "name": "tokenIds",
                    "type": "uint256[]"
                },
                {
                    "indexed": true,
                    "name": "seriesId",
                    "type": "uint256"
                }
            ],
            "name": "CreateCars",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {
                    "indexed": false,
                    "name": "contractAddress",
                    "type": "address"
                }
            ],
            "name": "CreateAuction",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {
                    "indexed": true,
                    "name": "previousOwner",
                    "type": "address"
                },
                {
                    "indexed": true,
                    "name": "newOwner",
                    "type": "address"
                }
            ],
            "name": "SetOwner",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {
                    "indexed": true,
                    "name": "previousManager",
                    "type": "address"
                },
                {
                    "indexed": true,
                    "name": "newManager",
                    "type": "address"
                }
            ],
            "name": "SetManager",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [],
            "name": "Pause",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [],
            "name": "Unpause",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {
                    "indexed": true,
                    "name": "newContractAddress",
                    "type": "address"
                }
            ],
            "name": "ContractUpgrade",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {
                    "indexed": true,
                    "name": "_from",
                    "type": "address"
                },
                {
                    "indexed": true,
                    "name": "_to",
                    "type": "address"
                },
                {
                    "indexed": false,
                    "name": "_tokenId",
                    "type": "uint256"
                }
            ],
            "name": "Transfer",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {
                    "indexed": true,
                    "name": "_owner",
                    "type": "address"
                },
                {
                    "indexed": true,
                    "name": "_approved",
                    "type": "address"
                },
                {
                    "indexed": false,
                    "name": "_tokenId",
                    "type": "uint256"
                }
            ],
            "name": "Approval",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {
                    "indexed": true,
                    "name": "_owner",
                    "type": "address"
                },
                {
                    "indexed": true,
                    "name": "_operator",
                    "type": "address"
                },
                {
                    "indexed": false,
                    "name": "_approved",
                    "type": "bool"
                }
            ],
            "name": "ApprovalForAll",
            "type": "event"
        },
        {
            "constant": false,
            "inputs": [
                {
                    "name": "_seriesMaxCars",
                    "type": "uint256"
                }
            ],
            "name": "createSeries",
            "outputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {
                    "name": "_tokenIds",
                    "type": "uint256[]"
                },
                {
                    "name": "_seriesId",
                    "type": "uint256"
                }
            ],
            "name": "createCars",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {
                    "name": "_from",
                    "type": "address"
                },
                {
                    "name": "_to",
                    "type": "address"
                },
                {
                    "name": "_tokenIds",
                    "type": "uint256[]"
                }
            ],
            "name": "transfersFrom",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [],
            "name": "createAuction",
            "outputs": [
                {
                    "name": "",
                    "type": "address"
                }
            ],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        }
    ];
    let tokenDefinition = web3.eth.contract(abiArray);

    console.log(`tokenDefinition = ${tokenDefinition}`);
    const tokenContract = await tokenDefinition.at(TOKEN_CONTRACT_ADDRESS);
    console.log(`tokenContract = ${tokenContract}`);

    const owner = await tokenContract.owner.call();
    console.log(`owner = ${owner}`);

    await createAuction(tokenContract);
}

function test() {
    //deployContract('CryptoCarzToken');
    loadContractAndCreateAuction();
}

test();
