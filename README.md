# CryptoCarz smart contracts

## Contracts

Please see the [contracts/](truffle/contracts) directory.

## Develop

Contracts are written in [Solidity](solidity) and tested using [Truffle](truffle) and [ganache-cli](ganache-cli).

### Dependencies

```bash
# Install local node dependencies
$ npm install
```

### Test

```bash
# Compile all smart contracts
$ npm run build

# Run all tests
$ npm test

# Run test coverage analysis
$ npm run coverage
```

### Docker

A Docker image to run containerized testing is provided. Requires [Docker Compose](docker compose).

```bash
# Build the container and run all tests
$ make build test

# Run a test for a single contract
$ docker-compose run --rm truffle npm test test/CryptoCarzToken.test.js

[ethereum]: https://www.ethereum.org/
[solidity]: https://solidity.readthedocs.io/en/develop/
[truffle]: http://truffleframework.com/
[ganache-cli]: https://github.com/trufflesuite/ganache-cli