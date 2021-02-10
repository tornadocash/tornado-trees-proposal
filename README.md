# Tornado.cash trees governance proposal [![Build Status](https://github.com/tornadocash/tornado-trees-proposal/workflows/build/badge.svg)](https://github.com/tornadocash/tornado-trees-proposal/actions)

This repo deploys governance proposal for [TornadoTrees](https://github.com/tornadocash/tornado-trees) update.

## Dependencies

1. node 12
2. yarn

## Start

```bash
$ yarn
$ yarn test
```

## Mainnet testing

```bash
$ npx hardhat node --fork <https://eth-mainnet.alchemyapi.io/v2/API_KEY> --fork-block-number 11827889
$ npx hardhat test
```
