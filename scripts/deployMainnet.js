const { ethers } = require('hardhat')

async function main() {
  // accounts = await ethers.getSigners()
  const Proposal = await ethers.getContractFactory('Proposal')
  const proposal = await Proposal.deploy(/*2574, 7, 2067, 5*/)

  console.log(`Proposal: ${proposal.address}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
