/* global ethers */

const { expect, should } = require('chai')
should()
const {
  ethInstances,
  erc20Instances,
  advanceTime,
  getSignerFromAddress,
  getTornadoEvents,
  getRegisteredEvents,
  getDepositData,
  getWithdrawalData,
} = require('./utils')
const { parseEther } = ethers.utils

describe('Proposal', () => {
  let governance
  let torn
  let tornWhale
  let tornadoTreesV1
  let tornadoProxyV1

  let tornadoTrees
  let tornadoProxy

  let VOTING_DELAY
  let VOTING_PERIOD
  let EXECUTION_DELAY
  const CHUNK_SIZE = 4
  const tornadoTreesV1address = '0x43a3bE4Ae954d9869836702AFd10393D3a7Ea417'
  const tornadoProxyV1address = '0x905b63Fff465B9fFBF41DeA908CEb12478ec7601'

  const provider = new ethers.providers.JsonRpcProvider(
    `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_KEY}`,
  )

  // todo change it to beforeEach and use snapshots
  /* prettier-ignore */
  before(async function () {
    governance = await ethers.getContractAt(require('./abis/governance.json'), '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce')
    torn = await ethers.getContractAt(require('./abis/torn.json'), '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C')
    tornWhale = await getSignerFromAddress('0x5f48C2A71B2CC96e3F0CCae4E39318Ff0dc375b2')
    VOTING_DELAY = (await governance.VOTING_DELAY()).toNumber()
    VOTING_PERIOD = (await governance.VOTING_PERIOD()).toNumber()
    EXECUTION_DELAY = (await governance.EXECUTION_DELAY()).toNumber()
    tornadoProxyV1 = await ethers.getContractAt(require('./abis/proxyV1.json'), tornadoProxyV1address)

    // upload appropriate amount of deposits and withdrawals to tornadoTreesV1
    tornadoTreesV1 = await ethers.getContractAt(require('./abis/treesV1.json'), tornadoTreesV1address)
    const lastProcessedDepositLeaf = (await tornadoTreesV1.lastProcessedDepositLeaf()).toNumber()
    const lastProcessedWithdrawalLeaf = (await tornadoTreesV1.lastProcessedWithdrawalLeaf()).toNumber()
    const depositBatchSize = CHUNK_SIZE - lastProcessedDepositLeaf % CHUNK_SIZE
    const withdrawalBatchSize = CHUNK_SIZE - lastProcessedWithdrawalLeaf % CHUNK_SIZE
    console.log('Getting withdrawals and deposits for tornadoTreesV1')
    // const depositData = await getDepositData({ tornadoTreesAddress: tornadoTreesV1address, provider, fromBlock: 11612470 , batchSize: depositBatchSize })
    // const withdrawalData = await getWithdrawalData({ tornadoTreesAddress: tornadoTreesV1address, provider, fromBlock: 11728750, batchSize: withdrawalBatchSize })
    const depositData = require('./events/depositData.json')
    const withdrawalData = require('./events/withdrawalData.json')

    console.log(`Uploading ${depositData.length} deposits and ${withdrawalData.length} withdrawals`)
    await tornadoTreesV1.updateRoots(depositData, withdrawalData)

    // prechecks
    for (let i = 0; i < ethInstances.length; i++) {
      const isAllowed = await tornadoProxyV1.instances(ethInstances[i])
      expect(isAllowed).to.be.true
    }

    const Proposal = await ethers.getContractFactory('Proposal')
    const proposal = await Proposal.deploy()

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
    const { events, gasUsed } = await receipt.wait()
    console.log('Proposal execution took', gasUsed.toNumber())

    let [verifierAddress, tornadoTreesAddress, tornadoProxyAddress] = events.map(
      (e) => '0x' + e.data.slice(-40),
    )
    tornadoProxy = await ethers.getContractAt(require('./abis/proxy.json'), tornadoProxyAddress)
    tornadoTrees = await ethers.getContractAt(require('./abis/trees.json'), tornadoTreesAddress)
  })

  it('should turn on instances for new tornado proxy and turn off the old one', async function () {
    for (let i = 0; i < ethInstances.length; i++) {
      const mineable = await tornadoProxy.instances(ethInstances[i])
      expect(mineable).to.be.equal(2)
    }

    for (let i = 0; i < erc20Instances.length; i++) {
      const enabled = await tornadoProxy.instances(erc20Instances[i])
      expect(enabled).to.be.equal(1)
    }

    for (let i = 0; i < ethInstances.length; i++) {
      const isAllowed = await tornadoProxyV1.instances(ethInstances[i])
      expect(isAllowed).to.be.false
    }
  })

  it('tornadoTrees should have correct state', async () => {
    const depositsLength = await tornadoTrees.depositsLength()
    const lastDeposit = await tornadoTreesV1.deposits(depositsLength.sub(1))
    expect(lastDeposit).to.not.be.equal('0x0000000000000000000000000000000000000000000000000000000000000000')
    await tornadoTreesV1.deposits(depositsLength).should.be.reverted

    const lastProcessedDepositLeafV1 = await tornadoTreesV1.lastProcessedDepositLeaf()
    const lastProcessedDepositLeaf = await tornadoTrees.lastProcessedDepositLeaf()
    expect(lastProcessedDepositLeaf).to.be.equal(lastProcessedDepositLeafV1)

    const depositRootV1 = await tornadoTreesV1.depositRoot()
    const depositRoot = await tornadoTrees.depositRoot()
    expect(depositRoot).to.be.equal(depositRootV1)

    // withdrawal stuff
    const withdrawalsLength = await tornadoTrees.withdrawalsLength()
    const lastWithdrawal = await tornadoTreesV1.withdrawals(withdrawalsLength.sub(1))
    expect(lastWithdrawal).to.not.be.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    )
    await tornadoTreesV1.withdrawals(withdrawalsLength).should.be.reverted

    const lastProcessedWithdrawalLeafV1 = await tornadoTreesV1.lastProcessedWithdrawalLeaf()
    const lastProcessedWithdrawalLeaf = await tornadoTrees.lastProcessedWithdrawalLeaf()
    expect(lastProcessedWithdrawalLeaf).to.be.equal(lastProcessedWithdrawalLeafV1)

    const withdrawalRootV1 = await tornadoTreesV1.withdrawalRoot()
    const withdrawalRoot = await tornadoTrees.withdrawalRoot()
    expect(withdrawalRoot).to.be.equal(withdrawalRootV1)
  })
  it('should revert for inconsistent tornado tree deposits count')
  it('should revert for inconsistent tornado tree withdrawals count')
})
