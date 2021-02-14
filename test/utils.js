/* global ethers, network */
const tornadoAbi = require('./abis/tornado.json')
const tornadoTreesAbi = require('./abis/trees.json')
// const { poseidonHash } = require('tornado-trees/src/utils')
const abi = new ethers.utils.AbiCoder()

const ethInstances = [
  '0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc',
  '0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936',
  '0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF',
  '0xA160cdAB225685dA1d56aa342Ad8841c3b53f291',
]

const erc20Instances = [
  '0xD4B88Df4D29F5CedD6857912842cff3b20C8Cfa3',
  '0xFD8610d20aA15b7B2E3Be39B396a1bC3516c7144',
  '0x22aaA7720ddd5388A3c0A3333430953C68f1849b',
  '0xBA214C1c1928a32Bffe790263E38B4Af9bFCD659',
  '0xd96f2B1c14Db8458374d9Aca76E26c3D18364307',
  '0x4736dCf1b7A3d580672CcE6E7c65cd5cc9cFBa9D',
  '0x169AD27A470D064DEDE56a2D3ff727986b15D52B',
  '0x0836222F2B2B24A3F36f98668Ed8F0B38D1a872f',
]

async function setTime(timestamp) {
  await ethers.provider.send('evm_setNextBlockTimestamp', [timestamp])
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

async function getDepositData({ tornadoTreesAddress, fromBlock, step, provider, batchSize }) {
  const tornadoTrees = new ethers.Contract(tornadoTreesAddress, tornadoTreesAbi, provider)
  const lastProcessedDepositLeaf = (await tornadoTrees.lastProcessedDepositLeaf()).toNumber()
  const depositData = []
  for (let i = lastProcessedDepositLeaf; i < lastProcessedDepositLeaf + batchSize; i++) {
    const nextDeposit = await tornadoTrees.deposits(i)

    while (true) {
      const toBlock = Number(fromBlock) + Number(step)
      // console.log(`getting events from ${fromBlock} to ${toBlock}`)
      const tornadoEvents = await getTornadoEvents({
        instances: ethInstances,
        fromBlock,
        toBlock,
        type: 'deposit',
        provider,
      })

      // console.log('tornadoEvents', Object.keys(tornadoEvents).length)
      if (tornadoEvents[nextDeposit]) {
        // console.log('Found new event', nextDeposit, tornadoEvents[nextDeposit])
        depositData.push(tornadoEvents[nextDeposit])
        fromBlock = tornadoEvents[nextDeposit].block - 1
        break
      }
      fromBlock = toBlock
    }
  }
  return depositData
}

async function getWithdrawalData({ tornadoTreesAddress, fromBlock, step, provider, batchSize }) {
  const tornadoTrees = new ethers.Contract(tornadoTreesAddress, tornadoTreesAbi, provider)
  const lastProcessedWithdrawalLeaf = (await tornadoTrees.lastProcessedWithdrawalLeaf()).toNumber()
  // console.log('lastProcessedWithdrawalLeaf', lastProcessedWithdrawalLeaf)
  const withdrawalData = []
  for (let i = lastProcessedWithdrawalLeaf; i < lastProcessedWithdrawalLeaf + batchSize; i++) {
    const nextWithdrawal = await tornadoTrees.withdrawals(i)
    // console.log('nextWithdrawal', nextWithdrawal)

    while (true) {
      const toBlock = Number(fromBlock) + Number(step)
      // console.log(`getting events from ${fromBlock} to ${toBlock}`)
      const tornadoEvents = await getTornadoEvents({
        instances: ethInstances,
        fromBlock,
        toBlock,
        type: 'withdrawal',
        provider,
      })

      // console.log('tornadoEvents', Object.keys(tornadoEvents).length)
      if (tornadoEvents[nextWithdrawal]) {
        // console.log('Found new event', nextWithdrawal, tornadoEvents[nextWithdrawal])
        withdrawalData.push(tornadoEvents[nextWithdrawal])
        fromBlock = tornadoEvents[nextWithdrawal].block - 1
        break
      }
      fromBlock = toBlock
    }
  }
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

module.exports = {
  ethInstances,
  erc20Instances,
  setTime,
  advanceTime,
  getSignerFromAddress,
  getTornadoEvents,
  getRegisteredEvents,
  getDepositData,
  getWithdrawalData,
}
