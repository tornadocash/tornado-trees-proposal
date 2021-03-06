/*

This is a proposal to update TornadoTrees smart contract

// todo update description and forum link
More info: https://torn.community/t/anonymity-mining-technical-overview/15/18

*/

//SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "tornado-trees/contracts/interfaces/ITornadoTreesV1.sol";
import "tornado-trees/contracts/interfaces/IBatchTreeUpdateVerifier.sol";
import "tornado-trees/contracts/TornadoTrees.sol";
import "tornado-trees/contracts/AdminUpgradeableProxy.sol";
import "tornado-anonymity-mining/contracts/TornadoProxy.sol";
import "./interfaces/ITornadoProxyV1.sol";
import "./interfaces/IMiner.sol";
import "./verifiers/BatchTreeUpdateVerifier.sol";

contract Proposal {
  ITornadoTreesV1 public constant tornadoTreesV1 = ITornadoTreesV1(0x43a3bE4Ae954d9869836702AFd10393D3a7Ea417);
  ITornadoProxyV1 public constant tornadoProxyV1 = ITornadoProxyV1(0x905b63Fff465B9fFBF41DeA908CEb12478ec7601);
  IMiner public constant miner = IMiner(0x746Aebc06D2aE31B71ac51429A19D54E797878E9);

  event Deployed(address _contract);

  // params used to search for array lengths on V1 contracts
  uint256 private immutable depositsFrom;
  uint256 private immutable depositsStep;
  uint256 private immutable withdrawalsFrom;
  uint256 private immutable withdrawalsStep;

  constructor(
    uint256 _depositsFrom,
    uint256 _depositsStep,
    uint256 _withdrawalsFrom,
    uint256 _withdrawalsStep
  ) public {
    depositsFrom = _depositsFrom;
    depositsStep = _depositsStep;
    withdrawalsFrom = _withdrawalsFrom;
    withdrawalsStep = _withdrawalsStep;
  }

  function executeProposal() public {
    // Disable all instances on old tornado proxy
    address[4] memory miningInstances = getEthInstances();
    for (uint256 i = 0; i < miningInstances.length; i++) {
      tornadoProxyV1.updateInstance(miningInstances[i], false);
    }

    // Deploy snark verifier contract for the merkle tree updates
    BatchTreeUpdateVerifier verifier = new BatchTreeUpdateVerifier();
    emit Deployed(address(verifier));

    // Deploy new TornadoTrees implementation
    TornadoTrees tornadoTreesImpl = new TornadoTrees(address(this), tornadoTreesV1, getSearchParams());
    emit Deployed(address(tornadoTreesImpl));

    // Deploy TornadoTrees upgradeable proxy
    AdminUpgradeableProxy upgradeableProxy = new AdminUpgradeableProxy(address(tornadoTreesImpl), "");
    emit Deployed(address(upgradeableProxy));
    TornadoTrees tornadoTrees = TornadoTrees(address(upgradeableProxy));

    // Deploy new TornadoProxy
    TornadoProxy proxy = new TornadoProxy(address(tornadoTrees), address(this), getInstances());
    emit Deployed(address(proxy));

    // Init tornado trees
    tornadoTrees.initialize(address(proxy), IBatchTreeUpdateVerifier(address(verifier)));

    // Update TornadoTrees address on the mining contract
    miner.setTornadoTreesContract(address(tornadoTrees));
  }

  function getSearchParams() public view returns (TornadoTrees.SearchParams memory) {
    return
      TornadoTrees.SearchParams({
        depositsFrom: depositsFrom,
        depositsStep: depositsStep,
        withdrawalsFrom: withdrawalsFrom,
        withdrawalsStep: withdrawalsStep
      });
  }

  function getEthInstances() public pure returns (address[4] memory) {
    return [
      address(0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc),
      address(0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936),
      address(0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF),
      address(0xA160cdAB225685dA1d56aa342Ad8841c3b53f291)
    ];
  }

  // todo should we add more instances? usdt-100000 ?
  function getErc20Instances() public pure returns (address[8] memory) {
    return [
      address(0xD4B88Df4D29F5CedD6857912842cff3b20C8Cfa3),
      address(0xFD8610d20aA15b7B2E3Be39B396a1bC3516c7144),
      address(0x22aaA7720ddd5388A3c0A3333430953C68f1849b),
      address(0xBA214C1c1928a32Bffe790263E38B4Af9bFCD659),
      address(0xd96f2B1c14Db8458374d9Aca76E26c3D18364307),
      address(0x4736dCf1b7A3d580672CcE6E7c65cd5cc9cFBa9D),
      address(0x169AD27A470D064DEDE56a2D3ff727986b15D52B),
      address(0x0836222F2B2B24A3F36f98668Ed8F0B38D1a872f)
    ];
  }

  function getInstances() public pure returns (TornadoProxy.Instance[] memory instances) {
    address[4] memory miningInstances = getEthInstances();
    address[8] memory allowedInstances = getErc20Instances();
    instances = new TornadoProxy.Instance[](allowedInstances.length + miningInstances.length);

    for (uint256 i = 0; i < miningInstances.length; i++) {
      // Enable mining for ETH instances
      instances[i] = TornadoProxy.Instance(miningInstances[i], TornadoProxy.InstanceState.Mineable);
    }
    for (uint256 i = 0; i < allowedInstances.length; i++) {
      // ERC20 are only allowed on proxy without enabling mining for them
      instances[miningInstances.length + i] = TornadoProxy.Instance(allowedInstances[i], TornadoProxy.InstanceState.Enabled);
    }
  }
}
