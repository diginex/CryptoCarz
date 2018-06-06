#!/usr/bin/env bash

set -a
. scripts/test.env
set +a

# Exit script as soon as a command fails.
set -o errexit

# Executes cleanup function at script exit.
trap cleanup EXIT

cleanup() {
  # Kill the ganache instance that we started (if we started one and if it's still running).
  if [ -n "$ganache_pid" ] && ps -p $ganache_pid > /dev/null; then
    kill -9 $ganache_pid
  fi
}

if [ "$SOLIDITY_COVERAGE" = true ]; then
  ganache_port=8555
else
  ganache_port=8545
fi

ganache_running() {
  nc -z localhost "$ganache_port"
}

start_ganache() {
  echo "Creating $NUM_ACCOUNTS accounts"
  if [ "$SOLIDITY_COVERAGE" = true ]; then
    node_modules/.bin/testrpc-sc --gasLimit 0xfffffffffff --port "$ganache_port" --accounts $NUM_ACCOUNTS > /dev/null &
  else
    node_modules/.bin/ganache-cli --gasLimit 0xfffffffffff --accounts $NUM_ACCOUNTS > /dev/null &
  fi

  ganache_pid=$!
  seconds_wait=3
  echo "Waiting $seconds_wait sec for ganache to boot..."
  sleep $seconds_wait
}

if ganache_running; then
  echo "Using existing ganache instance"
else
  echo "Starting our own ganache instance"
  start_ganache
fi

if [ "$SOLC_NIGHTLY" = true ]; then
  echo "Downloading solc nightly"
  wget -q https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/bin/soljson-nightly.js -O /tmp/soljson.js && find . -name soljson.js -exec cp /tmp/soljson.js {} \;
fi

if [ "$SOLIDITY_COVERAGE" = true ]; then
  node_modules/.bin/solidity-coverage

  if [ "$CONTINUOUS_INTEGRATION" = true ]; then
    cat coverage/lcov.info | node_modules/.bin/coveralls
  fi
else
  node_modules/.bin/truffle test test/token/ERC721/CryptoCarz/CryptoCarzToken.basic.test.js
  node_modules/.bin/truffle test test/token/ERC721/CryptoCarz/CryptoCarzAuction.test.js
  node_modules/.bin/truffle test test/token/ERC721/CryptoCarz/CryptoCarzControl.test.js
  node_modules/.bin/truffle test test/token/ERC721/CryptoCarz/CryptoCarzToken.test.js
fi
