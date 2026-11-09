// Configuração do servidor, lida das variáveis de ambiente (ficheiro backend/.env).
// Valida os valores no arranque para falhar cedo e com uma mensagem clara.
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

// Carrega o .env da pasta backend/, independentemente da pasta de onde o node é lançado.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

function falhar(mensagem) {
  console.error(`[config] ${mensagem}`);
  process.exit(1);
}

function texto(nome, predefinido = '') {
  const valor = process.env[nome];
  return valor === undefined ? predefinido : valor.trim();
}

function inteiro(nome, predefinido, minimo = 0) {
  const bruto = texto(nome);
  if (bruto === '') return predefinido;
  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor < minimo) {
    falhar(`${nome} tem de ser um número inteiro maior ou igual a ${minimo}.`);
  }
  return valor;
}

// --- Segredo dos tokens JWT (obrigatório) ---
const jwtSegredo = texto('JWT_SEGREDO');
if (jwtSegredo.length < 32) {
  falhar('JWT_SEGREDO em falta ou demasiado curto (mínimo 32 caracteres). Veja o .env.example.');
}

// --- Valor de ETH enviado a cada carteira habilitada para pagar o gás do voto ---
let valorGasWei;
try {
  valorGasWei = ethers.parseEther(texto('VALOR_GAS_ETH', '0.01'));
} catch {
  falhar('VALOR_GAS_ETH inválido (exemplo: 0.01).');
}
if (valorGasWei <= 0n) falhar('VALOR_GAS_ETH tem de ser maior do que zero.');

// --- Endereço do contrato (opcional; sobrepõe-se ao de src/contrato/Votacao.json) ---
const enderecoContrato = texto('ENDERECO_CONTRATO');
if (enderecoContrato !== '' && !ethers.isAddress(enderecoContrato)) {
  falhar('ENDERECO_CONTRATO não é um endereço válido.');
}

const config = Object.freeze({
  porta: inteiro('PORTA', 3001, 1),
  // Aceita várias origens separadas por vírgulas.
  corsOrigens: texto('CORS_ORIGEM', 'http://localhost:5173')
    .split(',')
    .map((origem) => origem.trim())
    .filter(Boolean),

  bd: Object.freeze({
    host: texto('DB_HOST', '127.0.0.1'),
    porta: inteiro('DB_PORTA', 3306, 1),
    utilizador: texto('DB_UTILIZADOR', 'root'),
    senha: process.env.DB_SENHA ?? '',
    nome: texto('DB_NOME', 'votacao'),
  }),

  jwt: Object.freeze({
    segredo: jwtSegredo,
    validade: '15m',
  }),

  blockchain: Object.freeze({
    rpcUrl: texto('RPC_URL', 'http://127.0.0.1:8545'),
    // A chave nunca é escrita nos registos. Sem ela o servidor arranca, mas a habilitação devolve 503.
    chaveAdmin: texto('CHAVE_ADMIN'),
    valorGasWei,
    enderecoContrato: enderecoContrato === '' ? null : ethers.getAddress(enderecoContrato),
    intervaloSincronizacaoMs: inteiro('INTERVALO_SINCRONIZACAO_MS', 5000, 1000),
  }),
});

export default config;
