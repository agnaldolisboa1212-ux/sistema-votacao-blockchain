// Modulo da carteira: esconde do resto da app se a assinatura e feita pelo
// Web3Auth (Sepolia), por uma chave exportada do Web3Auth (rede local) ou por
// uma carteira de desenvolvimento gerada no navegador.
//
// API:
//   ligarCarteira()        -> { endereco, signer, modo, ... }
//   desligarCarteira()
//   novaCarteiraTeste()    -> so no modo de desenvolvimento
//   obterProviderLeitura() -> JsonRpcProvider para leituras do contrato
//   obterCarteiraAtual() / subscreverCarteira(fn)
import { JsonRpcProvider } from 'ethers';
import { modoCarteira, rede, redeLocal } from '../config';
import { obterCarteiraDesenvolvimento } from './desenvolvimento';

export { modoCarteira };

let providerLeitura = null;

/** Provider JSON-RPC para leituras (VITE_RPC_LOCAL em modo local, VITE_RPC_SEPOLIA caso contrario). */
export function obterProviderLeitura() {
  if (!providerLeitura) {
    if (!rede.rpc) throw new Error('Endereço RPC não configurado.');
    // staticNetwork evita pedidos repetidos de deteccao da rede quando o no esta em baixo.
    providerLeitura = new JsonRpcProvider(rede.rpc, rede.chainId, {
      staticNetwork: true,
      pollingInterval: rede.chainId === 31337 ? 1000 : 4000,
    });
  }
  return providerLeitura;
}

// ---------------------------------------------------------------------------
// Estado partilhado (a carteira ligada mantem-se ao mudar de pagina)
// ---------------------------------------------------------------------------

let carteiraAtual = null;
const ouvintes = new Set();

function definirCarteira(carteira) {
  carteiraAtual = carteira;
  for (const fn of ouvintes) fn(carteira);
  return carteira;
}

export function obterCarteiraAtual() {
  return carteiraAtual;
}

export function subscreverCarteira(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

let ligacaoEmCurso = null;

/**
 * Liga a carteira do estudante.
 * @returns {Promise<{ endereco: string, signer: import('ethers').Signer, modo: 'web3auth'|'desenvolvimento', descricao: string, persistente?: boolean }>}
 */
export async function ligarCarteira() {
  if (carteiraAtual) return carteiraAtual;
  if (ligacaoEmCurso) return ligacaoEmCurso;

  ligacaoEmCurso = (async () => {
    if (modoCarteira === 'desenvolvimento') {
      const { wallet, persistente } = obterCarteiraDesenvolvimento(obterProviderLeitura());
      return definirCarteira({
        endereco: wallet.address,
        signer: wallet,
        modo: 'desenvolvimento',
        descricao: 'Carteira de desenvolvimento (sem Web3Auth)',
        persistente,
      });
    }

    if (modoCarteira === 'web3auth') {
      // Import dinamico: o SDK do Web3Auth so e descarregado quando e preciso.
      const { ligarWeb3Auth } = await import('./web3auth');
      const { endereco, signer, assinaturaLocal } = await ligarWeb3Auth({
        providerLocal: redeLocal ? obterProviderLeitura() : null,
      });
      return definirCarteira({
        endereco,
        signer,
        modo: 'web3auth',
        descricao: assinaturaLocal
          ? 'Carteira Web3Auth (assinatura nesta página, rede local)'
          : 'Carteira Web3Auth',
      });
    }

    throw new Error(
      'Configuração inválida: defina VITE_WEB3AUTH_CLIENT_ID ou, em desenvolvimento, VITE_REDE_LOCAL=true.',
    );
  })();

  try {
    return await ligacaoEmCurso;
  } finally {
    ligacaoEmCurso = null;
  }
}

/** Gera outra carteira de desenvolvimento (simula outro estudante). */
export async function novaCarteiraTeste() {
  if (modoCarteira !== 'desenvolvimento') {
    throw new Error('Só é possível gerar carteiras de teste no modo de desenvolvimento.');
  }
  const { wallet, persistente } = obterCarteiraDesenvolvimento(obterProviderLeitura(), { nova: true });
  return definirCarteira({
    endereco: wallet.address,
    signer: wallet,
    modo: 'desenvolvimento',
    descricao: 'Carteira de desenvolvimento (sem Web3Auth)',
    persistente,
  });
}

/** Esquece a carteira ligada (e termina a sessao do Web3Auth, se for o caso). */
export async function desligarCarteira() {
  const anterior = carteiraAtual;
  definirCarteira(null);
  if (anterior?.modo === 'web3auth') {
    const { desligarWeb3Auth } = await import('./web3auth');
    await desligarWeb3Auth();
  }
}
