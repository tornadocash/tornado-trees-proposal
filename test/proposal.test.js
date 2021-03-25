/* global ethers */

const { expect, should } = require('chai')
should()
const fs = require('fs')
const Jszip = require('jszip')
const jszip = new Jszip()
const {
  ethInstances,
  erc20Instances,
  instances,
  rates,
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
const { poseidonHash2, poseidonHash } = require('tornado-trees/src/utils')
const MerkleTree = require('fixed-merkle-tree')
const { getEncryptionPublicKey } = require('eth-sig-util')
const AbiCoder = new ethers.utils.AbiCoder()

const tornadoWithdrawalsCache = require('../proofsCache/tornadoWithdrawalsCache.json')
const updateDepositCache = require('../proofsCache/updateDepositCache.json')
const updateWithdrawalCache = require('../proofsCache/updateWithdrawalCache.json')
const depositsCache = require('./events/deposit.json')
const withdrawalsCache = require('./events/withdrawal.json')

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

  let depositTree
  let withdrawalTree

  let processedDeposits = []
  let processedWithdrawals = []

  let accounts
  let controller

  let VOTING_DELAY
  let VOTING_PERIOD
  let EXECUTION_DELAY
  const CHUNK_SIZE = 256
  const tornadoTreesV1address = '0x43a3bE4Ae954d9869836702AFd10393D3a7Ea417'
  const tornadoProxyV1address = '0x905b63Fff465B9fFBF41DeA908CEb12478ec7601'
  const minerAddress = '0x746Aebc06D2aE31B71ac51429A19D54E797878E9'
  const privateKey = '626378a151669eb48a40f63ff88e99e6f6b03cb58bb3b381b414113e747fd80d'
  const publicKey = getEncryptionPublicKey(privateKey)
  const notesCache = require('./notes.json')
  const notes = {
    fromTornadoTreesV1: process.env.REAL_SPENT_NOTE,
    beforeProposal: notesCache.slice(0, 1)[0],
    afterProposal: notesCache.slice(1, 2)[0],
    extra: notesCache.slice(2),
  }

  const { REAL_SPENT_NOTE_WITHDRAWAL_BLOCK, REAL_SPENT_NOTE_DEPOSIT_BLOCK, REAL_SPENT_NOTE } = process.env
  const blocks = {
    [REAL_SPENT_NOTE]: {
      depositBlock: REAL_SPENT_NOTE_DEPOSIT_BLOCK,
      withdrawalBlock: REAL_SPENT_NOTE_WITHDRAWAL_BLOCK,
    },
  }

  async function depositNote({ note, proxy }) {
    const noteObject = Note.fromString(note, ethInstances[1], 1, 1)
    const receipt = await proxy.deposit(ethInstances[1], toFixedHex(noteObject.commitment), [], {
      value: '1000000000000000000',
    })
    blocks[note] = { depositBlock: receipt.blockNumber, ...blocks[note] }
    return receipt
  }

  async function withdrawNote({ note, proxy }) {
    let cache = tornadoWithdrawalsCache[note]
    let proof, args
    if (!cache) {
      const noteObject = Note.fromString(note, ethInstances[1], 1, 1)
      const deposit = createDeposit({ nullifier: noteObject.nullifier, secret: noteObject.secret })
      const oneEthInstance = await ethers.getContractAt(require('./abis/tornado.json'), ethInstances[1])
      const filter = oneEthInstance.filters.Deposit()
      const eventsCache = require('./events/deposits_eth_1.json')

      const depositEvents = await oneEthInstance.queryFilter(filter, 11768736)
      ;({ proof, args } = await generateProof({
        deposit,
        recipient: accounts[0].address,
        events: eventsCache.concat(depositEvents),
      }))
      tornadoWithdrawalsCache[note] = { proof, args }
      fs.writeFileSync(
        './proofsCache/tornadoWithdrawalsCache.json',
        JSON.stringify(tornadoWithdrawalsCache, null, 2),
      )
    } else {
      ;({ proof, args } = cache)
    }
    const receipt = await proxy.withdraw(ethInstances[1], proof, ...args)
    blocks[note] = { ...blocks[note], withdrawalBlock: receipt.blockNumber }
    return receipt
  }

  async function updateDepositTree({ depositTree, depositDataMigration }) {
    processedDeposits = processedDeposits.concat(depositDataMigration)
    const root = toFixedHex(depositTree.root())
    console.log('root', root)
    let cache = updateDepositCache[root]
    let proof, args

    const update = treesUpdater.batchTreeUpdate(depositTree, depositDataMigration)
    if (!cache) {
      proof = await treesUpdater.prove(update.input, './snarks/BatchTreeUpdate')
      args = update.args
      updateDepositCache[root] = { proof, args }
      fs.writeFileSync('./proofsCache/updateDepositCache.json', JSON.stringify(updateDepositCache, null, 2))
    } else {
      console.log(
        'updateDepositTree using cache. If it does not work please delete the cache file proofsCache/updateDepositCache.json',
      )
      ;({ proof, args } = cache)
    }
    const receipt = await tornadoTrees.updateDepositTree(proof, ...args, { gasLimit: 5e6 })
    return receipt
  }

  async function updateWithdrawalTree({ withdrawalTree, withdrawalDataMigration }) {
    processedWithdrawals = processedWithdrawals.concat(withdrawalDataMigration)
    const root = toFixedHex(withdrawalTree.root())
    console.log('root', root)
    let cache = updateWithdrawalCache[root]
    let proof, args

    const update = treesUpdater.batchTreeUpdate(withdrawalTree, withdrawalDataMigration)
    if (!cache) {
      proof = await treesUpdater.prove(update.input, './snarks/BatchTreeUpdate')
      args = update.args
      updateWithdrawalCache[root] = { proof, args }
      fs.writeFileSync(
        './proofsCache/updateWithdrawalCache.json',
        JSON.stringify(updateWithdrawalCache, null, 2),
      )
    } else {
      console.log(
        'updateWithdrawalTree using cache. If it does not work please delete the cache file proofsCache/updateWithdrawalCache.json',
      )
      ;({ proof, args } = cache)
    }
    const receipt = await tornadoTrees.updateWithdrawalTree(proof, ...args, { gasLimit: 5e6 })
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
    let lastProcessedDepositLeaf = (await tornadoTreesV1.lastProcessedDepositLeaf()).toNumber()
    let lastProcessedWithdrawalLeaf = (await tornadoTreesV1.lastProcessedWithdrawalLeaf()).toNumber()
    let depositBatchSize = CHUNK_SIZE - lastProcessedDepositLeaf % CHUNK_SIZE
    let withdrawalBatchSize = CHUNK_SIZE - lastProcessedWithdrawalLeaf % CHUNK_SIZE
    console.log(`Getting ${depositBatchSize} deposits and ${withdrawalBatchSize} withdrawals for tornadoTreesV1`)

    let depositData = await getDepositData({ tornadoTreesAddress: tornadoTreesV1address, provider: ethers.provider, batchSize: depositBatchSize })
    let withdrawalData = await getWithdrawalData({ tornadoTreesAddress: tornadoTreesV1address, provider: ethers.provider, batchSize: withdrawalBatchSize })

    // depositing fresh note
    const beforeProposalDepositReceipt = await (await depositNote({ note: notes.beforeProposal, proxy: tornadoProxyV1 })).wait()
    const beforeProposalWithdrawalReceipt = await (await withdrawNote({ note: notes.beforeProposal, proxy: tornadoProxyV1 })).wait()

    console.log(`Uploading ${depositData.length} deposits and ${withdrawalData.length} withdrawals`)
    await tornadoTreesV1.updateRoots(depositData.slice(0, 100), [])
    await tornadoTreesV1.updateRoots(depositData.slice(100), [])
    await tornadoTreesV1.updateRoots([], withdrawalData)

    // prechecks
    for (let i = 0; i < ethInstances.length; i++) {
      const isAllowed = await tornadoProxyV1.instances(ethInstances[i])
      expect(isAllowed).to.be.true
    }

    console.log('Deploying verifier...')
    const Verifier = await ethers.getContractFactory('BatchTreeUpdateVerifier')
    const verifier = await Verifier.deploy()

    console.log('Deploying proposal...')
    const Proposal = await ethers.getContractFactory('Proposal')
    const proposal = await Proposal.deploy(verifier.address, 20615, 29, 13052, 24)

    torn = torn.connect(tornWhale)
    governance = governance.connect(tornWhale)

    await torn.approve(governance.address, parseEther('25000'))
    await governance.lockWithApproval(parseEther('25000'))
    await governance.propose(proposal.address, 'Update tornado trees')
    const proposalId = await governance.proposalCount()
    await advanceTime(VOTING_DELAY + 1)
    await governance.castVote(proposalId, true)
    await advanceTime(VOTING_PERIOD + EXECUTION_DELAY)
    console.log('executing...')
    const receipt = await governance.execute(proposalId)
    const { events, gasUsed } = await receipt.wait()
    console.log('Proposal execution took', gasUsed.toNumber())

    // eslint-disable-next-line no-unused-vars
    let [tornadoTreesImpl, tornadoTreesAddress, tornadoProxyAddress] = events
      .filter(e => e.topics[0] === '0x06633ee22fe8e793dec66ce36696e948bb0cc0d018ab361e8dfeb34151a4d466')
      .map((e) => '0x' + e.data.slice(90, 130))
    tornadoProxy = await ethers.getContractAt(require('../artifacts/tornado-anonymity-mining/contracts/TornadoProxy.sol/TornadoProxy.json').abi, tornadoProxyAddress)
    tornadoTrees = await ethers.getContractAt(require('../artifacts/tornado-trees/contracts/TornadoTrees.sol/TornadoTrees.json').abi, tornadoTreesAddress)

    const afterProposalDepositReceipt = await (await depositNote({ note: notes.afterProposal, proxy: tornadoProxy })).wait()
    const afterProposalDepositArgs = tornadoTrees.interface.parseLog(afterProposalDepositReceipt.events[1]).args

    const afterProposalWithdrawalReceipt = await (await withdrawNote({ note: notes.afterProposal, proxy: tornadoProxy })).wait()
    const afterProposalWithdrawalArgs = tornadoTrees.interface.parseLog(afterProposalWithdrawalReceipt.events[1]).args

    console.log('deposits migration')
    lastProcessedDepositLeaf = (await tornadoTrees.lastProcessedDepositLeaf()).toNumber()
    depositTree = new MerkleTree(20, [], { hashFunction: poseidonHash2 })
    const depositsLength = (await tornadoTrees.depositsLength()).toNumber()
    console.log('depositsLength', depositsLength, lastProcessedDepositLeaf)
    const processedCache = depositsCache.slice(0, lastProcessedDepositLeaf)
    processedDeposits = processedDeposits.concat(processedCache)
    const leaves = processedCache.map((e) => poseidonHash([e.instance, e.hash, e.block]))
    depositTree.bulkInsert(leaves)
    expect(await tornadoTrees.depositRoot()).to.be.equal(toFixedHex(depositTree.root()))

    let i = 0
    while (lastProcessedDepositLeaf < Math.floor(depositsLength / CHUNK_SIZE) * CHUNK_SIZE) {
      const depositDataMigration = await getDepositData({ tornadoTreesAddress: tornadoTreesV1address, provider: ethers.provider, batchSize: CHUNK_SIZE, skip: CHUNK_SIZE * i })
      await updateDepositTree({ depositTree, depositDataMigration })

      lastProcessedDepositLeaf = (await tornadoTrees.lastProcessedDepositLeaf()).toNumber()
      console.log('lastProcessedDepositLeaf', lastProcessedDepositLeaf)
      expect(await tornadoTrees.depositRoot()).to.be.equal(toFixedHex(depositTree.root()))
      i++
    }

    console.log('depositing more to sent a new batch of mixed deposits...')
    const depositsToSubmit = CHUNK_SIZE - (depositsLength % CHUNK_SIZE)
    const fromBlockBeforeSubmit = (await ethers.provider.getBlock()).number + 1
    for(let i=0; i < depositsToSubmit; i++) {
      await depositNote({ note: notes.extra[i], proxy: tornadoProxy })
    }

    // at this time it return all deposits excluding before and after proposal
    const depositDataMigration = await getDepositData({ tornadoTreesAddress: tornadoTreesV1address, provider: ethers.provider, batchSize: CHUNK_SIZE, skip: CHUNK_SIZE * i })
    const lastCommittedDepositIndex = depositDataMigration.slice(-1)[0].index
    const testDeposits = [
      {
        instance: ethInstances[1],
        hash: beforeProposalDepositReceipt.events[0].topics[1], // commitment
        block: beforeProposalDepositReceipt.events[0].blockNumber,
        index: lastCommittedDepositIndex + 1,
      },{
        instance: afterProposalDepositArgs.instance,
        hash: afterProposalDepositArgs.hash,
        block: afterProposalDepositArgs.block.toNumber(),
        index: lastCommittedDepositIndex + 2,
      },
    ]

    const depositEventsFromNewTree = (await getMiningEvents({
      contract: tornadoTrees.address,
      fromBlock: fromBlockBeforeSubmit,
      type: 'deposit',
      provider: ethers.provider,
    })).events
    await updateDepositTree({ depositTree, depositDataMigration: depositDataMigration.concat(testDeposits).concat(depositEventsFromNewTree) })
    expect(await tornadoTrees.depositRoot()).to.be.equal(toFixedHex(depositTree.root()))

    console.log('depositing more to sent a new batch of deposits made just using the new tornadoProxy')
    const fromBlockBeforeSubmitCleanBatch = (await ethers.provider.getBlock()).number + 1
    for(let i = depositsToSubmit; i < depositsToSubmit + 256; i++) {
      await depositNote({ note: notes.extra[i], proxy: tornadoProxy })
    }

    const depositEventsFromCleanBatch = (await getMiningEvents({
      contract: tornadoTrees.address,
      fromBlock: fromBlockBeforeSubmitCleanBatch,
      type: 'deposit',
      provider: ethers.provider,
    })).events
    await updateDepositTree({ depositTree, depositDataMigration: depositEventsFromCleanBatch })
    expect(await tornadoTrees.depositRoot()).to.be.equal(toFixedHex(depositTree.root()))


    console.log('withdrawals migration')
    lastProcessedWithdrawalLeaf = (await tornadoTrees.lastProcessedWithdrawalLeaf()).toNumber()
    withdrawalTree = new MerkleTree(20, [], { hashFunction: poseidonHash2 })
    const withdrawalsLength = (await tornadoTrees.withdrawalsLength()).toNumber()
    console.log('withdrawalsLength', withdrawalsLength, lastProcessedWithdrawalLeaf)
    const processedWithdrawalCache = withdrawalsCache.slice(0, lastProcessedWithdrawalLeaf)
    processedWithdrawals = processedWithdrawals.concat(processedWithdrawalCache)
    const committedWithdrawals = processedWithdrawalCache.map((e) => poseidonHash([e.instance, e.hash, e.block]))
    withdrawalTree.bulkInsert(committedWithdrawals)
    expect(await tornadoTrees.withdrawalRoot()).to.be.equal(toFixedHex(withdrawalTree.root()))

    let j = 0
    while (lastProcessedWithdrawalLeaf < Math.floor(withdrawalsLength / CHUNK_SIZE) * CHUNK_SIZE) {
      const withdrawalDataMigration = await getWithdrawalData({ tornadoTreesAddress: tornadoTreesV1address, provider: ethers.provider, batchSize: CHUNK_SIZE, skip: CHUNK_SIZE * j })
      await updateWithdrawalTree({ withdrawalTree, withdrawalDataMigration })

      lastProcessedWithdrawalLeaf = (await tornadoTrees.lastProcessedWithdrawalLeaf()).toNumber()
      console.log('lastProcessedWithdrawalLeaf', lastProcessedWithdrawalLeaf)
      expect(await tornadoTrees.withdrawalRoot()).to.be.equal(toFixedHex(withdrawalTree.root()))
      j++
    }

    // withdrawing more to sent mixed batch
    const withdrawalsToSubmit = CHUNK_SIZE - withdrawalsLength % CHUNK_SIZE
    console.log('withdrawalsToSubmit', withdrawalsToSubmit)
    const fromBlockBeforeSubmitWithdrawals = (await ethers.provider.getBlock()).number + 1
    for(let i=0; i < withdrawalsToSubmit; i++) {
      await withdrawNote({ note: notes.extra[i], proxy: tornadoProxy })
    }

    const withdrawalDataMigration = await getWithdrawalData({ tornadoTreesAddress: tornadoTreesV1address, provider: ethers.provider, batchSize: CHUNK_SIZE, skip: CHUNK_SIZE * j })
    console.log('withdrawalDataMigration', withdrawalDataMigration)

    const lastCommittedWithdrawalIndex = withdrawalDataMigration.slice(-1)[0].index
    const testWithdrawals = [
      {
        instance: ethInstances[1],
        hash: AbiCoder.decode(['address', 'bytes32'], beforeProposalWithdrawalReceipt.events[0].data)[1], // nullifier
        block: beforeProposalWithdrawalReceipt.events[0].blockNumber,
        index: lastCommittedWithdrawalIndex + 1,
      },{
        instance: afterProposalWithdrawalArgs.instance,
        hash: afterProposalWithdrawalArgs.hash,
        block: afterProposalWithdrawalArgs.block.toNumber(),
        index: lastCommittedWithdrawalIndex + 2,
      },
    ]
    console.log('testWithdrawals',testWithdrawals)
    const withdrawalEventsFromNewTree = (await getMiningEvents({
      contract: tornadoTrees.address,
      fromBlock: fromBlockBeforeSubmitWithdrawals,
      type: 'withdrawal',
      provider: ethers.provider,
    })).events
    console.log(JSON.stringify(withdrawalDataMigration.concat(testWithdrawals).concat(withdrawalEventsFromNewTree)))
    await updateWithdrawalTree({ withdrawalTree, withdrawalDataMigration: withdrawalDataMigration.concat(testWithdrawals).concat(withdrawalEventsFromNewTree) })
    expect(await tornadoTrees.withdrawalRoot()).to.be.equal(toFixedHex(withdrawalTree.root()))

    console.log(`depositing ${withdrawalsToSubmit - depositsToSubmit} more deposits so it can be withdrawn for the clean batch`)
    for(let i = 0; i < withdrawalsToSubmit - depositsToSubmit; i++) {
      await depositNote({ note: notes.extra[depositsToSubmit + 256 + i], proxy: tornadoProxy })
    }

    console.log('withdrawing more to sent a new batch of deposits made just using the new tornadoProxy')
    const fromBlockBeforeSubmitWithdrawalCleanBatch = (await ethers.provider.getBlock()).number + 1
    for(let i=withdrawalsToSubmit; i < withdrawalsToSubmit + 256; i++) {
      await withdrawNote({ note: notes.extra[i], proxy: tornadoProxy })
    }

    const withdrawalEventsFromCleanBatch = (await getMiningEvents({
      contract: tornadoTrees.address,
      fromBlock: fromBlockBeforeSubmitWithdrawalCleanBatch,
      type: 'withdrawal',
      provider: ethers.provider,
    })).events
    console.log(JSON.stringify(withdrawalEventsFromCleanBatch))
    await updateWithdrawalTree({ withdrawalTree, withdrawalDataMigration: withdrawalEventsFromCleanBatch })
    expect(await tornadoTrees.withdrawalRoot()).to.be.equal(toFixedHex(withdrawalTree.root()))

    snapshotId = await takeSnapshot()
  })

  it('should turn on instances for new tornado proxy and turn off the old one', async function () {
    for (let i = 0; i < ethInstances.length; i++) {
      const instance = await tornadoProxy.instances(ethInstances[i])
      expect(instance.isERC20).to.be.false
      expect(instance.token).to.be.equal('0x0000000000000000000000000000000000000000')
      expect(instance.state).to.be.equal(2)
    }

    // todo add more instances
    for (let i = 0; i < erc20Instances.length; i++) {
      const instance = await tornadoProxy.instances(erc20Instances[i])
      expect(instance.isERC20).to.be.true
      expect(instance.token).to.be.not.equal('0x0000000000000000000000000000000000000000')
      expect(instance.state).to.be.equal(1)
    }

    for (let i = 0; i < ethInstances.length; i++) {
      const isAllowed = await tornadoProxyV1.instances(ethInstances[i])
      expect(isAllowed).to.be.false
    }
  })

  it('should claim AP and swap to TORN', async () => {
    // getting AP for the REAL_SPENT_NOTE
    let miningAccount = new Account()
    const notesToClaim = [notes.fromTornadoTreesV1, notes.beforeProposal, notes.afterProposal]
    for (let i = 0; i < notesToClaim.length; i++) {
      const amount = notesToClaim[i].split('-')[2]
      const accountCommitments = await getAccountCommitments({
        contract: minerAddress,
        fromBlock: 0,
        provider: ethers.provider,
      })
      const reward = await controller.reward({
        account: miningAccount,
        note: Note.fromString(
          notesToClaim[i],
          instances[amount],
          blocks[notesToClaim[i]].depositBlock,
          blocks[notesToClaim[i]].withdrawalBlock,
        ),
        publicKey,
        rate: rates[amount],
        accountCommitments,
        depositDataEvents: processedDeposits,
        withdrawalDataEvents: processedWithdrawals,
      })
      await miner[
        'reward(bytes,(uint256,uint256,address,bytes32,bytes32,bytes32,bytes32,(address,bytes),(bytes32,bytes32,bytes32,uint256,bytes32)))'
      ](reward.proof, reward.args)
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
  it('should revert for inconsistent tornado tree deposits count')
  it('should revert for inconsistent tornado tree withdrawals count')

  afterEach(async () => {
    await revertSnapshot(snapshotId)
    snapshotId = await takeSnapshot()
  })
})
