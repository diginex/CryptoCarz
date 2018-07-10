#!/bin/bash

set -e
set -x

docker build . -f Dockerfile -t cryptocarz/truffle
docker run --rm --volume coverage:/code/truffle/coverage cryptocarz/truffle bash scripts/coverage.sh
