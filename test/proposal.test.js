/* global ethers */

const { expect } = require('chai')
const { advanceTime, getSignerFromAddress } = require('./utils')
const { parseEther } = ethers.utils

describe('Proposal', () => {
  let governance
  let torn
  let tornWhale

  let VOTING_DELAY
  let VOTING_PERIOD
  let EXECUTION_DELAY

  /* prettier-ignore */
  beforeEach(async function () {
    governance = await ethers.getContractAt(require('./abis/governance.json'), '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce')
    torn = await ethers.getContractAt(require('./abis/torn.json'), '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C')
    tornWhale = await getSignerFromAddress('0x5f48C2A71B2CC96e3F0CCae4E39318Ff0dc375b2')
    VOTING_DELAY = (await governance.VOTING_DELAY()).toNumber()
    VOTING_PERIOD = (await governance.VOTING_PERIOD()).toNumber()
    EXECUTION_DELAY = (await governance.EXECUTION_DELAY()).toNumber()
  })

  it('should work', async function () {
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
    await governance.execute(proposalId)
    expect(1 === 1).to.be.true
  })

  it('should revert for inconsistent tornado tree deposits count')
  it('should revert for inconsistent tornado tree withdrawals count')
})
