// Publica o contrato Votacao e configura o endereco no frontend e no backend.
// Uso: npx hardhat run scripts/publicar.js --network localhost   (ou sepolia)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const RAIZ = path.join(__dirname, "..", "..");
const DESTINOS = [
  path.join(__dirname, "..", "publicacoes"), // historico por rede
  path.join(RAIZ, "backend", "src", "contrato"),
  path.join(RAIZ, "frontend", "src", "contrato"),
];

async function main() {
  const [admin] = await hre.ethers.getSigners();
  console.log(`Rede: ${hre.network.name}`);
  console.log(`Conta administradora: ${admin.address}`);

  const votacao = await hre.ethers.deployContract("Votacao");
  await votacao.waitForDeployment();
  const recibo = await votacao.deploymentTransaction().wait();

  const { chainId } = await hre.ethers.provider.getNetwork();
  const { abi } = await hre.artifacts.readArtifact("Votacao");
  const dados = {
    endereco: await votacao.getAddress(),
    chainId: Number(chainId),
    rede: hre.network.name,
    blocoPublicacao: recibo.blockNumber,
    administrador: admin.address,
    publicadoEm: new Date().toISOString(),
    abi,
  };

  const json = JSON.stringify(dados, null, 2) + "\n";
  for (const pasta of DESTINOS) {
    fs.mkdirSync(pasta, { recursive: true });
    const nome = pasta.endsWith("publicacoes") ? `${hre.network.name}.json` : "Votacao.json";
    fs.writeFileSync(path.join(pasta, nome), json);
    console.log(`Escrito: ${path.relative(RAIZ, path.join(pasta, nome))}`);
  }

  console.log(`\nContrato Votacao publicado em ${dados.endereco} (bloco ${dados.blocoPublicacao}).`);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
