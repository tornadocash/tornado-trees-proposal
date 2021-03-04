/* global ethers */

const { expect, should } = require('chai')
should()
const fs = require('fs')
const Jszip = require('jszip')
const jszip = new Jszip()
const {
  ethInstances,
  erc20Instances,
  advanceTime,
  getSignerFromAddress,
  getDepositData,
  getWithdrawalData,
  getMiningEvents,
  takeSnapshot,
  revertSnapshot,
  getAccountCommitments,
} = require('./utils')
const { parseEther } = ethers.utils
const { Note, Controller, Account } = require('tornado-anonymity-mining')
const { toFixedHex } = require('tornado-anonymity-mining/src/utils')
const { initialize, generateProof, createDeposit } = require('tornado-cli')
const treesUpdater = require('tornado-trees')
const { poseidonHash2 } = require('tornado-trees/src/utils')
const MerkleTree = require('fixed-merkle-tree')
const withdrawalsCache = require('../snarks/withdrawalsCache.json')
const { getEncryptionPublicKey } = require('eth-sig-util')

describe('Proposal', () => {
  let snapshotId
  let governance
  let torn
  let tornWhale
  let tornadoTreesV1
  let tornadoProxyV1
  let miner

  let tornadoTrees
  let tornadoProxy

  let accounts
  let controller

  let VOTING_DELAY
  let VOTING_PERIOD
  let EXECUTION_DELAY
  const CHUNK_SIZE = 4
  const tornadoTreesV1address = '0x43a3bE4Ae954d9869836702AFd10393D3a7Ea417'
  const tornadoProxyV1address = '0x905b63Fff465B9fFBF41DeA908CEb12478ec7601'
  const minerAddress = '0x746Aebc06D2aE31B71ac51429A19D54E797878E9'
  const privateKey = '626378a151669eb48a40f63ff88e99e6f6b03cb58bb3b381b414113e747fd80d'
  const publicKey = getEncryptionPublicKey(privateKey)

  const notes = [
    'tornado-eth-1-1-0xf3f2510798052f2d951250aa67d462ad6d5442218fdf035966761a8baaead29b9813527acd43f435ad39a943d2db5e0b00b371189ed2fcc3abcfd65264ad',
    'tornado-eth-1-1-0x3f7b26d1251dea5c3d46cfa4a1205ea273c85c48f63b3e9a3c985a1b23df3841d9c32c1afda69eaa015d45a5c5bc9b3c2e4aa8aa9343702666a2471c5bf0',
    'tornado-eth-1-1-0x454888db329be3cbd8ec85af50ca3e5e82f804f47168fc9047c5aa19c821d02b1fc44ce48b8ca02d4ba02f9c9d1b09bb4299c572356a3e34683e2b4fba8e',
    'tornado-eth-1-1-0x7549a16aef6781003ed236393a9ea38918bd0e3e17fcb29d153ca5d7943313883690f1156421f44191f71fbbe8a007007f4c7b77b837ef8f3eca68d0da36',
    'tornado-eth-1-1-0x0c683cb56c9d4ac7f04ecac29d4dfc94330c397c3194b271bae2b0b436f4dc954cad93c74a7233e9cec4c8075c05cf8a98f4bc7c0ea794424d0d8dbbe180',
    'tornado-eth-1-1-0x7de59be383b8cc1735961916f8a66ee1a532ca37f995bdbacc4a65c0182e2f6555118d983eb74e35839ee69e9a503f4ff33eb5bd9878a19197bf9cdc2535',
  ]
  const blocks = {}

  async function depositNote({ note, proxy }) {
    const noteObject = Note.fromString(note, ethInstances[1], 1, 1)
    const receipt = await proxy.deposit(ethInstances[1], toFixedHex(noteObject.commitment), [], {
      value: '1000000000000000000',
    })
    blocks[note] = { depositBlock: receipt.blockNumber, ...blocks[note] }
    return receipt
  }

  async function withdrawNote({ note, proxy }) {
    let cache = withdrawalsCache[note]
    let proof, args
    if (!cache) {
      const noteObject = Note.fromString(note, ethInstances[1], 1, 1)
      const deposit = createDeposit({ nullifier: noteObject.nullifier, secret: noteObject.secret })
      const oneEthInstance = await ethers.getContractAt(require('./abis/tornado.json'), ethInstances[1])
      const filter = oneEthInstance.filters.Deposit()
      const depositEvents = await oneEthInstance.queryFilter(filter, 0)
      ;({ proof, args } = await generateProof({
        deposit,
        recipient: accounts[0].address,
        events: depositEvents,
      }))
      withdrawalsCache[note] = { proof, args }
      fs.writeFileSync('./snarks/withdrawalsCache.json', JSON.stringify(withdrawalsCache, null, 2))
    } else {
      ;({ proof, args } = cache)
    }
    const receipt = await proxy.withdraw(ethInstances[1], proof, ...args)
    blocks[note] = { ...blocks[note], withdrawalBlock: receipt.blockNumber }
    return receipt
  }

  async function unzip(name, contentType) {
    const response = fs.readFileSync(`./snarks/${name}`)
    const zip = await jszip.loadAsync(response)
    const file = zip.file(name.slice(0, -4))
    const content = await file.async(contentType)
    return content
  }

  /* prettier-ignore */
  before(async function () {
    governance = await ethers.getContractAt(require('./abis/governance.json'), '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce')
    torn = await ethers.getContractAt(require('./abis/torn.json'), '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C')
    tornWhale = await getSignerFromAddress('0x5f48C2A71B2CC96e3F0CCae4E39318Ff0dc375b2')
    VOTING_DELAY = (await governance.VOTING_DELAY()).toNumber()
    VOTING_PERIOD = (await governance.VOTING_PERIOD()).toNumber()
    EXECUTION_DELAY = (await governance.EXECUTION_DELAY()).toNumber()
    tornadoProxyV1 = await ethers.getContractAt(require('./abis/proxyV1.json'), tornadoProxyV1address)
    miner = await ethers.getContractAt(require('./abis/miner.json'), minerAddress)

    accounts = await ethers.getSigners()
    await initialize({ merkleTreeHeight: 20 })

    const provingKeys = {
      rewardCircuit: JSON.parse(await unzip('miningReward.json.zip', 'string')),
      rewardProvingKey: await unzip('miningRewardProvingKey.bin.zip', 'arraybuffer'),
      withdrawCircuit: JSON.parse(await unzip('miningWithdraw.json.zip', 'string')),
      withdrawProvingKey: await unzip('miningWithdrawProvingKey.bin.zip', 'arraybuffer'),
    }

    controller = new Controller({
      contract: miner,
      tornadoTreesContract: tornadoTreesV1,
      merkleTreeHeight: 20,
      provingKeys,
    })
    await controller.init()
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
    await depositNote({ note: notes[0], proxy: tornadoProxyV1 })
    // console.log('depositReciept', depositReceipt)

    await withdrawNote({ note: notes[0], proxy: tornadoProxyV1 })
    // console.log('withdrawReciept', withdrawReceipt)

    console.log(`Uploading ${depositData.length} deposits and ${withdrawalData.length} withdrawals`)
    await tornadoTreesV1.updateRoots(depositData, withdrawalData)

    // lastProcessedDepositLeaf = (await tornadoTreesV1.lastProcessedDepositLeaf()).toNumber()
    // lastProcessedWithdrawalLeaf = (await tornadoTreesV1.lastProcessedWithdrawalLeaf()).toNumber()
    // console.log('lastProcessedLeafs', lastProcessedDepositLeaf, lastProcessedWithdrawalLeaf)

    // prechecks
    for (let i = 0; i < ethInstances.length; i++) {
      const isAllowed = await tornadoProxyV1.instances(ethInstances[i])
      expect(isAllowed).to.be.true
    }

    const Proposal = await ethers.getContractFactory('Proposal')
    // todo for mainnet use  `npx hardhat searchParams`
    const proposal = await Proposal.deploy(820, 10, 340, 10)

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

    // eslint-disable-next-line no-unused-vars
    let [verifierAddress, tornadoTreesImpl, tornadoTreesAddress, tornadoProxyAddress] = events.map(
      (e) => '0x' + e.data.slice(-40),
    )
    tornadoProxy = await ethers.getContractAt(require('../artifacts/tornado-anonymity-mining/contracts/TornadoProxy.sol/TornadoProxy.json').abi, tornadoProxyAddress)
    tornadoTrees = await ethers.getContractAt(require('../artifacts/tornado-trees/contracts/TornadoTrees.sol/TornadoTrees.json').abi, tornadoTreesAddress)

    snapshotId = await takeSnapshot()
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

  it('should update deposits in the new tornado trees', async () => {
    const receipt = await depositNote({ note: notes[1], proxy: tornadoProxy })
    const { events } = await receipt.wait()
    const note1EventArgs = tornadoTrees.interface.parseLog(events[1]).args

    const { number } = await ethers.provider.getBlock()
    const depositData = await getDepositData({
      tornadoTreesAddress: tornadoTreesV1address,
      provider: ethers.provider,
      fromBlock: number - 1000,
      step: 500,
      batchSize: 4,
    })
    depositData.push({
      instance: note1EventArgs.instance,
      hash: note1EventArgs.hash,
      block: note1EventArgs.block.toNumber(),
    })
    const { leaves } = await getMiningEvents({
      contract: tornadoTreesV1.address,
      fromBlock: 11474714,
      toBlock: number,
      type: 'deposit',
      provider: ethers.provider,
    })

    const depositTree = new MerkleTree(20, [], { hashFunction: poseidonHash2 })
    depositTree.bulkInsert(leaves)
    expect(await tornadoTrees.depositRoot()).to.be.equal(toFixedHex(depositTree.root()))
    const { input, args } = treesUpdater.batchTreeUpdate(depositTree, depositData)
    const proof = await treesUpdater.prove(input, './snarks/BatchTreeUpdate')

    const registeredDepositsBefore = await tornadoTrees.getRegisteredDeposits()
    const lastProcessedDepositLeafBefore = await tornadoTrees.lastProcessedDepositLeaf()
    expect(registeredDepositsBefore.length).to.be.equal(4)
    const depositsLengthBefore = await tornadoTrees.depositsLength()

    await tornadoTrees.updateDepositTree(proof, ...args)

    const lastProcessedDepositLeafAfter = await tornadoTrees.lastProcessedDepositLeaf()
    expect(lastProcessedDepositLeafAfter).to.be.equal(lastProcessedDepositLeafBefore.add(4))
    const registeredDepositsAfter = await tornadoTrees.getRegisteredDeposits()
    expect(registeredDepositsAfter.length).to.be.equal(0)

    const depositsLengthAfter = await tornadoTrees.depositsLength()
    expect(depositsLengthAfter).to.be.equal(depositsLengthBefore)
  })
  it('should update withdrawals in the new tornado trees', async () => {
    await depositNote({ note: notes[1], proxy: tornadoProxy })
    await depositNote({ note: notes[2], proxy: tornadoProxy })
    await depositNote({ note: notes[3], proxy: tornadoProxy })
    await withdrawNote({ note: notes[1], proxy: tornadoProxy })
    await withdrawNote({ note: notes[2], proxy: tornadoProxy })
    await withdrawNote({ note: notes[3], proxy: tornadoProxy })

    // data for the new tree
    const { number } = await ethers.provider.getBlock()
    let withdrawalData = await getWithdrawalData({
      tornadoTreesAddress: tornadoTreesV1address,
      provider: ethers.provider,
      fromBlock: number - 1000,
      step: 500,
      batchSize: 4,
    })

    const { events } = await getMiningEvents({
      contract: tornadoTrees.address,
      fromBlock: 11474714,
      toBlock: number,
      type: 'withdrawal',
      provider: ethers.provider,
    })
    withdrawalData = withdrawalData.concat(events)

    // getting previous withdrawals to build current tree
    const { leaves } = await getMiningEvents({
      contract: tornadoTreesV1.address,
      fromBlock: 11474714,
      toBlock: number,
      type: 'withdrawal',
      provider: ethers.provider,
    })
    const withdrawalTree = new MerkleTree(20, [], { hashFunction: poseidonHash2 })
    withdrawalTree.bulkInsert(leaves)
    expect(await tornadoTrees.withdrawalRoot()).to.be.equal(toFixedHex(withdrawalTree.root()))
    const { input, args } = treesUpdater.batchTreeUpdate(withdrawalTree, withdrawalData)
    const proof = await treesUpdater.prove(input, './snarks/BatchTreeUpdate')

    const registeredWithdrawalsV1Before = await tornadoTreesV1.getRegisteredWithdrawals()
    const registeredWithdrawalsBefore = await tornadoTrees.getRegisteredWithdrawals()
    const lastProcessedWithdrawalLeafBefore = await tornadoTrees.lastProcessedWithdrawalLeaf()
    expect(registeredWithdrawalsBefore.length + registeredWithdrawalsV1Before.length).to.be.equal(5) // 1 withdrawal in the v1 and 4 in the new one, but the first is 0x00 - it points to v1
    const withdrawalsLengthBefore = await tornadoTrees.withdrawalsLength()

    await tornadoTrees.updateWithdrawalTree(proof, ...args)

    const lastProcessedWithdrawalLeafAfter = await tornadoTrees.lastProcessedWithdrawalLeaf()
    expect(lastProcessedWithdrawalLeafAfter).to.be.equal(lastProcessedWithdrawalLeafBefore.add(4))
    const registeredWithdrawalsAfter = await tornadoTrees.getRegisteredWithdrawals()
    expect(registeredWithdrawalsAfter.length).to.be.equal(0)

    const withdrawalsLengthAfter = await tornadoTrees.withdrawalsLength()
    expect(withdrawalsLengthAfter).to.be.equal(withdrawalsLengthBefore)
  })
  it('should claim AP and swap to TORN', async () => {
    const { number } = await ethers.provider.getBlock()
    let receipt = await depositNote({ note: notes[1], proxy: tornadoProxy })
    receipt = await receipt.wait()
    const note1EventArgs = tornadoTrees.interface.parseLog(receipt.events[1]).args
    await depositNote({ note: notes[2], proxy: tornadoProxy })
    await depositNote({ note: notes[3], proxy: tornadoProxy })
    await withdrawNote({ note: notes[1], proxy: tornadoProxy })
    await withdrawNote({ note: notes[2], proxy: tornadoProxy })
    await withdrawNote({ note: notes[3], proxy: tornadoProxy })
    // data for the new tree
    let withdrawalData = await getWithdrawalData({
      tornadoTreesAddress: tornadoTreesV1address,
      provider: ethers.provider,
      fromBlock: number - 1000,
      step: 500,
      batchSize: 4,
    })

    const { events } = await getMiningEvents({
      contract: tornadoTrees.address,
      fromBlock: 11474714,
      type: 'withdrawal',
      provider: ethers.provider,
    })
    withdrawalData = withdrawalData.concat(events)

    // getting previous withdrawals to build current tree
    const withdrawalLeaves = await getMiningEvents({
      contract: tornadoTreesV1.address,
      fromBlock: 11474714,
      type: 'withdrawal',
      provider: ethers.provider,
    })
    const withdrawalTree = new MerkleTree(20, [], { hashFunction: poseidonHash2 })
    withdrawalTree.bulkInsert(withdrawalLeaves.leaves)
    expect(await tornadoTrees.withdrawalRoot()).to.be.equal(toFixedHex(withdrawalTree.root()))
    const { input, args } = treesUpdater.batchTreeUpdate(withdrawalTree, withdrawalData)
    const proof = await treesUpdater.prove(input, './snarks/BatchTreeUpdate')
    await tornadoTrees.updateWithdrawalTree(proof, ...args)

    // updating deposit tree
    const depositData = await getDepositData({
      tornadoTreesAddress: tornadoTreesV1address,
      provider: ethers.provider,
      fromBlock: number - 1000,
      step: 500,
      batchSize: 4,
    })
    depositData.push({
      instance: note1EventArgs.instance,
      hash: note1EventArgs.hash,
      block: note1EventArgs.block.toNumber(),
    })
    const depositLeaves = await getMiningEvents({
      contract: tornadoTreesV1.address,
      fromBlock: 11474714,
      type: 'deposit',
      provider: ethers.provider,
    })

    const depositTree = new MerkleTree(20, [], { hashFunction: poseidonHash2 })
    depositTree.bulkInsert(depositLeaves.leaves)
    expect(await tornadoTrees.depositRoot()).to.be.equal(toFixedHex(depositTree.root()))
    const depositUpdate = treesUpdater.batchTreeUpdate(depositTree, depositData)
    const depositProof = await treesUpdater.prove(depositUpdate.input, './snarks/BatchTreeUpdate')
    await tornadoTrees.updateDepositTree(depositProof, ...depositUpdate.args)

    // getting AP for the note0
    const processedDepositsV1 = await getMiningEvents({
      contract: tornadoTreesV1.address,
      fromBlock: 11474714,
      type: 'deposit',
      provider: ethers.provider,
    })
    const processedDepositsV2 = await getMiningEvents({
      contract: tornadoTrees.address,
      fromBlock: 11474714,
      type: 'deposit',
      provider: ethers.provider,
    })
    const lastProcessedDepositLeafAfterUpdate = await tornadoTrees.lastProcessedDepositLeaf()
    // console.log('lastProcessedDepositLeafAfterUpdate', lastProcessedDepositLeafAfterUpdate.toNumber())
    const depositDataEvents = processedDepositsV1.events
      .concat(processedDepositsV2.events)
      .slice(0, lastProcessedDepositLeafAfterUpdate)
    // console.log('depositDataEvents', JSON.stringify(depositDataEvents.slice(-20), null, 2))

    const processedWithdrawalsV1 = await getMiningEvents({
      contract: tornadoTreesV1.address,
      fromBlock: 11474714,
      type: 'withdrawal',
      provider: ethers.provider,
    })
    const processedWithdrawalsV2 = await getMiningEvents({
      contract: tornadoTrees.address,
      fromBlock: 11474714,
      type: 'withdrawal',
      provider: ethers.provider,
    })
    const withdrawalDataEvents = processedWithdrawalsV1.events.concat(processedWithdrawalsV2.events)
    // console.log('withdrawalDataEvents', JSON.stringify(withdrawalDataEvents, null, 2))
    let miningAccount = new Account()
    for (let i = 0; i < 2; i++) {
      const accountCommitments = await getAccountCommitments({
        contract: minerAddress,
        fromBlock: 0,
        provider: ethers.provider,
      })
      const reward = await controller.reward({
        account: miningAccount,
        note: Note.fromString(
          notes[i],
          ethInstances[1],
          blocks[notes[i]].depositBlock,
          blocks[notes[i]].withdrawalBlock,
        ),
        publicKey,
        rate: 20,
        accountCommitments,
        depositDataEvents,
        withdrawalDataEvents,
      })
      await miner[
        'reward(bytes,(uint256,uint256,address,bytes32,bytes32,bytes32,bytes32,(address,bytes),(bytes32,bytes32,bytes32,uint256,bytes32)))'
      ](reward.proof, reward.args)
      // accountCommitments.push(toFixedHex(miningAccount.commitment))
      miningAccount = reward.account
      console.log(`Account balance updated to ${miningAccount.amount.toString()} AP`)
    }

    // swap all AP to torn
    const recipient = accounts[1].address
    const accountCommitmentsSwap = await getAccountCommitments({
      contract: minerAddress,
      fromBlock: 0,
      provider: ethers.provider,
    })
    const withdrawSnark = await controller.withdraw({
      account: miningAccount,
      amount: miningAccount.amount,
      recipient,
      publicKey,
      accountCommitments: accountCommitmentsSwap,
    })
    const balanceBefore = await torn.balanceOf(recipient)
    await miner[
      'withdraw(bytes,(uint256,bytes32,(uint256,address,address,bytes),(bytes32,bytes32,bytes32,uint256,bytes32)))'
    ](withdrawSnark.proof, withdrawSnark.args)
    const balanceAfter = await torn.balanceOf(recipient)
    expect(balanceAfter).to.be.gt(balanceBefore)
  })
  it('should revert for inconsistent tornado tree deposits count', async () => {})
  it('should revert for inconsistent tornado tree withdrawals count')

  afterEach(async () => {
    await revertSnapshot(snapshotId)
    snapshotId = await takeSnapshot()
  })
})
