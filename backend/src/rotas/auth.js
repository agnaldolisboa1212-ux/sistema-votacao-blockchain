// Rota de autenticação: POST /api/auth/login
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { pool } from '../bd.js';

const roteador = Router();

const MENSAGEM_CREDENCIAIS = 'Email ou senha incorretos.';
const CUSTO_BCRYPT = 10; // Igual ao custo dos hashes guardados na BD.

// Hash fictício usado quando o email não existe, para que a resposta demore o mesmo tempo
// que uma senha errada e não seja possível descobrir que emails estão registados.
const HASH_FICTICIO = bcrypt.hashSync('senha-ficticia-para-igualar-o-tempo', CUSTO_BCRYPT);

// Limite de tentativas por IP. Só contam as tentativas falhadas (respostas >= 400), para que
// vários estudantes atrás do mesmo IP da faculdade não se bloqueiem uns aos outros ao entrar bem.
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Demasiadas tentativas de login. Tente novamente dentro de 15 minutos.' },
});

roteador.post('/login', limiteLogin, async (req, res) => {
  const { email, senha } = req.body ?? {};

  if (typeof email !== 'string' || typeof senha !== 'string' || email.trim() === '' || senha === '') {
    return res.status(400).json({ erro: 'Indique o email e a senha.' });
  }
  if (email.length > 160 || senha.length > 200) {
    return res.status(401).json({ erro: MENSAGEM_CREDENCIAIS });
  }

  const emailNormalizado = email.trim().toLowerCase();

  const [linhas] = await pool.execute(
    'SELECT id, nome, senha_hash, elegivel, carteira_registada FROM estudantes WHERE email = ? LIMIT 1',
    [emailNormalizado],
  );
  const estudante = linhas[0];

  if (!estudante) {
    // Compara na mesma, para igualar o tempo de resposta ao de uma senha errada.
    await bcrypt.compare(senha, HASH_FICTICIO);
    return res.status(401).json({ erro: MENSAGEM_CREDENCIAIS });
  }

  const senhaCorreta = await bcrypt.compare(senha, estudante.senha_hash);
  if (!senhaCorreta) {
    return res.status(401).json({ erro: MENSAGEM_CREDENCIAIS });
  }

  // A elegibilidade só é revelada a quem conhece a senha.
  if (!estudante.elegivel) {
    return res.status(403).json({ erro: 'Estudante não elegível para esta eleição.' });
  }

  // O payload leva apenas o id interno (sem iat), nunca dados pessoais.
  const token = jwt.sign({ sub: String(estudante.id) }, config.jwt.segredo, {
    algorithm: 'HS256',
    expiresIn: config.jwt.validade,
    noTimestamp: true,
  });
  const { exp } = jwt.decode(token);

  return res.status(200).json({
    token,
    expiraEm: new Date(exp * 1000).toISOString(),
    estudante: {
      nome: estudante.nome,
      habilitado: Boolean(estudante.carteira_registada),
    },
  });
});

export default roteador;
