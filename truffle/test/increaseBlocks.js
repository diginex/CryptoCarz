export default function increaseBlocks (blocks) {
  for (let i = 0; i < blocks; i++) {
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_mine',
      id: Date.now(),
    });
  }
}
