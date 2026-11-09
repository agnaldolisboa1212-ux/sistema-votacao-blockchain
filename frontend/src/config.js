// Configuracao lida das variaveis de ambiente do Vite (ficheiros .env*).
// Ver .env.example para a descricao de cada variavel.

const env = import.meta.env;

function texto(valor, omissao = '') {
  const t = typeof valor === 'string' ? valor.trim() : '';
  return t || omissao;
}

export const urlApi = texto(env.VITE_API_URL, 'http://localhost:3001').replace(/\/+$/, '');
export const web3authClientId = texto(env.VITE_WEB3AUTH_CLIENT_ID);
export const web3authRede = texto(env.VITE_WEB3AUTH_REDE, 'sapphire_devnet');
export const redeLocal = texto(env.VITE_REDE_LOCAL).toLowerCase() === 'true';
export const rpcLocal = texto(env.VITE_RPC_LOCAL, 'http://127.0.0.1:8545');
export const rpcSepolia = texto(env.VITE_RPC_SEPOLIA);
export const enderecoContratoEnv = texto(env.VITE_ENDERECO_CONTRATO);

export const CHAIN_LOCAL = 31337;
export const CHAIN_SEPOLIA = 11155111;

/** Rede usada para leituras e escritas, conforme VITE_REDE_LOCAL. */
export const rede = redeLocal
  ? {
      chainId: CHAIN_LOCAL,
      chainIdHex: '0x7a69',
      nome: 'Rede local (Hardhat)',
      rpc: rpcLocal,
      explorador: '',
    }
  : {
      chainId: CHAIN_SEPOLIA,
      chainIdHex: '0xaa36a7',
      nome: 'Sepolia (rede de testes Ethereum)',
      rpc: rpcSepolia,
      explorador: 'https://sepolia.etherscan.io',
    };

/**
 * Modo da carteira do estudante:
 * - 'web3auth': ha client ID do Web3Auth;
 * - 'desenvolvimento': sem client ID mas com rede local (carteira aleatoria em localStorage);
 * - 'invalido': sem client ID e sem rede local (erro de configuracao).
 */
export const modoCarteira = web3authClientId ? 'web3auth' : redeLocal ? 'desenvolvimento' : 'invalido';

/** Problemas de configuracao que impedem a app de funcionar. */
export function errosConfiguracao() {
  const erros = [];
  if (modoCarteira === 'invalido') {
    erros.push(
      'Falta VITE_WEB3AUTH_CLIENT_ID. Sem Web3Auth, a carteira de desenvolvimento só funciona com VITE_REDE_LOCAL=true.',
    );
  }
  if (!rede.rpc) {
    erros.push('Falta VITE_RPC_SEPOLIA: indique o endereço RPC da rede Sepolia.');
  }
  return erros;
}
