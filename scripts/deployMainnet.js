const { ethers } = require('hardhat')

async function main() {
  const Verifier = await ethers.getContractFactory('BatchTreeUpdateVerifier')
  const verifier = await Verifier.deploy({ gasPrice: 100000000000 })

  const Proposal = await ethers.getContractFactory('Proposal')
  const proposal = await Proposal.deploy(verifier.address, 21377, 32, 13684, 25, { gasPrice: 100000000000 })

  console.log(`Proposal: ${proposal.address}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
