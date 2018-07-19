#!/bin/bash

set -e
set -x

dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

unify() {
	grep -v "^[pragma|import]" $dir/$1 >> Unified.sol
}

echo "pragma solidity 0.4.23;" > Unified.sol

unify ../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol
unify ../node_modules/openzeppelin-solidity/contracts/AddressUtils.sol
unify ../node_modules/openzeppelin-solidity/contracts/token/ERC721/ERC721Basic.sol
unify ../node_modules/openzeppelin-solidity/contracts/token/ERC721/ERC721Receiver.sol
unify ../node_modules/openzeppelin-solidity/contracts/token/ERC721/ERC721.sol
unify ../node_modules/openzeppelin-solidity/contracts/token/ERC721/ERC721BasicToken.sol
unify ../node_modules/openzeppelin-solidity/contracts/token/ERC721/ERC721Token.sol
unify ../truffle/contracts/CryptoCarzControl.sol
unify ../truffle/contracts/CryptoCarzToken.sol
unify ../truffle/contracts/CryptoCarzAuction.sol
