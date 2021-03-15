const { ethers } = require('hardhat')

async function main() {
  // accounts = await ethers.getSigners()
  const Proposal = await ethers.getContractFactory('Proposal')
  const proposal = await Proposal.deploy(/*13451, 44, 8876, 27*/)

  console.log(`Proposal: ${proposal.address}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
