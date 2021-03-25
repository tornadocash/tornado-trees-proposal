/* global ethers, network */
const tornadoAbi = require('./abis/tornado.json')
const tornadoTreesAbi = require('../artifacts/tornado-trees/contracts/TornadoTrees.sol/TornadoTrees.json').abi
const minerAbi = require('./abis/miner.json')
const { poseidonHash } = require('tornado-trees/src/utils')
const abi = new ethers.utils.AbiCoder()

const ethInstances = [
  '0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc', // eth-01.tornadocash.eth
  '0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936', // eth-1.tornadocash.eth
  '0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF', // eth-10.tornadocash.eth
  '0xA160cdAB225685dA1d56aa342Ad8841c3b53f291', // eth-100.tornadocash.eth
]

const erc20Instances = [
  '0x07687e702b410Fa43f4cB4Af7FA097918ffD2730', // dai-10000.tornadocash.eth
  '0x23773E65ed146A459791799d01336DB287f25334', // dai-100000.tornadocash.eth
  '0x03893a7c7463AE47D46bc7f091665f1893656003', // cdai-50000.tornadocash.eth
  '0x2717c5e28cf931547B621a5dddb772Ab6A35B701', // cdai-500000.tornadocash.eth
  '0xD21be7248e0197Ee08E0c20D4a96DEBdaC3D20Af', // cdai-5000000.tornadocash.eth
  '0x178169B423a011fff22B9e3F3abeA13414dDD0F1', // wbtc-01.tornadocash.eth
  '0x610B717796ad172B316836AC95a2ffad065CeaB4', // wbtc-1.tornadocash.eth
  '0xbB93e510BbCD0B7beb5A853875f9eC60275CF498', // wbtc-10.tornadocash.eth
  '0xD4B88Df4D29F5CedD6857912842cff3b20C8Cfa3', // dai-100.tornadocash.eth
  '0xFD8610d20aA15b7B2E3Be39B396a1bC3516c7144', // dai-1000.tornadocash.eth
  '0x22aaA7720ddd5388A3c0A3333430953C68f1849b', // cdai-5000.tornadocash.eth
  '0xd96f2B1c14Db8458374d9Aca76E26c3D18364307', // usdc-100.tornadocash.eth
  '0x4736dCf1b7A3d580672CcE6E7c65cd5cc9cFBa9D', // usdc-1000.tornadocash.eth
  '0x169AD27A470D064DEDE56a2D3ff727986b15D52B', // usdt-100.tornadocash.eth
  '0x0836222F2B2B24A3F36f98668Ed8F0B38D1a872f', // usdt-1000.tornadocash.eth
]

const instances = {
  0.1: '0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc',
  1: '0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936',
  10: '0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF',
  100: '0xA160cdAB225685dA1d56aa342Ad8841c3b53f291',
}
const rates = {
  0.1: 10,
  1: 20,
  10: 50,
  100: 400,
}

async function setTime(timestamp) {
  await ethers.provider.send('evm_setNextBlockTimestamp', [timestamp])
}

async function takeSnapshot() {
  return await ethers.provider.send('evm_snapshot', [])
}

async function revertSnapshot(id) {
  await ethers.provider.send('evm_revert', [id])
}

async function advanceTime(sec) {
  const now = (await ethers.provider.getBlock('latest')).timestamp
  await setTime(now + sec)
}

async function getSignerFromAddress(address) {
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  })

  return await ethers.provider.getSigner(address)
}

async function getDepositData({ tornadoTreesAddress, provider, batchSize, skip = 0 }) {
  process.stdout.write('Started getting deposits')
  const tornadoTrees = new ethers.Contract(tornadoTreesAddress, tornadoTreesAbi, provider)
  const lastProcessedDepositLeaf = (await tornadoTrees.lastProcessedDepositLeaf()).toNumber() + skip
  console.log('lastProcessedDepositLeaf', lastProcessedDepositLeaf)
  const depositData = []
  const depositsCache = require('./events/deposit.json')
  for (let i = lastProcessedDepositLeaf; i < lastProcessedDepositLeaf + batchSize; i++) {
    let nextDeposit
    try {
      nextDeposit = await tornadoTrees.deposits(i)
    } catch (e) {
      console.log(`There are no more registered deposits, returning ${depositData.length} deposits`)
      break
    }

    const deposit = depositsCache.filter((dep) => dep.sha3 === nextDeposit)[0]
    if (!deposit) {
      console.error(`\nSkipping! There is not related deposit event for the ${i} - ${nextDeposit}\n`)
    } else {
      depositData.push(deposit)
    }
    process.stdout.write('.')
  }
  process.stdout.write('\n')
  return depositData
}

async function getWithdrawalData({ tornadoTreesAddress, provider, batchSize, skip = 0 }) {
  process.stdout.write('Started getting withdrawals')
  const tornadoTrees = new ethers.Contract(tornadoTreesAddress, tornadoTreesAbi, provider)
  const lastProcessedWithdrawalLeaf = (await tornadoTrees.lastProcessedWithdrawalLeaf()).toNumber() + skip
  // console.log('lastProcessedWithdrawalLeaf', lastProcessedWithdrawalLeaf)
  const withdrawalData = []
  const withdrawalsCache = require('./events/withdrawal.json')
  for (let i = lastProcessedWithdrawalLeaf; i < lastProcessedWithdrawalLeaf + batchSize; i++) {
    let nextWithdrawal
    try {
      nextWithdrawal = await tornadoTrees.withdrawals(i)
    } catch (e) {
      console.log(`There are no more registered withdrawals, returning ${withdrawalData.length} withdrawals`)
      break
    }

    const withdrawal = withdrawalsCache.filter((dep) => dep.sha3 === nextWithdrawal)[0]
    if (!withdrawal) {
      console.error(`\nSkipping! There is not related withdrawal event for the ${i} - ${nextWithdrawal}\n`)
    } else {
      withdrawalData.push(withdrawal)
    }
    process.stdout.write('.')
  }
  process.stdout.write('\n')
  return withdrawalData
}

async function getTornadoEvents({ instances, fromBlock, toBlock, type, provider }) {
  const hashName = type === 'deposit' ? 'commitment' : 'nullifierHash'
  const promises = instances.map((instance) =>
    getInstanceEvents({ type, instance, fromBlock, toBlock, provider }),
  )

  const raw = await Promise.all(promises)

  const events = raw.flat().reduce((acc, e) => {
    const encodedData = abi.encode(
      ['address', 'bytes32', 'uint256'],
      [e.address, e.args[hashName], e.blockNumber],
    )
    const leafHash = ethers.utils.keccak256(encodedData)

    acc[leafHash] = {
      instance: e.address,
      hash: e.args[hashName],
      block: e.blockNumber,
    }
    return acc
  }, {})
  return events
}

async function getInstanceEvents({ type, instance, fromBlock, toBlock, provider }) {
  const tornado = new ethers.Contract(instance, tornadoAbi)
  const eventFilter = type === 'deposit' ? tornado.filters.Deposit() : tornado.filters.Withdrawal()
  let events = await provider.getLogs({
    instance,
    fromBlock,
    toBlock,
    topics: eventFilter.topics,
  })
  events = events.map((e) => {
    return {
      address: e.address,
      blockNumber: e.blockNumber,
      args: tornado.interface.parseLog(e).args,
    }
  })
  return events
}

async function getRegisteredEvents({ type, contract, provider }) {
  const tornadoTrees = new ethers.Contract(contract, tornadoTreesAbi, provider)
  const events =
    type === 'deposit'
      ? await tornadoTrees.functions.getRegisteredDeposits()
      : await tornadoTrees.functions.getRegisteredWithdrawals()
  return events[0]
}

async function getMiningEvents({ contract, fromBlock, toBlock, type, provider }) {
  const tornadoTrees = new ethers.Contract(contract, tornadoTreesAbi, provider)
  const eventFilter =
    type === 'deposit' ? tornadoTrees.filters.DepositData() : tornadoTrees.filters.WithdrawalData()
  let events = await tornadoTrees.queryFilter(eventFilter, fromBlock, toBlock)
  events = events
    .sort((a, b) => a.args.index.sub(b.args.index))
    .map((e) => ({
      instance: e.args.instance,
      hash: e.args.hash,
      block: e.args.block.toNumber(),
      index: e.args.index.toNumber(),
    }))
  const leaves = events.map((e) => poseidonHash([e.instance, e.hash, e.block]))

  return { events, leaves }
}

async function getAccountCommitments({ contract, fromBlock, toBlock, provider }) {
  const miner = new ethers.Contract(contract, minerAbi, provider)
  const eventFilter = miner.filters.NewAccount()
  let events = await miner.queryFilter(eventFilter, fromBlock, toBlock)
  return events.sort((a, b) => a.args.index.sub(b.args.index)).map((e) => e.args.commitment)
}

module.exports = {
  ethInstances,
  erc20Instances,
  instances,
  rates,
  setTime,
  advanceTime,
  takeSnapshot,
  revertSnapshot,
  getSignerFromAddress,
  getInstanceEvents,
  getTornadoEvents,
  getRegisteredEvents,
  getDepositData,
  getWithdrawalData,
  getMiningEvents,
  getAccountCommitments,
}
