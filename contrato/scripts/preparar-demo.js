// Prepara uma eleicao de demonstracao no contrato ja publicado:
// adiciona candidatos (se ainda nao houver) e, com ABRIR_VOTACAO=true, abre a votacao.
// Uso: npx hardhat run scripts/preparar-demo.js --network localhost
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const CANDIDATOS = (process.env.CANDIDATOS || "Lista A - Renovar;Lista B - Participar;Lista C - Inovar")
  .split(";")
  .map((nome) => nome.trim())
  .filter(Boolean);

async function main() {
  const ficheiro = path.join(__dirname, "..", "publicacoes", `${hre.network.name}.json`);
  if (!fs.existsSync(ficheiro)) throw new Error("Contrato nao publicado nesta rede. Corra primeiro scripts/publicar.js.");
  const { endereco } = JSON.parse(fs.readFileSync(ficheiro, "utf8"));
  const votacao = await hre.ethers.getContractAt("Votacao", endereco);

  if ((await votacao.obterNumeroCandidatos()) === 0n) {
    for (const nome of CANDIDATOS) {
      await (await votacao.adicionarCandidato(nome)).wait();
      console.log(`Candidato adicionado: ${nome}`);
    }
  } else {
    console.log("O contrato ja tem candidatos; nada a adicionar.");
  }

  if (process.env.ABRIR_VOTACAO === "true" && !(await votacao.votacaoAberta())) {
    await (await votacao.definirVotacaoAberta(true)).wait();
    console.log("Votacao aberta.");
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
