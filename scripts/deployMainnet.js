const { ethers } = require('hardhat')

async function main() {
  // const Verifier = await ethers.getContractFactory('BatchTreeUpdateVerifier')
  // const verifier = await Verifier.deploy({ gasPrice: 300000000000 })
  // await verifier.deployed()

  const Proposal = await ethers.getContractFactory('Proposal')
  const proposal = await Proposal.deploy('0xed3b00b651c4c7af77c2fddce4a388de84b507c6', 21378, 32, 13687, 25, {
    gasPrice: 252000000000,
  })
  await proposal.deployed()

  console.log(`Proposal: ${proposal.address}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
