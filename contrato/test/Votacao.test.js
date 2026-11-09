const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Votacao", function () {
  async function publicar() {
    const [admin, eleitor1, eleitor2, outro] = await ethers.getSigners();
    const votacao = await ethers.deployContract("Votacao");
    return { votacao, admin, eleitor1, eleitor2, outro };
  }

  async function comCandidatosEEleitores() {
    const base = await publicar();
    const { votacao, eleitor1, eleitor2 } = base;
    await votacao.adicionarCandidato("Lista A");
    await votacao.adicionarCandidato("Lista B");
    await votacao.registarEleitor(eleitor1.address);
    await votacao.registarEleitor(eleitor2.address);
    return base;
  }

  async function comVotacaoAberta() {
    const base = await comCandidatosEEleitores();
    await base.votacao.definirVotacaoAberta(true);
    return base;
  }

  it("1. define o administrador e comeca fechada e sem candidatos", async function () {
    const { votacao, admin } = await loadFixture(publicar);

    expect(await votacao.administrador()).to.equal(admin.address);
    expect(await votacao.votacaoAberta()).to.equal(false);
    expect(await votacao.obterNumeroCandidatos()).to.equal(0n);
    expect(await votacao.totalEleitores()).to.equal(0n);
    expect(await votacao.totalVotos()).to.equal(0n);
  });

  it("2. so o administrador adiciona candidatos e e emitido CandidatoAdicionado", async function () {
    const { votacao, outro } = await loadFixture(publicar);

    await expect(votacao.adicionarCandidato("Lista A"))
      .to.emit(votacao, "CandidatoAdicionado")
      .withArgs(0n, "Lista A");
    await expect(votacao.connect(outro).adicionarCandidato("Lista X"))
      .to.be.revertedWithCustomError(votacao, "ApenasAdministrador");
    await expect(votacao.adicionarCandidato("")).to.be.revertedWithCustomError(votacao, "NomeInvalido");

    expect(await votacao.obterNumeroCandidatos()).to.equal(1n);
    const [nomes, votos] = await votacao.obterCandidatos();
    expect(nomes).to.deep.equal(["Lista A"]);
    expect(votos).to.deep.equal([0n]);
  });

  it("3. nao permite adicionar candidatos com a votacao aberta", async function () {
    const { votacao } = await loadFixture(comVotacaoAberta);

    await expect(votacao.adicionarCandidato("Lista C")).to.be.revertedWithCustomError(votacao, "VotacaoEmCurso");
    expect(await votacao.obterNumeroCandidatos()).to.equal(2n);
  });

  it("4. so o administrador regista eleitores, sem duplicados, tambem durante a votacao", async function () {
    const { votacao, eleitor1, outro } = await loadFixture(publicar);

    await expect(votacao.registarEleitor(eleitor1.address))
      .to.emit(votacao, "EleitorRegistado")
      .withArgs(eleitor1.address);
    await expect(votacao.registarEleitor(eleitor1.address))
      .to.be.revertedWithCustomError(votacao, "EleitorJaRegistado");
    await expect(votacao.registarEleitor(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(votacao, "EnderecoInvalido");
    await expect(votacao.connect(outro).registarEleitor(outro.address))
      .to.be.revertedWithCustomError(votacao, "ApenasAdministrador");

    await votacao.definirVotacaoAberta(true);
    await expect(votacao.registarEleitor(outro.address)).to.emit(votacao, "EleitorRegistado");

    expect(await votacao.totalEleitores()).to.equal(2n);
    const estado = await votacao.eleitores(eleitor1.address);
    expect(estado.registado).to.equal(true);
    expect(estado.votou).to.equal(false);
  });

  it("5. so o administrador abre e fecha a votacao", async function () {
    const { votacao, outro } = await loadFixture(publicar);

    await expect(votacao.definirVotacaoAberta(true))
      .to.emit(votacao, "EstadoVotacaoAlterado")
      .withArgs(true);
    expect(await votacao.votacaoAberta()).to.equal(true);

    await expect(votacao.connect(outro).definirVotacaoAberta(false))
      .to.be.revertedWithCustomError(votacao, "ApenasAdministrador");

    await expect(votacao.definirVotacaoAberta(false))
      .to.emit(votacao, "EstadoVotacaoAlterado")
      .withArgs(false);
    expect(await votacao.votacaoAberta()).to.equal(false);
  });

  it("6. regista o voto e emite VotoRegistado com o endereco, o candidato e a data e hora", async function () {
    const { votacao, eleitor1 } = await loadFixture(comVotacaoAberta);

    const tx = await votacao.connect(eleitor1).votar(1);
    const recibo = await tx.wait();
    const bloco = await ethers.provider.getBlock(recibo.blockNumber);

    await expect(tx)
      .to.emit(votacao, "VotoRegistado")
      .withArgs(eleitor1.address, 1n, BigInt(bloco.timestamp));

    const [, votos] = await votacao.obterCandidatos();
    expect(votos).to.deep.equal([0n, 1n]);
    expect(await votacao.totalVotos()).to.equal(1n);
    expect((await votacao.eleitores(eleitor1.address)).votou).to.equal(true);
  });

  it("7. rejeita o voto com a votacao fechada ou de carteira nao registada", async function () {
    const { votacao, eleitor1, outro } = await loadFixture(comCandidatosEEleitores);

    await expect(votacao.connect(eleitor1).votar(0)).to.be.revertedWithCustomError(votacao, "VotacaoFechada");

    await votacao.definirVotacaoAberta(true);
    await expect(votacao.connect(outro).votar(0)).to.be.revertedWithCustomError(votacao, "EleitorNaoRegistado");

    expect(await votacao.totalVotos()).to.equal(0n);
  });

  it("8. rejeita o segundo voto da mesma carteira e o voto em candidato inexistente", async function () {
    const { votacao, eleitor1, eleitor2 } = await loadFixture(comVotacaoAberta);

    await votacao.connect(eleitor1).votar(0);
    await expect(votacao.connect(eleitor1).votar(1)).to.be.revertedWithCustomError(votacao, "JaVotou");
    await expect(votacao.connect(eleitor2).votar(2)).to.be.revertedWithCustomError(votacao, "CandidatoInexistente");

    const [, votos] = await votacao.obterCandidatos();
    expect(votos).to.deep.equal([1n, 0n]);
    expect(await votacao.totalVotos()).to.equal(1n);
    expect((await votacao.eleitores(eleitor2.address)).votou).to.equal(false);
  });
});
