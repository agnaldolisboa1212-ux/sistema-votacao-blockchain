// Ligação à blockchain (ethers v6): leitura do contrato Votacao e transações da conta administradora.
//
// Regras de privacidade deste módulo:
//  - nunca escreve endereços de carteira nos registos (os erros do ethers trazem
//    transaction.from/to/data, por isso só se regista err.code e o nome do erro do contrato);
//  - nunca devolve nem guarda a ligação entre um estudante e a sua carteira.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import config from '../config.js';

const CAMINHO_CONTRATO = fileURLToPath(new URL('../contrato/Votacao.json', import.meta.url));

const TEMPO_LIMITE_RPC_MS = 20_000; // Cada pedido JSON-RPC.
const TEMPO_LIMITE_CONFIRMACAO_MS = 120_000; // Espera pela confirmação de uma transação.
const TEMPO_LIMITE_SAUDE_MS = 3_000; // Verificação rápida para /api/saude.
const INTERVALO_MINIMO_VERIFICACAO_MS = 5_000; // Entre verificações do contrato quando não está disponível.
const CHAIN_ID_PREDEFINIDO = 31337; // Hardhat, usado só se o Votacao.json não puder ser lido.

const estado = {
  provider: null,
  chainIdProvider: null,
  carteira: null, // Conta administradora (comissão eleitoral), se CHAVE_ADMIN estiver definida.
  info: null, // { endereco, chainId, rede, blocoPublicacao, abi }
  mtimeJson: null,
  contrato: null, // Instância ligada à carteira administradora (ou só ao provider, para leitura).
  publicado: false, // Há código no endereço e a rede corresponde.
  podeRegistar: false, // A carteira administradora é o administrador do contrato.
  ultimaVerificacao: 0,
  verificacaoEmCurso: null,
  ultimaMensagem: null,
};

// ---------------------------------------------------------------------------
// Registos (sem endereços) e utilitários
// ---------------------------------------------------------------------------

/** Descrição segura de um erro: só o código e, se existir, o nome do erro personalizado do contrato. */
export function descreverErro(err) {
  const codigo = err?.code ?? err?.cause?.code ?? 'sem código';
  const nomeErroContrato = err?.revert?.name;
  return nomeErroContrato ? `${codigo}/${nomeErroContrato}` : String(codigo);
}

/** Escreve uma mensagem só quando muda, para não encher os registos a cada ciclo. */
function registarEstado(mensagem, nivel = 'warn') {
  if (estado.ultimaMensagem === mensagem) return;
  estado.ultimaMensagem = mensagem;
  console[nivel](`[blockchain] ${mensagem}`);
}

function registarFalha(etapa, err) {
  console.error(`[blockchain] Falha ao ${etapa} (${descreverErro(err)}).`);
}

function nomeErroContrato(err) {
  return err?.revert?.name ?? null;
}

function comTempoLimite(promessa, ms) {
  let temporizador;
  const limite = new Promise((_, rejeitar) => {
    temporizador = setTimeout(() => {
      const erro = new Error('Tempo limite excedido.');
      erro.code = 'TIMEOUT';
      rejeitar(erro);
    }, ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(temporizador));
}

// ---------------------------------------------------------------------------
// Provider, carteira administradora e ficheiro do contrato
// ---------------------------------------------------------------------------

function obterProvider(chainId) {
  if (estado.provider && estado.chainIdProvider === chainId) return estado.provider;

  estado.provider?.destroy();
  const pedido = new ethers.FetchRequest(config.blockchain.rpcUrl);
  pedido.timeout = TEMPO_LIMITE_RPC_MS;
  estado.provider = new ethers.JsonRpcProvider(pedido, chainId, {
    // Rede estática: evita que o ethers fique a tentar detetar a rede em ciclo (e a escrever
    // avisos na consola) quando o node ainda não está ligado. O chainId real é confirmado à parte.
    staticNetwork: true,
    // Sem a cache de 250 ms do ethers: pedidos idênticos seguidos (por exemplo o nonce "pending"
    // de duas transações da fila, ou eleitores(endereco) antes e depois de um registo) têm de
    // ir sempre ao node, senão reutilizam uma resposta desatualizada e o nonce colide.
    cacheTimeout: -1,
  });
  estado.chainIdProvider = chainId;
  estado.carteira = criarCarteira(estado.provider);
  return estado.provider;
}

function criarCarteira(provider) {
  if (!config.blockchain.chaveAdmin) return null;
  try {
    return new ethers.Wallet(config.blockchain.chaveAdmin, provider);
  } catch {
    // A mensagem do erro pode conter a chave: não é registada.
    registarEstado('CHAVE_ADMIN inválida. A habilitação de carteiras fica indisponível (503).');
    return null;
  }
}

/** Lê src/contrato/Votacao.json (só volta a ler quando o ficheiro muda). */
function lerInfoContrato() {
  const mtime = statSync(CAMINHO_CONTRATO).mtimeMs;
  if (estado.info && estado.mtimeJson === mtime) return estado.info;

  const json = JSON.parse(readFileSync(CAMINHO_CONTRATO, 'utf8'));
  if (!Array.isArray(json.abi) || !ethers.isAddress(json.endereco)) {
    throw new Error('Votacao.json sem "abi" ou "endereco" válidos.');
  }

  const enderecoJson = ethers.getAddress(json.endereco);
  const endereco = config.blockchain.enderecoContrato ?? enderecoJson;
  // Se ENDERECO_CONTRATO apontar para outra publicação, o bloco do JSON não serve:
  // a sincronização começa no bloco 0 para não perder eventos.
  const blocoPublicacao = endereco === enderecoJson ? Math.max(0, Number(json.blocoPublicacao) || 0) : 0;

  estado.info = Object.freeze({
    endereco,
    chainId: Number(json.chainId) || CHAIN_ID_PREDEFINIDO,
    rede: typeof json.rede === 'string' ? json.rede : 'desconhecida',
    blocoPublicacao,
    abi: json.abi,
  });
  estado.mtimeJson = mtime;
  // O ficheiro mudou (por exemplo, nova publicação): obriga a verificar de novo.
  estado.publicado = false;
  estado.podeRegistar = false;
  estado.contrato = null;
  estado.ultimaVerificacao = 0;
  return estado.info;
}

// ---------------------------------------------------------------------------
// Verificação do contrato
// ---------------------------------------------------------------------------

/**
 * Confirma que o contrato está publicado no node configurado. Devolve true/false, nunca lança.
 * Quando o contrato não está disponível, repete a verificação no máximo a cada 5 segundos,
 * o que permite arrancar o backend antes do node ou antes da publicação do contrato.
 */
export async function verificarContrato({ forcar = false } = {}) {
  if (estado.verificacaoEmCurso) return estado.verificacaoEmCurso;

  let info;
  try {
    info = lerInfoContrato();
  } catch (err) {
    estado.publicado = false;
    estado.contrato = null;
    registarEstado(`Não foi possível ler src/contrato/Votacao.json (${err?.code ?? 'formato inválido'}).`);
    return false;
  }

  if (!forcar && estado.publicado) return true;
  if (!forcar && Date.now() - estado.ultimaVerificacao < INTERVALO_MINIMO_VERIFICACAO_MS) return false;

  estado.verificacaoEmCurso = executarVerificacao(info).finally(() => {
    estado.verificacaoEmCurso = null;
  });
  return estado.verificacaoEmCurso;
}

async function executarVerificacao(info) {
  estado.ultimaVerificacao = Date.now();
  estado.publicado = false;
  estado.podeRegistar = false;
  estado.contrato = null;

  const provider = obterProvider(info.chainId);

  if (info.endereco === ethers.ZeroAddress) {
    registarEstado(
      'Contrato ainda não publicado (endereço zero em Votacao.json). ' +
        'As operações que precisam do contrato devolvem 503 até à publicação.',
    );
    return false;
  }

  try {
    const chainIdNo = Number(await provider.send('eth_chainId', []));
    if (chainIdNo !== info.chainId) {
      registarEstado(`O node RPC tem chainId ${chainIdNo}, mas Votacao.json indica ${info.chainId}.`);
      return false;
    }

    const codigo = await provider.getCode(info.endereco);
    if (codigo === '0x') {
      registarEstado(
        'Não há código no endereço do contrato (o node pode ter sido reiniciado sem nova publicação). ' +
          'As operações que precisam do contrato devolvem 503.',
      );
      return false;
    }

    const contrato = new ethers.Contract(info.endereco, info.abi, estado.carteira ?? provider);

    let podeRegistar = false;
    if (estado.carteira) {
      const administrador = await contrato.administrador();
      podeRegistar = ethers.getAddress(administrador) === estado.carteira.address;
      if (!podeRegistar) {
        registarEstado('A CHAVE_ADMIN não corresponde ao administrador do contrato. A habilitação devolve 503.');
      }
    }

    estado.contrato = contrato;
    estado.podeRegistar = podeRegistar;
    estado.publicado = true;
    if (podeRegistar || !estado.carteira) {
      registarEstado(`Contrato disponível em ${info.endereco} (rede ${info.rede}, chainId ${info.chainId}).`, 'log');
    }
    return true;
  } catch (err) {
    registarEstado(`Não foi possível contactar o node RPC (${descreverErro(err)}). Nova tentativa em segundo plano.`);
    return false;
  }
}

/** Obriga a nova verificação na próxima utilização (por exemplo, depois de o node ser reiniciado). */
export function invalidarContrato() {
  estado.publicado = false;
  estado.podeRegistar = false;
  estado.contrato = null;
  estado.ultimaVerificacao = 0;
}

export function obterInfoContrato() {
  return estado.info;
}

/** Instância do contrato para leitura (null se não estiver disponível). */
export function obterContrato() {
  return estado.publicado ? estado.contrato : null;
}

export function obterProviderAtual() {
  return estado.provider;
}

/** true se for possível habilitar carteiras agora (contrato publicado e chave de administrador válida). */
export async function habilitacaoDisponivel() {
  const publicado = await verificarContrato();
  return publicado && estado.podeRegistar && estado.carteira !== null;
}

/** Estado resumido para GET /api/saude. Nunca lança. */
export async function obterEstadoBlockchain() {
  let info = null;
  try {
    info = lerInfoContrato();
  } catch {
    // Ficheiro ilegível: o aviso já é escrito por verificarContrato.
  }

  const provider = obterProvider(info?.chainId ?? CHAIN_ID_PREDEFINIDO);
  let chainId = null;
  try {
    chainId = Number(await comTempoLimite(provider.send('eth_chainId', []), TEMPO_LIMITE_SAUDE_MS));
  } catch {
    // Node desligado.
  }

  const ligado = chainId !== null;
  let contratoPublicado = false;
  if (ligado && info) {
    contratoPublicado = await comTempoLimite(verificarContrato(), TEMPO_LIMITE_SAUDE_MS).catch(() => false);
    if (contratoPublicado) {
      // Confirma que o código continua lá (o node pode ter sido reiniciado entretanto).
      const codigo = await comTempoLimite(provider.getCode(info.endereco), TEMPO_LIMITE_SAUDE_MS).catch(() => null);
      if (codigo === '0x') {
        invalidarContrato();
        contratoPublicado = false;
      }
    }
  }

  return {
    ligado,
    chainId,
    contrato: info && info.endereco !== ethers.ZeroAddress ? info.endereco : null,
    contratoPublicado,
  };
}

// ---------------------------------------------------------------------------
// Habilitação de carteiras (transações da conta administradora)
// ---------------------------------------------------------------------------

// Fila simples (promessa encadeada): as transações da conta administradora são enviadas uma
// de cada vez, para que pedidos simultâneos não usem o mesmo nonce.
let filaAdministrador = Promise.resolve();

function naFilaDoAdministrador(tarefa) {
  const resultado = filaAdministrador.then(tarefa);
  filaAdministrador = resultado.then(
    () => undefined,
    () => undefined,
  );
  return resultado;
}

/**
 * Regista uma carteira no contrato: verifica se já está registada, envia ETH para o gás e chama
 * registarEleitor. Nunca lança; devolve { estado, hashTransacao? } com estado:
 *  - 'registada'    sucesso;
 *  - 'ja-registada' a carteira já estava registada no contrato (nada foi alterado);
 *  - 'falhou'       falha definitiva: a carteira NÃO ficou registada;
 *  - 'incerto'      a transação de registo foi enviada mas não foi possível confirmar o resultado
 *                   (por exemplo, tempo limite). Pode vir a ser minerada mais tarde.
 */
export function habilitarCarteira(endereco) {
  return naFilaDoAdministrador(async () => {
    const contrato = estado.contrato;
    const carteira = estado.carteira;
    if (!estado.publicado || !estado.podeRegistar || !contrato || !carteira) {
      return { estado: 'falhou' };
    }

    // Passo 2: a carteira não pode estar já registada. Antes de gastar ETH, simula também a
    // chamada a registarEleitor, para apanhar qualquer erro previsível do contrato.
    try {
      const eleitor = await contrato.eleitores(endereco);
      if (eleitor.registado) return { estado: 'ja-registada' };
      await contrato.registarEleitor.staticCall(endereco);
    } catch (err) {
      if (nomeErroContrato(err) === 'EleitorJaRegistado') return { estado: 'ja-registada' };
      registarFalha('verificar a carteira no contrato', err);
      invalidarContrato();
      return { estado: 'falhou' };
    }

    // Passo 3: envia ETH para o gás do voto (se a carteira ainda não tiver saldo suficiente,
    // o que evita enviar duas vezes quando um registo anterior falhou depois deste passo).
    try {
      const saldo = await carteira.provider.getBalance(endereco);
      if (saldo < config.blockchain.valorGasWei) {
        const txGas = await carteira.sendTransaction({ to: endereco, value: config.blockchain.valorGasWei });
        await txGas.wait(1, TEMPO_LIMITE_CONFIRMACAO_MS);
      }
    } catch (err) {
      registarFalha('enviar ETH para o gás', err);
      return { estado: 'falhou' };
    }

    // Passo 4: regista a carteira no contrato.
    let tx = null;
    try {
      tx = await contrato.registarEleitor(endereco);
      const recibo = await tx.wait(1, TEMPO_LIMITE_CONFIRMACAO_MS);
      return { estado: 'registada', hashTransacao: recibo.hash };
    } catch (err) {
      if (nomeErroContrato(err) === 'EleitorJaRegistado') return { estado: 'ja-registada' };
      registarFalha('registar o eleitor no contrato', err);

      // A transação pode ter sido minerada apesar do erro (por exemplo, falha de rede na espera).
      try {
        const eleitor = await contrato.eleitores(endereco);
        if (eleitor.registado) return { estado: 'registada', hashTransacao: tx?.hash ?? null };
      } catch {
        // Sem resposta do node: o resultado fica por confirmar.
      }

      // Transação enviada mas sem revert confirmado: não se sabe se vai ser minerada.
      if (tx && err?.code !== 'CALL_EXCEPTION') return { estado: 'incerto' };
      return { estado: 'falhou' };
    }
  });
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

export async function inicializarBlockchain() {
  if (!config.blockchain.chaveAdmin) {
    console.warn('[blockchain] CHAVE_ADMIN não definida. A habilitação de carteiras devolve 503.');
  }
  await verificarContrato({ forcar: true });
}

export function encerrarBlockchain() {
  estado.provider?.destroy();
  estado.provider = null;
  estado.chainIdProvider = null;
  estado.carteira = null;
  estado.contrato = null;
  estado.publicado = false;
}
