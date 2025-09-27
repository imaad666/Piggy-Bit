import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  networks: {
    rskTestnet: {
      type: 'http',
      chainId: 31,
      url: process.env.RSK_TESTNET_RPC || "https://public-node.testnet.rsk.co",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : []
    },
    rskMainnet: {
      type: 'http',
      chainId: 30,
      url: process.env.RSK_MAINNET_RPC || "https://public-node.rsk.co",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : []
    },
    sepolia: {
      type: 'http',
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC || "https://rpc.sepolia.org",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : []
    }
  },
  etherscan: {
    apiKey: {
      rskTestnet: process.env.RSK_EXPLORER_API_KEY || "",
      rskMainnet: process.env.RSK_EXPLORER_API_KEY || ""
    },
    customChains: [
      {
        network: "rskTestnet",
        chainId: 31,
        urls: { apiURL: "https://explorer.testnet.rsk.co/api", browserURL: "https://explorer.testnet.rsk.co" }
      },
      {
        network: "rskMainnet",
        chainId: 30,
        urls: { apiURL: "https://explorer.rsk.co/api", browserURL: "https://explorer.rsk.co" }
      }
    ]
  }
};

export default config;
