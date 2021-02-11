/* global task, ethers */
require('@nomiclabs/hardhat-waffle')
const ens = require('eth-ens-namehash')
require('dotenv').config()
// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async () => {
  const accounts = await ethers.getSigners()

  for (const account of accounts) {
    console.log(account.address)
  }
})

task('namehashes', 'Prints the list of tornado instances and corresponding ens namehashes', () => {
  const mineable = [
    'eth-01.tornadocash.eth',
    'eth-1.tornadocash.eth',
    'eth-10.tornadocash.eth',
    'eth-100.tornadocash.eth',
  ]
  const allowed = [
    'dai-100.tornadocash.eth',
    'dai-1000.tornadocash.eth',
    'cdai-5000.tornadocash.eth',
    'cdai-50000.tornadocash.eth',
    'usdc-100.tornadocash.eth',
    'usdc-1000.tornadocash.eth',
    'usdt-100.tornadocash.eth',
  ]
  console.log('Allowed instances:')
  allowed.forEach((name) => {
    console.log(`${name} - ${ens.hash(name)}`)
  })
  console.log('Allowed and mineable instances:')
  mineable.forEach((name) => {
    console.log(`${name} - ${ens.hash(name)}`)
  })
})

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config = {
  solidity: {
    version: '0.6.12',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      blockGasLimit: 9500000,
    },
  },
  mocha: {
    timeout: 600000,
  },
}

if (process.env.NETWORK) {
  config.networks[process.env.NETWORK] = {
    url: `https://${process.env.NETWORK}.infura.io/v3/${process.env.INFURA_TOKEN}`,
    accounts: [process.env.PRIVATE_KEY],
  }
}
module.exports = config
