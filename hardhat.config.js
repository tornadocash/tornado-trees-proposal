/* global task, ethers */
require('dotenv').config()
require('@nomiclabs/hardhat-waffle')
require('@nomiclabs/hardhat-etherscan')
const ens = require('eth-ens-namehash')

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
    'dai-10000.tornadocash.eth',
    'dai-100000.tornadocash.eth',
    'cdai-5000.tornadocash.eth',
    'cdai-50000.tornadocash.eth',
    'cdai-500000.tornadocash.eth',
    'cdai-5000000.tornadocash.eth',
    'usdc-100.tornadocash.eth',
    'usdc-1000.tornadocash.eth',
    'usdt-100.tornadocash.eth',
    'usdt-1000.tornadocash.eth',
    'wbtc-01.tornadocash.eth',
    'wbtc-1.tornadocash.eth',
    'wbtc-10.tornadocash.eth',
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

async function getEventCount(addresses, selector, fromBlock) {
  const events = addresses.map((address) =>
    ethers.provider.getLogs({
      address,
      fromBlock,
      topics: [ethers.utils.id(selector)],
    }),
  )
  return (await Promise.all(events)).reduce((sum, e) => (sum += e.length), 0)
}

task('searchParams', 'Prints optimal search params for tree updates deployment', async () => {
  const trees = await ethers.getContractAt(
    require('./test/abis/treesV1.json'),
    '0x43a3bE4Ae954d9869836702AFd10393D3a7Ea417',
  )
  const processedDeposits = (await trees.lastProcessedDepositLeaf()).toNumber()
  const processedWithdrawals = (await trees.lastProcessedWithdrawalLeaf()).toNumber()
  const unprocessedDeposits = (await trees.getRegisteredDeposits()).length
  const unprocessedWithdrawals = (await trees.getRegisteredWithdrawals()).length
  const { chainId } = await ethers.provider.getNetwork()

  const instances = {
    1: [
      '0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc',
      '0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936',
      '0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF',
      '0xA160cdAB225685dA1d56aa342Ad8841c3b53f291',
    ],
    5: [
      '0x3aac1cC67c2ec5Db4eA850957b967Ba153aD6279',
      '0x723B78e67497E85279CB204544566F4dC5d2acA0',
      '0x0E3A09dDA6B20aFbB34aC7cD4A6881493f3E7bf7',
      '0x6Bf694a291DF3FeC1f7e69701E3ab6c592435Ae7',
    ],
  }

  const proposalDays = 5
  const currentBlock = await ethers.provider.getBlockNumber('latest')
  const fromBlock = currentBlock - 4 * 60 * 24 * 7

  const fromDate = new Date((await ethers.provider.getBlock(fromBlock)).timestamp * 1000)
  const toDate = new Date((await ethers.provider.getBlock('latest')).timestamp * 1000)
  const days = (toDate - fromDate) / (1000 * 60 * 60 * 24)

  let depositCount = await getEventCount(instances[chainId], 'Deposit(bytes32,uint32,uint256)', fromBlock)
  let withdrawalCount = await getEventCount(
    instances[chainId],
    'Withdrawal(address,bytes32,address,uint256)',
    fromBlock,
  )

  console.log('Found', depositCount, 'deposits from', fromDate, 'in', days, 'days')
  console.log('Found', withdrawalCount, 'withdrawals from', fromDate, 'in', days, 'days')

  const depositsPerDay = Math.round(depositCount / days)
  const withdrawalsPerDay = Math.round(withdrawalCount / days)

  const params = {
    depositsFrom: processedDeposits + unprocessedDeposits + depositsPerDay * proposalDays,
    depositsStep: Math.round(depositsPerDay / 5),
    withdrawalsFrom: processedWithdrawals + unprocessedWithdrawals + withdrawalsPerDay * proposalDays,
    withdrawalsStep: Math.round(withdrawalsPerDay / 5),
  }
  console.log(params)
  console.log(Object.values(params))
})

task('roundTree', '', async () => {
  const treesAbi = await ethers.getContractFactory('TornadoTrees')
  const trees = treesAbi.attach('0x43a3bE4Ae954d9869836702AFd10393D3a7Ea417')
  const processedDeposits = (await trees.lastProcessedDepositLeaf()).toNumber()
  const processedWithdrawals = (await trees.lastProcessedWithdrawalLeaf()).toNumber()

  const batchSize = 256

  console.log(`${batchSize - (processedDeposits % batchSize)} deposits`)
  console.log(`${batchSize - (processedWithdrawals % batchSize)} withdrawals`)
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
      gasPrice: 0,
      chainId: 1,
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_KEY}`,
        blockNumber: 12083246,
      },
    },
    mainnet: {
      url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_KEY}`,
      accounts: process.env.PRIVATE_KEY
        ? [process.env.PRIVATE_KEY]
        : { mnemonic: 'test test test test test test test test test test test junk' },
    },
    goerli: {
      url: `https://eth-goerli.alchemyapi.io/v2/${process.env.ALCHEMY_KEY}`,
      accounts: process.env.PRIVATE_KEY
        ? [process.env.PRIVATE_KEY]
        : { mnemonic: 'test test test test test test test test test test test junk' },
    },
    mainnetInfura: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: process.env.PRIVATE_KEY
        ? [process.env.PRIVATE_KEY]
        : { mnemonic: 'test test test test test test test test test test test junk' },
    },
    goerliInfura: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: process.env.PRIVATE_KEY
        ? [process.env.PRIVATE_KEY]
        : { mnemonic: 'test test test test test test test test test test test junk' },
    },
    localhost: {
      chainId: 1,
      gasPrice: 0,
      timeout: 999999999,
    },
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: process.env.ETHERSCAN_KEY,
  },
  mocha: {
    timeout: 600000000,
  },
}

module.exports = config
