/* global ethers, network */

async function setTime(timestamp) {
  await ethers.provider.send('evm_setNextBlockTimestamp', [timestamp])
}

async function advanceTime(sec) {
  const now = (await ethers.provider.getBlock('latest')).timestamp
  await setTime(now + sec)
}

async function getSignerFromAddress(address) {
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  })

  return await ethers.provider.getSigner(address)
}

module.exports = {
  setTime,
  advanceTime,
  getSignerFromAddress,
}
