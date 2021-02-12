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
import "tornado-anonymity-mining/contracts/TornadoProxy.sol";
import "./interfaces/ITornadoProxyV1.sol";
import "./interfaces/IMiner.sol";
import "./verifiers/BatchTreeUpdateVerifier.sol";

contract Proposal {
  ITornadoTreesV1 public constant tornadoTreesV1 = ITornadoTreesV1(0x43a3bE4Ae954d9869836702AFd10393D3a7Ea417);
  ITornadoProxyV1 public constant tornadoProxyV1 = ITornadoProxyV1(0x905b63Fff465B9fFBF41DeA908CEb12478ec7601);
  IMiner public constant miner = IMiner(0x746Aebc06D2aE31B71ac51429A19D54E797878E9);

  function executeProposal() public {
    // Disable registering new deposits on old tornado proxy
    address[4] memory miningInstances = getEthInstances();
    for (uint256 i = 0; i < miningInstances.length; i++) {
      tornadoProxyV1.updateInstance(miningInstances[i], false);
    }

    // Deploy snark verifier form the merkle tree updates
    BatchTreeUpdateVerifier verifier = new BatchTreeUpdateVerifier();

    // Find current governance contract nonce and calculate TornadoProxy
    // expected address to solve circular dependency
    uint256 nonce = findNextNonce(address(this), address(verifier), 0);
    address tornadoProxyExpectedAddress = computeAddress(address(this), nonce + 1);

    // Deploy new TornadoTrees contract
    TornadoTrees.SearchParams memory searchParams =
      TornadoTrees.SearchParams({ // todo adjust parameters
        depositsFrom: 10258,
        depositsStep: 14,
        withdrawalsFrom: 7771,
        withdrawalsStep: 14
      });
    TornadoTrees tornadoTrees =
      new TornadoTrees(
        address(this),
        tornadoProxyExpectedAddress,
        tornadoTreesV1,
        IBatchTreeUpdateVerifier(address(verifier)),
        searchParams
      );

    // Deploy new TornadoProxy
    TornadoProxy proxy = new TornadoProxy(address(tornadoTrees), address(this), getInstances());

    // Update TornadoTrees address on the mining contract
    miner.setTornadoTreesContract(address(tornadoTrees));

    // Make sure that contract addresses are set correctly
    require(address(proxy.tornadoTrees()) == address(tornadoTrees), "tornadoTrees deployed to an unexpected address");
    require(address(tornadoTrees.tornadoProxy()) == address(proxy), "tornadoProxy deployed to an unexpected address");
  }

  function getEthInstances() public pure returns (address[4] memory) {
    return [
      address(0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc),
      address(0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936),
      address(0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF),
      address(0xA160cdAB225685dA1d56aa342Ad8841c3b53f291)
    ];
  }

  function getInstances() public pure returns (TornadoProxy.Instance[] memory instances) {
    // another approach
    //     instances = [
    //       TornadoProxy.Instance({ instance: bytes32(0xc041982b4f77cbbd82ef3b9ea748738ac6c281d3f1af198770d29f75ac32d80a), state: TornadoProxy.InstanceState.Mineable }),
    //       TornadoProxy.Instance({ instance: bytes32(0x9e5bc9215eecd103644145a5db4f69d5efaf4885bb5bf968f8db271ec5cd539b), state: TornadoProxy.InstanceState.Mineable })
    //     ];
    bytes32[4] memory miningInstances =
      [
        bytes32(0xc041982b4f77cbbd82ef3b9ea748738ac6c281d3f1af198770d29f75ac32d80a),
        bytes32(0x9e5bc9215eecd103644145a5db4f69d5efaf4885bb5bf968f8db271ec5cd539b),
        bytes32(0x917e42347647689051abc744f502bff342c76ad30c0670b46b305b2f7e1f893d),
        bytes32(0xddfc726d74f912f49389ef7471e75291969852ce7e5df0509a17bc1e46646985)
      ];

    bytes32[7] memory allowedInstances =
      [
        bytes32(0x95ad5771ba164db3fc73cc74d4436cb6a6babd7a2774911c69d8caae30410982),
        bytes32(0x109d0334da83a2c3a687972cc806b0eda52ee7a30f3e44e77b39ae2a20248321),
        bytes32(0xc9395879ffcee571b0dfd062153b27d62a6617e0f272515f2eb6259fe829c3df),
        bytes32(0xf840ad6cba4dbbab0fa58a13b092556cd53a6eeff716a3c4a41d860a888b6155),
        bytes32(0xd49809328056ea7b7be70076070bf741ec1a27b86bebafdc484eee88c1834191),
        bytes32(0x77e2b15eddc494b6da6cee0d797ed30ed3945f2c7de0150f16f0405a12e5665f),
        bytes32(0x36bab2c045f88613be6004ec1dc0c3937941fcf4d4cb78d814c933bf1cf25baf)
      ];
    instances = new TornadoProxy.Instance[](allowedInstances.length + miningInstances.length);

    for (uint256 i = 0; i < miningInstances.length; i++) {
      instances[i] = TornadoProxy.Instance(miningInstances[i], TornadoProxy.InstanceState.Mineable);
    }
    for (uint256 i = 0; i < allowedInstances.length; i++) {
      instances[miningInstances.length + i] = TornadoProxy.Instance(allowedInstances[i], TornadoProxy.InstanceState.Enabled);
    }
  }

  /// @dev find the contract nonce
  /// @param _deployer deploying (current) contract
  /// @param _lastDeployed address of the last deployed contract
  /// @param _start initial nonce to start search from
  function findNextNonce(
    address _deployer,
    address _lastDeployed,
    uint256 _start
  ) public pure returns (uint256) {
    while (computeAddress(_deployer, _start) != _lastDeployed) {
      _start++;
    }
    return _start + 1;
  }

  /// @dev compute smart contract expected deploy address
  function computeAddress(address _origin, uint256 _nonce) public pure returns (address) {
    bytes memory data;
    if (_nonce == 0x00) data = abi.encodePacked(bytes1(0xd6), bytes1(0x94), _origin, bytes1(0x80));
    else if (_nonce <= 0x7f) data = abi.encodePacked(bytes1(0xd6), bytes1(0x94), _origin, bytes1(uint8(_nonce)));
    else if (_nonce <= 0xff) data = abi.encodePacked(bytes1(0xd7), bytes1(0x94), _origin, bytes1(0x81), uint8(_nonce));
    else if (_nonce <= 0xffff) data = abi.encodePacked(bytes1(0xd8), bytes1(0x94), _origin, bytes1(0x82), uint16(_nonce));
    else if (_nonce <= 0xffffff) data = abi.encodePacked(bytes1(0xd9), bytes1(0x94), _origin, bytes1(0x83), uint24(_nonce));
    else data = abi.encodePacked(bytes1(0xda), bytes1(0x94), _origin, bytes1(0x84), uint32(_nonce));
    bytes32 hash = keccak256(data);
    return address(uint160(uint256(hash)));
  }
}
