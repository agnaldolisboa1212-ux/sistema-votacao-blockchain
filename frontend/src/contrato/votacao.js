// Acesso ao contrato Votacao: endereco, verificacao, leituras e erros em portugues.
import { Contract, Interface, ZeroAddress, getAddress, isAddress, isHexString } from 'ethers';
import dadosContrato from './Votacao.json';
import { enderecoContratoEnv, rede } from '../config';
import { obterProviderLeitura } from '../carteira';

export const abiVotacao = dadosContrato.abi;
export const interfaceVotacao = new Interface(abiVotacao);

function normalizarEndereco(valor) {
  if (typeof valor !== 'string' || !isAddress(valor.toLowerCase())) return null;
  return getAddress(valor.toLowerCase());
}

/**
 * Endereco do contrato: VITE_ENDERECO_CONTRATO (se definida) sobrepoe-se ao de Votacao.json.
 * Fica null quando e o endereco zero ou invalido.
 */
const enderecoBruto = enderecoContratoEnv || dadosContrato.endereco || '';
const enderecoNormalizado = normalizarEndereco(enderecoBruto);

export const enderecoContrato =
  enderecoNormalizado && enderecoNormalizado !== ZeroAddress ? enderecoNormalizado : null;

export const origemEndereco = enderecoContratoEnv ? 'VITE_ENDERECO_CONTRATO' : 'src/contrato/Votacao.json';

/** Motivo pelo qual nao ha endereco utilizavel (ou null). */
export const problemaEndereco = enderecoContrato
  ? null
  : enderecoBruto && !enderecoNormalizado
    ? `O endereço indicado em ${origemEndereco} não é um endereço Ethereum válido.`
    : 'O endereço do contrato ainda é o endereço zero (ficheiro provisório).';

/** Aviso quando o ficheiro do contrato foi publicado noutra rede. */
export const avisoRedeContrato =
  !enderecoContratoEnv && dadosContrato.chainId && Number(dadosContrato.chainId) !== rede.chainId
    ? `O ficheiro Votacao.json refere a rede ${dadosContrato.rede || dadosContrato.chainId} (chainId ${dadosContrato.chainId}), mas a aplicação está configurada para ${rede.nome} (chainId ${rede.chainId}).`
    : null;

/**
 * Verifica se ha codigo no endereco do contrato.
 * @returns {Promise<{estado: 'publicado'|'nao-publicado'|'sem-rede', mensagem: string}>}
 */
export async function verificarContrato() {
  if (!enderecoContrato) {
    return { estado: 'nao-publicado', mensagem: problemaEndereco };
  }
  try {
    const codigo = await obterProviderLeitura().getCode(enderecoContrato);
    if (!codigo || codigo === '0x') {
      return {
        estado: 'nao-publicado',
        mensagem: `Não existe código de contrato no endereço ${enderecoContrato} da rede ${rede.nome}. Se reiniciou o nó local, volte a publicar o contrato.`,
      };
    }
    return { estado: 'publicado', mensagem: '' };
  } catch {
    return {
      estado: 'sem-rede',
      mensagem: `Não foi possível contactar a rede blockchain (${rede.rpc || 'RPC não configurado'}).`,
    };
  }
}

let contratoLeitura = null;

/** Contrato ligado ao provider de leitura (JsonRpcProvider). */
export function obterContratoLeitura() {
  if (!enderecoContrato) throw new Error('Contrato não publicado.');
  if (!contratoLeitura) {
    contratoLeitura = new Contract(enderecoContrato, abiVotacao, obterProviderLeitura());
  }
  return contratoLeitura;
}

/** Contrato ligado a um signer (para enviar transacoes). */
export function obterContratoEscrita(signer) {
  if (!enderecoContrato) throw new Error('Contrato não publicado.');
  return new Contract(enderecoContrato, abiVotacao, signer);
}

/**
 * Le o estado geral da eleicao.
 * @param {{ incluirVotos?: boolean }} opcoes se false, as contagens nao sao guardadas
 */
export async function lerEleicao({ incluirVotos = true } = {}) {
  const c = obterContratoLeitura();
  const [aberta, lista, totalVotos, totalEleitores] = await Promise.all([
    c.votacaoAberta(),
    c.obterCandidatos(),
    c.totalVotos(),
    c.totalEleitores(),
  ]);
  const nomes = Array.from(lista[0]);
  const votos = Array.from(lista[1]);
  const mostrarVotos = incluirVotos || !aberta;
  return {
    aberta: Boolean(aberta),
    candidatos: nomes.map((nome, id) =>
      mostrarVotos ? { id, nome, votos: Number(votos[id]) } : { id, nome },
    ),
    totalVotos: mostrarVotos ? Number(totalVotos) : null,
    totalEleitores: Number(totalEleitores),
  };
}

/** Estado de uma carteira no contrato. */
export async function lerEleitor(endereco) {
  const r = await obterContratoLeitura().eleitores(endereco);
  return { registado: Boolean(r[0]), votou: Boolean(r[1]) };
}

/** Endereco da conta administradora. */
export async function lerAdministrador() {
  return getAddress(await obterContratoLeitura().administrador());
}

/** Procura um evento do contrato no recibo de uma transacao. */
export function procurarEvento(recibo, nomeEvento) {
  if (!recibo?.logs) return null;
  for (const log of recibo.logs) {
    if (enderecoContrato && log.address && getAddress(log.address) !== enderecoContrato) continue;
    try {
      const evento = interfaceVotacao.parseLog({ topics: [...log.topics], data: log.data });
      if (evento && evento.name === nomeEvento) return evento;
    } catch {
      // log de outro contrato ou evento desconhecido
    }
  }
  return null;
}

/** Ligacao para o explorador de blocos (so em redes publicas). */
export function urlExploradorTransacao(hash) {
  return rede.explorador && hash ? `${rede.explorador}/tx/${hash}` : null;
}

export function urlExploradorEndereco(endereco) {
  return rede.explorador && endereco ? `${rede.explorador}/address/${endereco}` : null;
}

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

export const MENSAGENS_ERRO_CONTRATO = {
  ApenasAdministrador: 'Apenas a conta administradora pode fazer esta operação.',
  VotacaoEmCurso: 'Não é possível alterar os candidatos com a votação em curso. Feche a votação primeiro.',
  VotacaoFechada: 'A votação está fechada. Não é possível votar neste momento.',
  NomeInvalido: 'O nome do candidato não pode ficar vazio.',
  EnderecoInvalido: 'O endereço da carteira é inválido.',
  EleitorJaRegistado: 'Esta carteira já está registada como eleitora.',
  EleitorNaoRegistado: 'Esta carteira não está habilitada para votar.',
  JaVotou: 'Esta carteira já votou. Cada carteira só pode votar uma vez.',
  CandidatoInexistente: 'O candidato escolhido não existe.',
};

/** Recolhe possiveis dados de revert (hex) em erros de ethers, MetaMask ou Web3Auth. */
function recolherDadosRevert(erro) {
  const encontrados = [];
  const vistos = new Set();
  const visitar = (valor, profundidade) => {
    if (valor == null || profundidade > 6) return;
    if (typeof valor === 'string') {
      if (isHexString(valor) && valor.length >= 10) encontrados.push(valor);
      return;
    }
    if (typeof valor !== 'object' || vistos.has(valor)) return;
    vistos.add(valor);
    for (const chave of ['data', 'error', 'info', 'cause', 'originalError', 'value', 'receipt']) {
      if (chave in valor) visitar(valor[chave], profundidade + 1);
    }
    if (typeof valor.body === 'string') {
      try {
        visitar(JSON.parse(valor.body), profundidade + 1);
      } catch {
        // corpo nao JSON
      }
    }
  };
  visitar(erro, 0);
  return encontrados;
}

/** Nome do erro personalizado do contrato (ou null). */
export function nomeErroContrato(erro) {
  if (erro?.revert?.name) return erro.revert.name;
  for (const dados of recolherDadosRevert(erro)) {
    try {
      const descodificado = interfaceVotacao.parseError(dados);
      if (descodificado?.name) return descodificado.name;
    } catch {
      // dados que nao correspondem a nenhum erro do ABI
    }
  }
  return null;
}

function codigoCarteira(erro) {
  return erro?.code ?? erro?.info?.error?.code ?? erro?.error?.code;
}

/** Mensagem em portugues para qualquer erro de contrato, rede ou carteira. */
export function mensagemErro(erro) {
  const nome = nomeErroContrato(erro);
  if (nome && MENSAGENS_ERRO_CONTRATO[nome]) return MENSAGENS_ERRO_CONTRATO[nome];

  const codigo = codigoCarteira(erro);
  const texto = String(erro?.shortMessage || erro?.message || '').toLowerCase();

  if (codigo === 'ACTION_REJECTED' || codigo === 4001 || texto.includes('user rejected') || texto.includes('user denied')) {
    return 'A operação foi cancelada na carteira.';
  }
  if (codigo === 'INSUFFICIENT_FUNDS' || texto.includes('insufficient funds')) {
    return 'A carteira não tem saldo suficiente para pagar a taxa da transação.';
  }
  if (codigo === 'NONCE_EXPIRED' || texto.includes('nonce')) {
    return 'Conflito no número de sequência (nonce) da conta. Se reiniciou o nó local, limpe os dados de atividade da conta na carteira e tente de novo.';
  }
  if (codigo === 'NETWORK_ERROR' || codigo === 'SERVER_ERROR' || codigo === 'TIMEOUT' || texto.includes('failed to fetch')) {
    return 'Não foi possível contactar a rede blockchain. Tente novamente dentro de momentos.';
  }
  if (codigo === 4902) {
    return 'A rede pedida não está configurada na carteira.';
  }
  if (codigo === 'CALL_EXCEPTION') {
    return 'O contrato rejeitou a operação.';
  }
  if (erro instanceof Error && erro.message && !erro.code) {
    return erro.message;
  }
  return 'Ocorreu um erro inesperado. Tente novamente.';
}
