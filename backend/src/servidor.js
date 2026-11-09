// Ponto de entrada do backend: API REST (Express 5) + sincronização de eventos da blockchain.
//
// O backend só autentica, verifica a elegibilidade, habilita carteiras e copia os eventos de voto.
// O voto em si é feito diretamente no contrato pela carteira do estudante e nunca passa por aqui.
import express from 'express';
import cors from 'cors';
import config from './config.js';
import { encerrarBd, erroDeLigacaoBd, verificarBd } from './bd.js';
import rotasAuth from './rotas/auth.js';
import rotasEstudante from './rotas/estudante.js';
import rotasHabilitacao from './rotas/habilitacao.js';
import { encerrarBlockchain, inicializarBlockchain, obterEstadoBlockchain } from './servicos/blockchain.js';
import { iniciarSincronizacao, pararSincronizacao } from './servicos/sincronizacao.js';

const app = express();

app.disable('x-powered-by');
// Se o servidor ficar atrás de um proxy (nginx, por exemplo), ative "trust proxy" para que o
// limite de tentativas de login use o IP real do cliente: app.set('trust proxy', 1);

app.use(
  cors({
    origin: config.corsOrigens,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json({ limit: '10kb' }));

// --- Rotas ---
app.get('/api/saude', async (req, res) => {
  const [bd, blockchain] = await Promise.all([verificarBd(), obterEstadoBlockchain()]);
  res.json({
    ok: bd && blockchain.ligado && blockchain.contratoPublicado,
    bd,
    blockchain,
  });
});

app.use('/api/auth', rotasAuth);
app.use('/api/estudante', rotasEstudante);
app.use('/api/habilitacao', rotasHabilitacao);

// --- Rota inexistente ---
app.use((req, res) => {
  res.status(404).json({ erro: 'Recurso não encontrado.' });
});

// --- Tratamento global de erros (sem detalhes internos na resposta nem dados sensíveis nos registos) ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // Erros do express.json (corpo mal formado, demasiado grande, etc.).
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'O corpo do pedido não é JSON válido.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'O corpo do pedido é demasiado grande.' });
  }
  if (err?.type && Number(err.status) >= 400 && Number(err.status) < 500) {
    return res.status(400).json({ erro: 'Pedido inválido.' });
  }

  if (erroDeLigacaoBd(err)) {
    console.error(`[bd] Base de dados indisponível (${err.code}).`);
    return res.status(503).json({ erro: 'Serviço temporariamente indisponível. Tente novamente mais tarde.' });
  }

  console.error(`[erro] ${req.method} ${req.path} (${err?.code ?? err?.name ?? 'erro desconhecido'})`);
  return res.status(500).json({ erro: 'Erro interno do servidor.' });
});

// Último recurso: um erro inesperado numa tarefa em segundo plano não deve derrubar o servidor.
process.on('unhandledRejection', (motivo) => {
  console.error(`[processo] Promessa rejeitada sem tratamento (${motivo?.code ?? motivo?.name ?? 'erro'}).`);
});

// --- Arranque ---
const servidor = app.listen(config.porta, (err) => {
  if (err) {
    console.error(`[servidor] Não foi possível escutar na porta ${config.porta} (${err.code ?? 'erro'}).`);
    process.exit(1);
  }
  console.log(`[servidor] API disponível em http://localhost:${config.porta}/api`);
  inicializarBlockchain()
    .catch(() => {})
    .finally(() => iniciarSincronizacao());
});

// --- Encerramento ordenado ---
let aEncerrar = false;
async function encerrar(sinal) {
  if (aEncerrar) return;
  aEncerrar = true;
  console.log(`[servidor] ${sinal} recebido. A encerrar...`);
  pararSincronizacao();
  servidor.close();
  servidor.closeAllConnections?.();
  encerrarBlockchain();
  await encerrarBd();
  process.exit(0);
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
