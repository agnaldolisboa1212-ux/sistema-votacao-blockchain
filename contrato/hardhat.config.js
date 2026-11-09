require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { task, types } = require("hardhat/config");

const { SEPOLIA_RPC_URL, CHAVE_ADMIN_SEPOLIA } = process.env;

// Le o endereco publicado por scripts/publicar.js para a rede atual.
async function obterContrato(hre) {
  const ficheiro = path.join(__dirname, "publicacoes", `${hre.network.name}.json`);
  if (!fs.existsSync(ficheiro)) {
    throw new Error(`Contrato nao publicado na rede "${hre.network.name}". Corra primeiro scripts/publicar.js.`);
  }
  const { endereco } = JSON.parse(fs.readFileSync(ficheiro, "utf8"));
  return hre.ethers.getContractAt("Votacao", endereco);
}

task("estado", "Mostra o estado da votacao").setAction(async (_, hre) => {
  const votacao = await obterContrato(hre);
  const [nomes, votos] = await votacao.obterCandidatos();
  console.log(`Contrato:       ${await votacao.getAddress()}`);
  console.log(`Administrador:  ${await votacao.administrador()}`);
  console.log(`Votacao aberta: ${(await votacao.votacaoAberta()) ? "sim" : "nao"}`);
  console.log(`Eleitores:      ${await votacao.totalEleitores()}`);
  console.log(`Votos:          ${await votacao.totalVotos()}`);
  nomes.forEach((nome, i) => console.log(`  [${i}] ${nome}: ${votos[i]} voto(s)`));
});

task("candidato", "Adiciona um candidato (com a votacao fechada)")
  .addParam("nome", "Nome do candidato", undefined, types.string)
  .setAction(async ({ nome }, hre) => {
    const votacao = await obterContrato(hre);
    await (await votacao.adicionarCandidato(nome)).wait();
    console.log(`Candidato adicionado: ${nome}`);
  });

task("abrir", "Abre a votacao").setAction(async (_, hre) => {
  const votacao = await obterContrato(hre);
  await (await votacao.definirVotacaoAberta(true)).wait();
  console.log("Votacao aberta.");
});

task("fechar", "Fecha a votacao").setAction(async (_, hre) => {
  const votacao = await obterContrato(hre);
  await (await votacao.definirVotacaoAberta(false)).wait();
  console.log("Votacao fechada.");
});

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    ...(SEPOLIA_RPC_URL && CHAVE_ADMIN_SEPOLIA
      ? { sepolia: { url: SEPOLIA_RPC_URL, accounts: [CHAVE_ADMIN_SEPOLIA], chainId: 11155111 } }
      : {}),
  },
};
