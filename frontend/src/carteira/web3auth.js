// Ligacao ao Web3Auth, confirmada contra @web3auth/modal 11.4.3 instalado:
//   - new Web3Auth(options: Web3AuthOptions)     (modal/dist/lib.cjs/types/modalManager.d.ts)
//   - options: clientId, web3AuthNetwork, chains[], defaultChainId, uiConfig, modalConfig,
//     walletServicesConfig.enableKeyExport, initialAuthenticationMode
//     (no-modal/dist/lib.cjs/types/base/core/IWeb3Auth.d.ts -> IWeb3AuthCoreOptions)
//   - await web3auth.init(); const ligacao = await web3auth.connect();   // Connection | null
//   - ligacao.ethereumProvider (IProvider EIP-1193). Na v11 ja nao existe o getter
//     web3auth.provider (so um setter que lanca "Not implemented").
//   - exportar a chave: provider.request({ method: 'eth_private_key' })
//     (no-modal .../ethereum-provider/rpc/walletMiddleware.js aceita 'eth_private_key' e
//     'private_key'; o @web3auth/ws-embed 6.1.0 declara 'eth_privateKey' e 'private_key').
//   - web3auth.logout()
//
// Este modulo e carregado por import() dinamico, so quando ha VITE_WEB3AUTH_CLIENT_ID.
import { WALLET_CONNECTORS, WEB3AUTH_NETWORK, Web3Auth } from '@web3auth/modal';
import { BrowserProvider, Wallet, isHexString } from 'ethers';
import { redeLocal, rpcSepolia, web3authClientId, web3authRede } from '../config';

// Usado apenas na configuracao do Web3Auth em modo local quando VITE_RPC_SEPOLIA esta vazia
// (em modo local o Web3Auth so serve para obter a chave; as transacoes vao para o no local).
const RPC_SEPOLIA_PUBLICO = 'https://ethereum-sepolia-rpc.publicnode.com';

const CADEIA_SEPOLIA = {
  chainNamespace: 'eip155',
  chainId: '0xaa36a7',
  rpcTarget: rpcSepolia || RPC_SEPOLIA_PUBLICO,
  displayName: 'Ethereum Sepolia',
  blockExplorerUrl: 'https://sepolia.etherscan.io',
  ticker: 'ETH',
  tickerName: 'Ethereum',
  logo: 'https://images.toruswallet.io/eth.svg',
  isTestnet: true,
  decimals: 18,
};

const METODOS_EXPORTAR_CHAVE = ['eth_private_key', 'eth_privateKey', 'private_key'];

let instancia = null;
let inicializacao = null;

function redeWeb3Auth() {
  const validas = Object.values(WEB3AUTH_NETWORK);
  if (!validas.includes(web3authRede)) {
    throw new Error(
      `VITE_WEB3AUTH_REDE inválida ("${web3authRede}"). Valores aceites: ${validas.join(', ')}.`,
    );
  }
  return web3authRede;
}

async function obterWeb3Auth() {
  if (instancia) return instancia;
  if (!inicializacao) {
    inicializacao = (async () => {
      const web3auth = new Web3Auth({
        clientId: web3authClientId,
        web3AuthNetwork: redeWeb3Auth(),
        chains: [CADEIA_SEPOLIA],
        defaultChainId: CADEIA_SEPOLIA.chainId,
        // So ligar (sem pedir uma assinatura extra de autenticacao).
        initialAuthenticationMode: 'connect-only',
        // A exportacao da chave so e necessaria em modo local.
        walletServicesConfig: { enableKeyExport: redeLocal },
        uiConfig: {
          appName: 'Votação Estudantil',
          defaultLanguage: 'pt',
          mode: 'auto',
          primaryButton: 'emailLogin',
          loginMethodsOrder: ['email_passwordless'],
        },
        // Apenas a carteira do Web3Auth (sem MetaMask nem descoberta de carteiras externas).
        modalConfig: {
          hideWalletDiscovery: true,
          connectors: {
            [WALLET_CONNECTORS.METAMASK]: { label: 'MetaMask', showOnModal: false },
          },
        },
        disableAnalytics: true,
      });
      await web3auth.init();
      instancia = web3auth;
      return web3auth;
    })().catch((e) => {
      inicializacao = null;
      throw e;
    });
  }
  return inicializacao;
}

function normalizarChave(valor) {
  if (typeof valor !== 'string') return null;
  const chave = valor.startsWith('0x') ? valor : `0x${valor}`;
  return isHexString(chave, 32) ? chave : null;
}

/** Pede a chave privada ao provider do Web3Auth. Fica apenas em memoria. */
async function exportarChave(providerEth) {
  for (const method of METODOS_EXPORTAR_CHAVE) {
    try {
      const chave = normalizarChave(await providerEth.request({ method }));
      if (chave) return chave;
    } catch {
      // metodo nao suportado nesta versao/conector: tenta o seguinte (sem registar nada)
    }
  }
  throw new Error(
    'Não foi possível obter a chave da carteira Web3Auth. Confirme que a exportação de chaves (key export) está ativa no painel do Web3Auth.',
  );
}

/**
 * Abre o modal do Web3Auth (que pede o email e envia o codigo) e devolve o signer.
 * @param {{ providerLocal: import('ethers').JsonRpcProvider }} opcoes
 */
export async function ligarWeb3Auth({ providerLocal }) {
  const web3auth = await obterWeb3Auth();
  const ligacao = web3auth.connected && web3auth.connection ? web3auth.connection : await web3auth.connect();
  const providerEth = ligacao?.ethereumProvider;
  if (!providerEth) {
    throw new Error('O Web3Auth não devolveu uma carteira Ethereum. Tente novamente.');
  }

  if (redeLocal) {
    // O Chrome impede o site do Web3Auth de aceder a rede local (127.0.0.1), por isso a
    // assinatura e feita nesta pagina com a chave exportada, ligada ao no local.
    const chave = await exportarChave(providerEth);
    const wallet = new Wallet(chave, providerLocal);
    return { endereco: wallet.address, signer: wallet, assinaturaLocal: true };
  }

  const browserProvider = new BrowserProvider(providerEth);
  const signer = await browserProvider.getSigner();
  return { endereco: await signer.getAddress(), signer, assinaturaLocal: false };
}

export async function desligarWeb3Auth() {
  try {
    if (instancia?.connected) await instancia.logout();
  } catch {
    // a sessao local ja foi esquecida; ignorar falhas do logout remoto
  }
}
