/* global ethers */

const { expect, should } = require('chai')
should()
const {
  ethInstances,
  erc20Instances,
  advanceTime,
  getSignerFromAddress,
  getDepositData,
  getWithdrawalData,
} = require('./utils')
const { parseEther } = ethers.utils
const { Note } = require('tornado-anonymity-mining')
const { toFixedHex } = require('tornado-anonymity-mining/src/utils')
const { initialize, generateProof, createDeposit } = require('tornado-cli')

describe('Proposal', () => {
  let governance
  let torn
  let tornWhale
  let tornadoTreesV1
  let tornadoProxyV1

  let tornadoTrees
  let tornadoProxy

  let accounts

  let VOTING_DELAY
  let VOTING_PERIOD
  let EXECUTION_DELAY
  const CHUNK_SIZE = 4
  const tornadoTreesV1address = '0x43a3bE4Ae954d9869836702AFd10393D3a7Ea417'
  const tornadoProxyV1address = '0x905b63Fff465B9fFBF41DeA908CEb12478ec7601'

  const provider = new ethers.providers.JsonRpcProvider(
    `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_KEY}`,
  )
  const notes = [
    'tornado-eth-1-1-0xf3f2510798052f2d951250aa67d462ad6d5442218fdf035966761a8baaead29b9813527acd43f435ad39a943d2db5e0b00b371189ed2fcc3abcfd65264ad',
    'tornado-eth-1-1-0x3f7b26d1251dea5c3d46cfa4a1205ea273c85c48f63b3e9a3c985a1b23df3841d9c32c1afda69eaa015d45a5c5bc9b3c2e4aa8aa9343702666a2471c5bf0',
    'tornado-eth-1-1-0x454888db329be3cbd8ec85af50ca3e5e82f804f47168fc9047c5aa19c821d02b1fc44ce48b8ca02d4ba02f9c9d1b09bb4299c572356a3e34683e2b4fba8e',
    'tornado-eth-1-1-0x7549a16aef6781003ed236393a9ea38918bd0e3e17fcb29d153ca5d7943313883690f1156421f44191f71fbbe8a007007f4c7b77b837ef8f3eca68d0da36',
  ]

  async function depositNote({ note }) {
    note = Note.fromString(note, ethInstances[1], 1, 1)
    return await tornadoProxyV1.deposit(ethInstances[1], toFixedHex(note.commitment), [], {
      value: '1000000000000000000',
    })
  }

  async function withdrawNote({ note }) {
    note = Note.fromString(note, ethInstances[1], 1, 1)
    const deposit = createDeposit({ nullifier: note.nullifier, secret: note.secret })
    const oneEthInstance = await ethers.getContractAt(require('./abis/tornado.json'), ethInstances[1])
    const filter = oneEthInstance.filters.Deposit()
    const depositEvents = await oneEthInstance.queryFilter(filter, 0)
    const { proof, args } = await generateProof({
      deposit,
      recipient: accounts[0].address,
      events: depositEvents,
    })
    return await tornadoProxyV1.withdraw(ethInstances[1], proof, ...args)
  }

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

    accounts = await ethers.getSigners()
    await initialize({ merkleTreeHeight: 20 })

    // upload appropriate amount of deposits and withdrawals to tornadoTreesV1
    tornadoTreesV1 = await ethers.getContractAt(require('./abis/treesV1.json'), tornadoTreesV1address)
    const deposits = await tornadoTreesV1.getRegisteredDeposits()
    console.log('deposits', deposits)
    const withdrawals = await tornadoTreesV1.getRegisteredWithdrawals()
    console.log('withdrawals', withdrawals)
    let lastProcessedDepositLeaf = (await tornadoTreesV1.lastProcessedDepositLeaf()).toNumber()
    let lastProcessedWithdrawalLeaf = (await tornadoTreesV1.lastProcessedWithdrawalLeaf()).toNumber()
    const depositBatchSize = CHUNK_SIZE - lastProcessedDepositLeaf % CHUNK_SIZE
    const withdrawalBatchSize = CHUNK_SIZE - lastProcessedWithdrawalLeaf % CHUNK_SIZE
    console.log(`Getting ${depositBatchSize} deposits and ${withdrawalBatchSize} withdrawals for tornadoTreesV1`)
    const { number } = await ethers.provider.getBlock()
    const depositData = await getDepositData({ tornadoTreesAddress: tornadoTreesV1address, provider: ethers.provider, fromBlock: number - 1000, step: 500, batchSize: depositBatchSize }) // 11612470 modern state
    const withdrawalData = await getWithdrawalData({ tornadoTreesAddress: tornadoTreesV1address, provider: ethers.provider, fromBlock: number - 1000, step: 500, batchSize: withdrawalBatchSize }) // 11728750
    // const depositData = require('./events/depositData.json')
    // const withdrawalData = require('./events/withdrawalData.json')

    // depositing fresh note
    const depositReciept = await depositNote({ note: notes[0] })
    console.log('depositReciept', depositReciept)

    const withdrawReciept = await withdrawNote({ note: notes[0] })
    console.log('withdrawReciept', withdrawReciept)

    console.log(`Uploading ${depositData.length} deposits and ${withdrawalData.length} withdrawals`)
    await tornadoTreesV1.updateRoots(depositData, withdrawalData)

    lastProcessedDepositLeaf = (await tornadoTreesV1.lastProcessedDepositLeaf()).toNumber()
    lastProcessedWithdrawalLeaf = (await tornadoTreesV1.lastProcessedWithdrawalLeaf()).toNumber()
    console.log('lastProcessedLeafs', lastProcessedDepositLeaf, lastProcessedWithdrawalLeaf)

    // prechecks
    for (let i = 0; i < ethInstances.length; i++) {
      const isAllowed = await tornadoProxyV1.instances(ethInstances[i])
      expect(isAllowed).to.be.true
    }

    const Proposal = await ethers.getContractFactory('Proposal')
    // todo for mainnet use  `npx hardhat searchParams`
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
