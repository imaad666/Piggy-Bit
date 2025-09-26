import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const PiggyJar = await ethers.getContractFactory("PiggyJar");
  const target = 10n;
  const threshold = 5n;
  const jar = await PiggyJar.deploy(deployer.address, target, threshold, "My Jar");
  await jar.waitForDeployment();
  console.log("PiggyJar deployed:", await jar.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
