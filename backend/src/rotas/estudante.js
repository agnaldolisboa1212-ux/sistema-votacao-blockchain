// Rota do estudante autenticado: GET /api/estudante/estado
import { Router } from 'express';
import { pool } from '../bd.js';
import { autenticar, MENSAGEM_SESSAO_INVALIDA } from '../middleware/autenticacao.js';

const roteador = Router();

roteador.get('/estado', autenticar, async (req, res) => {
  const [linhas] = await pool.execute(
    'SELECT nome, elegivel, carteira_registada FROM estudantes WHERE id = ? LIMIT 1',
    [req.idEstudante],
  );
  const estudante = linhas[0];

  // O estudante pode ter sido removido depois de o token ser emitido.
  if (!estudante) {
    return res.status(401).json({ erro: MENSAGEM_SESSAO_INVALIDA });
  }

  return res.json({
    nome: estudante.nome,
    elegivel: Boolean(estudante.elegivel),
    habilitado: Boolean(estudante.carteira_registada),
  });
});

export default roteador;
