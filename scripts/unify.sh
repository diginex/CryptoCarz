#!/bin/bash

set -e
set -x

dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

unify() {
	grep -v "^[pragma|import]" $dir/$1 >> Unified.sol
}

echo "pragma solidity 0.4.23;" > Unified.sol

unify ../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol
unify ../truffle/contracts/CryptoCarzControl.sol
unify ../truffle/contracts/CryptoCarzToken.sol
unify ../truffle/contracts/CryptoCarzAuction.sol