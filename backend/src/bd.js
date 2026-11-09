// Ligação à base de dados MySQL (pool de ligações mysql2/promise).
// O pool não liga no arranque: se o MySQL estiver em baixo, o servidor arranca na mesma
// e cada pedido que precise da BD falha com 503.
import mysql from 'mysql2/promise';
import config from './config.js';

export const pool = mysql.createPool({
  host: config.bd.host,
  port: config.bd.porta,
  user: config.bd.utilizador,
  password: config.bd.senha,
  database: config.bd.nome,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 5000,
});

// Todas as sessões trabalham em UTC, para que FROM_UNIXTIME (usado em logs_votacao.data_hora)
// dê o mesmo resultado independentemente do fuso horário configurado no servidor MySQL.
pool.on('connection', (ligacao) => {
  ligacao.query("SET time_zone = '+00:00'", (err) => {
    if (err) console.warn(`[bd] Não foi possível definir o fuso horário da sessão (${err.code ?? 'erro'}).`);
  });
});

// Códigos de erro que indicam que a BD está inacessível (e não um erro do pedido).
const CODIGOS_BD_INDISPONIVEL = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_CON_COUNT_ERROR',
  'ER_NO_SUCH_TABLE',
]);

export function erroDeLigacaoBd(err) {
  return Boolean(err && CODIGOS_BD_INDISPONIVEL.has(err.code));
}

/** Verifica se a BD responde. Nunca lança exceções. */
export async function verificarBd() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function encerrarBd() {
  try {
    await pool.end();
  } catch {
    // Ignorado: o processo vai terminar de qualquer forma.
  }
}
