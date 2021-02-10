//SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "tornado-trees/contracts/interfaces/ITornadoTreesV1.sol";
import "tornado-trees/contracts/interfaces/IBatchTreeUpdateVerifier.sol";
import "tornado-trees/contracts/TornadoTrees.sol";
import "tornado-anonymity-mining/contracts/TornadoProxy.sol";
import "./interfaces/ITornadoProxyV1.sol";
import "./interfaces/IMiner.sol";
import "./interfaces/IDeployer.sol";
import "./verifiers/BatchTreeUpdateVerifier.sol";

contract Proposal {
  ITornadoTreesV1 public constant tornadoTreesV1 = ITornadoTreesV1(0x43a3bE4Ae954d9869836702AFd10393D3a7Ea417);
  ITornadoProxyV1 public constant tornadoProxyV1 = ITornadoProxyV1(0x905b63Fff465B9fFBF41DeA908CEb12478ec7601);
  IMiner public constant miner = IMiner(0x746Aebc06D2aE31B71ac51429A19D54E797878E9);
  IDeployer public constant deployer = IDeployer(0xce0042B868300000d44A59004Da54A005ffdcf9f);
  bytes32 constant deploySalt = 0x0000000000000000000000000000000000000000000000000000000047941987;

  // todo avoid sstore
  address[4] public miningInstances = [
    address(0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc),
    address(0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936),
    address(0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF),
    address(0xA160cdAB225685dA1d56aa342Ad8841c3b53f291)
  ];

  address[1] public allowedInstances = [
    // todo paste valid addresses except eth
    // todo use ENS
    address(0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF)
  ];

  function executeProposal() public {
    // Disable logging new deposits on old tornado proxy
    for (uint256 i = 0; i < miningInstances.length; i++) {
      tornadoProxyV1.updateInstance(miningInstances[i], false);
    }

    // Deploy snark verifier for merkle tree updates
    BatchTreeUpdateVerifier verifier = BatchTreeUpdateVerifier(deployer.deploy(type(BatchTreeUpdateVerifier).creationCode, deploySalt));
    require(address(verifier) != address(0));

    // Deploy new TornadoTrees contract
    TornadoTrees.SearchParams memory searchParams = TornadoTrees.SearchParams({
      // todo adjust parameters
      unprocessedDeposits: 8000,
      unprocessedWithdrawals: 8000,
      depositsPerDay: 50,
      withdrawalsPerDay: 50
    });
    TornadoTrees tornadoTrees = new TornadoTrees(
      address(this),
      bytes32(0), // todo
      tornadoTreesV1,
      IBatchTreeUpdateVerifier(address(verifier)),
      searchParams
    );

    // Deploy new TornadoProxy
    TornadoProxy.Instance[] memory instances = new TornadoProxy.Instance[](allowedInstances.length + miningInstances.length);
    for (uint256 i = 0; i < miningInstances.length; i++) {
      instances[i] = TornadoProxy.Instance(
        bytes32(uint256(uint160(miningInstances[i]))),
        TornadoProxy.InstanceState.Mineable
      );
    }
    for (uint256 i = 0; i < allowedInstances.length; i++) {
      instances[miningInstances.length + i] = TornadoProxy.Instance(
        bytes32(uint256(uint160(allowedInstances[i]))),
        TornadoProxy.InstanceState.Enabled
      );
    }
    TornadoProxy proxy = new TornadoProxy(
      address(tornadoTrees),
      address(this),
      instances
    );

    // Update TornadoTrees address on mining contract
    miner.setTornadoTreesContract(address(tornadoTrees));

    // Make sure that contract addresses are resolved correctly
    require(address(proxy.tornadoTrees()) == address(tornadoTrees), "tornadoTrees deployed to an unexpected address");
    require(address(tornadoTrees.tornadoProxy()) == address(proxy), "tornadoProxy deployed to an unexpected address");
  }

}
