// Sincronização dos eventos VotoRegistado do contrato para a tabela logs_votacao,
// que alimenta o módulo Python de deteção de anomalias.
//
// - Corre no arranque e depois a cada INTERVALO_SINCRONIZACAO_MS.
// - Lê os eventos em intervalos de no máximo 2000 blocos, desde o último bloco processado.
// - INSERT IGNORE: a coluna hash_transacao é única, por isso repetir um intervalo não duplica linhas.
// - Se o node for reiniciado (o bloco atual fica abaixo do último processado ou o hash desse
//   bloco muda), recomeça no bloco de publicação do contrato.
// - Os erros nunca derrubam o servidor e os registos nunca incluem endereços.
import config from '../config.js';
import { pool } from '../bd.js';
import {
  descreverErro,
  invalidarContrato,
  obterContrato,
  obterInfoContrato,
  obterProviderAtual,
  verificarContrato,
} from './blockchain.js';

const MAXIMO_BLOCOS_POR_CONSULTA = 2000;
const MAXIMO_LINHAS_POR_INSERT = 500;

const estado = {
  chaveContrato: null, // Identifica a publicação em uso (endereço + chainId + bloco de publicação).
  proximoBloco: null, // Primeiro bloco ainda por processar.
  ultimoBloco: null, // { numero, hash } do último bloco processado, para detetar reinícios do node.
  emCurso: null,
  ativo: false,
  temporizador: null,
  ultimaMensagem: null,
};

function registarEstado(mensagem, nivel = 'warn') {
  if (estado.ultimaMensagem === mensagem) return;
  estado.ultimaMensagem = mensagem;
  console[nivel](`[sincronizacao] ${mensagem}`);
}

function recomecar(info) {
  estado.chaveContrato = info ? `${info.chainId}:${info.endereco}:${info.blocoPublicacao}` : null;
  estado.proximoBloco = info ? info.blocoPublicacao : null;
  estado.ultimoBloco = null;
}

async function guardarEventos(eventos) {
  for (let i = 0; i < eventos.length; i += MAXIMO_LINHAS_POR_INSERT) {
    const lote = eventos.slice(i, i + MAXIMO_LINHAS_POR_INSERT);
    const marcadores = [];
    const valores = [];
    for (const evento of lote) {
      if (!evento.args) continue; // Registo que não foi possível descodificar com o ABI.
      marcadores.push('(?, ?, FROM_UNIXTIME(?), ?)');
      valores.push(
        evento.args.eleitor,
        Number(evento.args.idCandidato),
        Number(evento.args.dataHora),
        evento.transactionHash,
      );
    }
    if (marcadores.length === 0) continue;
    await pool.query(
      `INSERT IGNORE INTO logs_votacao (endereco, id_candidato, data_hora, hash_transacao) VALUES ${marcadores.join(', ')}`,
      valores,
    );
  }
}

/** Deteta se a cadeia mudou desde a última ronda (node reiniciado ou reorganização). */
async function cadeiaMudou(provider, blocoAtual) {
  if (!estado.ultimoBloco) return false;
  if (blocoAtual < estado.ultimoBloco.numero) return true;
  const bloco = await provider.getBlock(estado.ultimoBloco.numero);
  return !bloco || bloco.hash !== estado.ultimoBloco.hash;
}

async function executarSincronizacao() {
  try {
    if (!(await verificarContrato())) return { ok: false, motivo: 'contrato-indisponivel', eventos: 0 };

    let contrato = obterContrato();
    let info = obterInfoContrato();
    const provider = obterProviderAtual();
    if (!contrato || !info || !provider) return { ok: false, motivo: 'contrato-indisponivel', eventos: 0 };

    const chave = `${info.chainId}:${info.endereco}:${info.blocoPublicacao}`;
    if (estado.chaveContrato !== chave) recomecar(info);

    const blocoAtual = await provider.getBlockNumber();

    if (await cadeiaMudou(provider, blocoAtual)) {
      registarEstado('A cadeia mudou (o node foi reiniciado?). A sincronização recomeça no bloco de publicação.');
      invalidarContrato();
      recomecar(null);
      if (!(await verificarContrato({ forcar: true }))) {
        return { ok: false, motivo: 'contrato-indisponivel', eventos: 0 };
      }
      contrato = obterContrato();
      info = obterInfoContrato();
      if (!contrato || !info) return { ok: false, motivo: 'contrato-indisponivel', eventos: 0 };
      recomecar(info);
    }

    let total = 0;
    while (estado.proximoBloco <= blocoAtual) {
      const de = estado.proximoBloco;
      const ate = Math.min(de + MAXIMO_BLOCOS_POR_CONSULTA - 1, blocoAtual);

      const eventos = await contrato.queryFilter(contrato.filters.VotoRegistado(), de, ate);
      await guardarEventos(eventos);

      // Só avança depois de os eventos estarem guardados: se a BD falhar, o intervalo repete-se.
      const bloco = await provider.getBlock(ate);
      estado.ultimoBloco = bloco ? { numero: ate, hash: bloco.hash } : null;
      estado.proximoBloco = ate + 1;
      total += eventos.length;
    }

    if (total > 0) {
      console.log(`[sincronizacao] ${total} evento(s) VotoRegistado copiado(s) até ao bloco ${blocoAtual}.`);
    }
    registarEstado('Sincronização de eventos ativa.', 'log');
    return { ok: true, eventos: total, ultimoBloco: estado.proximoBloco - 1 };
  } catch (err) {
    registarEstado(`Falha na sincronização de eventos (${descreverErro(err)}). Nova tentativa no próximo ciclo.`);
    return { ok: false, motivo: 'erro', eventos: 0 };
  }
}

/**
 * Executa uma ronda de sincronização já (ou junta-se à ronda que estiver a decorrer).
 * Nunca rejeita: devolve { ok, eventos, ultimoBloco? , motivo? }.
 */
export function sincronizarAgora() {
  if (!estado.emCurso) {
    estado.emCurso = executarSincronizacao().finally(() => {
      estado.emCurso = null;
    });
  }
  return estado.emCurso;
}

/** Inicia o ciclo periódico (a primeira ronda corre de imediato). */
export function iniciarSincronizacao() {
  if (estado.ativo) return;
  estado.ativo = true;

  const ciclo = async () => {
    await sincronizarAgora();
    if (estado.ativo) {
      estado.temporizador = setTimeout(ciclo, config.blockchain.intervaloSincronizacaoMs);
    }
  };
  ciclo();
}

export function pararSincronizacao() {
  estado.ativo = false;
  clearTimeout(estado.temporizador);
  estado.temporizador = null;
}
