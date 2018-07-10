#!/usr/bin/env bash

port=8555

# Fix number of accounts as it does not affect coverage test results
export NUM_ACCOUNTS=20

cleanup() {
  [ -f allFiredEvents ] && rm allFiredEvents
  [ -h truffle/node_modules ] && rm truffle/node_modules
  [ -h truffle/allFiredEvents ] && rm truffle/allFiredEvents
  return 0
}

# Executes cleanup function at script exit.
trap cleanup EXIT

nc -z localhost $port
if [ $? -eq 0 ]; then
  echo "Using existing testrpc-sc instance"
else
  echo "Starting testrpc-sc to generate coverage"
  eval ./node_modules/.bin/testrpc-sc --port $port --gasLimit 0xfffffffffff --accounts $NUM_ACCOUNTS -u 0 -u 1 > /dev/null &
  testrpc_pid=$!
fi

(cd truffle && ln -s ../node_modules)
(cd truffle && ln -s ../allFiredEvents)
(cd truffle && ../node_modules/.bin/solidity-coverage)
