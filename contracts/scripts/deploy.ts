import { ethers, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name);

  if (network.name === "rskTestnet") {
    // Deploy Rootstock contracts
    console.log("Deploying Rootstock tRBTC contracts...");

    const PiggyJarTRBTC = await ethers.getContractFactory("PiggyJarTRBTC");
    const owner = deployer.address;
    const name = "Sample tRBTC Jar";
    const period = 0; // Daily
    const recurringAmount = ethers.parseEther("0.001"); // 0.001 tRBTC
    const targetAmount = ethers.parseEther("0.01"); // 0.01 tRBTC

    const trbtcJar = await PiggyJarTRBTC.deploy(owner, name, period, recurringAmount, targetAmount);
    await trbtcJar.waitForDeployment();
    console.log("PiggyJarTRBTC deployed:", await trbtcJar.getAddress());

  } else if (network.name === "sepolia") {
    // Deploy Sepolia PYUSD contracts
    console.log("Deploying Sepolia PYUSD contracts...");

    // Mock PYUSD contract address on Sepolia (replace with actual when available)
    const PYUSD_ADDRESS = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582";

    const PiggyJarPYUSD = await ethers.getContractFactory("PiggyJarPYUSD");
    const PiggyJarPYUSDUPI = await ethers.getContractFactory("PiggyJarPYUSDUPI");

    const owner = deployer.address;
    const period = 0; // Daily
    const recurringAmount = 10n * 10n ** 6n; // 10 PYUSD (6 decimals)
    const targetAmount = 100n * 10n ** 6n; // 100 PYUSD (6 decimals)

    // Deploy PYUSD Jar
    const pyusdJar = await PiggyJarPYUSD.deploy(
      owner,
      "Sample PYUSD Jar",
      period,
      recurringAmount,
      targetAmount,
      PYUSD_ADDRESS
    );
    await pyusdJar.waitForDeployment();
    console.log("PiggyJarPYUSD deployed:", await pyusdJar.getAddress());

    // Deploy PYUSD UPI Jar
    const pyusdUpiJar = await PiggyJarPYUSDUPI.deploy(
      owner,
      "Sample PYUSD UPI Jar",
      period,
      recurringAmount,
      targetAmount,
      PYUSD_ADDRESS
    );
    await pyusdUpiJar.waitForDeployment();
    console.log("PiggyJarPYUSDUPI deployed:", await pyusdUpiJar.getAddress());

  } else {
    console.log("Unknown network. Please use 'rskTestnet' or 'sepolia'");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
