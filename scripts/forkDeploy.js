// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const { ethers } = require('hardhat')
const { advanceTime, getSignerFromAddress, getDepositData, getWithdrawalData } = require('../test/utils')
const { parseEther } = ethers.utils

async function main() {
  // accounts = await ethers.getSigners()
  let governance = await ethers.getContractAt(
    require('../test/abis/governance.json'),
    '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce',
  )
  let torn = await ethers.getContractAt(
    require('../test/abis/torn.json'),
    '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C',
  )
  const tornWhale = await getSignerFromAddress('0x5f48C2A71B2CC96e3F0CCae4E39318Ff0dc375b2')
  const VOTING_DELAY = (await governance.VOTING_DELAY()).toNumber()
  const VOTING_PERIOD = (await governance.VOTING_PERIOD()).toNumber()
  const EXECUTION_DELAY = (await governance.EXECUTION_DELAY()).toNumber()
  const CHUNK_SIZE = 256
  const tornadoTreesV1address = '0x43a3bE4Ae954d9869836702AFd10393D3a7Ea417'

  const tornadoTreesV1 = await ethers.getContractAt(
    require('../test/abis/treesV1.json'),
    tornadoTreesV1address,
  )
  let lastProcessedDepositLeaf = (await tornadoTreesV1.lastProcessedDepositLeaf()).toNumber()
  let lastProcessedWithdrawalLeaf = (await tornadoTreesV1.lastProcessedWithdrawalLeaf()).toNumber()
  const depositBatchSize = CHUNK_SIZE - (lastProcessedDepositLeaf % CHUNK_SIZE)
  const withdrawalBatchSize = CHUNK_SIZE - (lastProcessedWithdrawalLeaf % CHUNK_SIZE)
  console.log(
    `Getting ${depositBatchSize} deposits and ${withdrawalBatchSize} withdrawals for tornadoTreesV1`,
  )
  const depositData = await getDepositData({
    tornadoTreesAddress: tornadoTreesV1address,
    provider: ethers.provider,
    fromBlock: 11612470 - 100,
    step: 500,
    batchSize: depositBatchSize,
  }) // 11612470 modern state
  const withdrawalData = await getWithdrawalData({
    tornadoTreesAddress: tornadoTreesV1address,
    provider: ethers.provider,
    fromBlock: 11728750 - 100,
    step: 500,
    batchSize: withdrawalBatchSize,
  }) // 11728750

  console.log(`Uploading ${depositData.length} deposits and ${withdrawalData.length} withdrawals`)
  await tornadoTreesV1.updateRoots(depositData, withdrawalData)

  console.log('Deploying proposal...')
  const Proposal = await ethers.getContractFactory('Proposal')
  const proposal = await Proposal.deploy(13451, 44, 8876, 27)

  torn = torn.connect(tornWhale)
  governance = governance.connect(tornWhale)

  await torn.approve(governance.address, parseEther('25000'))
  await governance.lockWithApproval(parseEther('25000'))
  await governance.propose(proposal.address, 'Update tornado trees')
  const proposalId = await governance.proposalCount()
  await advanceTime(VOTING_DELAY + 1)
  await governance.castVote(proposalId, true)
  await advanceTime(VOTING_PERIOD + EXECUTION_DELAY)
  const receipt = await governance.execute(proposalId)
  const { events } = await receipt.wait()

  let [verifierAddress, tornadoTreesImpl, tornadoTreesAddress, tornadoProxyAddress] = events.map(
    (e) => '0x' + e.data.slice(-40),
  )
  console.log(`Verifier           : ${verifierAddress}`)
  console.log(`TornadoProxy       : ${tornadoProxyAddress}`)
  console.log(`TornadoTrees impl  : ${tornadoTreesImpl}`)
  console.log(`TornadoTrees       : ${tornadoTreesAddress}`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
