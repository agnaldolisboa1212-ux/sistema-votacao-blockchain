// Carteira de desenvolvimento: chave aleatoria guardada em localStorage.
// So existe sem VITE_WEB3AUTH_CLIENT_ID e com VITE_REDE_LOCAL=true.
import { Wallet } from 'ethers';

export const CHAVE_STORAGE_DEV = 'votacao.carteiraDev';

function lerGuardada() {
  try {
    const bruto = localStorage.getItem(CHAVE_STORAGE_DEV);
    if (!bruto) return null;
    const { chavePrivada } = JSON.parse(bruto);
    return typeof chavePrivada === 'string' ? chavePrivada : null;
  } catch {
    return null;
  }
}

function guardar(chavePrivada) {
  try {
    localStorage.setItem(
      CHAVE_STORAGE_DEV,
      JSON.stringify({ chavePrivada, criadaEm: new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Devolve a carteira de desenvolvimento guardada (ou cria uma nova).
 * @param {import('ethers').Provider} provider
 * @param {{ nova?: boolean }} opcoes nova=true gera sempre outra carteira
 */
export function obterCarteiraDesenvolvimento(provider, { nova = false } = {}) {
  if (!nova) {
    const chave = lerGuardada();
    if (chave) {
      try {
        return { wallet: new Wallet(chave, provider), persistente: true };
      } catch {
        // chave corrompida: gera outra
      }
    }
  }
  const aleatoria = Wallet.createRandom();
  const persistente = guardar(aleatoria.privateKey);
  return { wallet: new Wallet(aleatoria.privateKey, provider), persistente };
}
