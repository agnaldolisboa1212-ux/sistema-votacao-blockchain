// Cliente do backend REST. Os erros chegam sempre como { erro }.
import { urlApi } from '../config';

export class ErroApi extends Error {
  /**
   * @param {string} mensagem mensagem para mostrar ao utilizador
   * @param {number} estado codigo HTTP (0 = sem resposta do servidor)
   * @param {string} [tipo] 'rede' | 'tempo' | 'http'
   */
  constructor(mensagem, estado, tipo = 'http') {
    super(mensagem);
    this.name = 'ErroApi';
    this.estado = estado;
    this.tipo = tipo;
  }
}

const MENSAGENS_POR_ESTADO = {
  400: 'Pedido inválido.',
  401: 'A sessão expirou. Inicie sessão novamente.',
  403: 'Não tem permissão para esta operação.',
  404: 'Recurso não encontrado no servidor.',
  409: 'Conflito: a operação já tinha sido feita.',
  429: 'Demasiados pedidos. Aguarde um pouco e tente novamente.',
  500: 'Erro interno do servidor.',
  503: 'Serviço temporariamente indisponível.',
};

async function pedido(caminho, { metodo = 'GET', corpo, token, tempoLimiteMs = 20000 } = {}) {
  const cabecalhos = { Accept: 'application/json' };
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (token) cabecalhos.Authorization = `Bearer ${token}`;

  let resposta;
  try {
    resposta = await fetch(`${urlApi}${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(tempoLimiteMs),
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new ErroApi('O servidor demorou demasiado a responder.', 0, 'tempo');
    }
    throw new ErroApi(
      'Não foi possível contactar o servidor. Verifique a ligação e se o backend está a correr.',
      0,
      'rede',
    );
  }

  let dados = null;
  try {
    const texto = await resposta.text();
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    const mensagem =
      (dados && typeof dados.erro === 'string' && dados.erro) ||
      MENSAGENS_POR_ESTADO[resposta.status] ||
      `Erro do servidor (${resposta.status}).`;
    throw new ErroApi(mensagem, resposta.status);
  }
  return dados ?? {};
}

/** POST /api/auth/login -> { token, expiraEm, estudante: { nome, habilitado } } */
export function iniciarSessao(email, senha) {
  return pedido('/api/auth/login', { metodo: 'POST', corpo: { email, senha } });
}

/** GET /api/estudante/estado -> { nome, elegivel, habilitado } */
export function obterEstadoEstudante(token) {
  return pedido('/api/estudante/estado', { token });
}

/**
 * POST /api/habilitacao { endereco } -> 201 { mensagem, hashTransacao }
 * Demora: o backend faz duas transacoes na blockchain.
 */
export function habilitarCarteira(token, endereco) {
  return pedido('/api/habilitacao', {
    metodo: 'POST',
    corpo: { endereco },
    token,
    tempoLimiteMs: 180000,
  });
}
