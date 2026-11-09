// Middleware que valida o token JWT enviado no cabeçalho "Authorization: Bearer <token>".
// Em caso de sucesso, coloca o id interno do estudante em req.idEstudante.
import jwt from 'jsonwebtoken';
import config from '../config.js';

const MENSAGEM_SESSAO_INVALIDA = 'Sessão inválida ou expirada.';

export function autenticar(req, res, next) {
  const cabecalho = req.get('authorization') ?? '';
  const [esquema, token] = cabecalho.split(' ');

  if (esquema?.toLowerCase() !== 'bearer' || !token) {
    return res.status(401).json({ erro: MENSAGEM_SESSAO_INVALIDA });
  }

  try {
    const payload = jwt.verify(token, config.jwt.segredo, { algorithms: ['HS256'] });
    if (typeof payload?.sub !== 'string' || !/^[1-9]\d{0,9}$/.test(payload.sub)) {
      return res.status(401).json({ erro: MENSAGEM_SESSAO_INVALIDA });
    }
    req.idEstudante = Number(payload.sub);
    return next();
  } catch {
    // Token mal formado, assinatura inválida ou expirado: a resposta é sempre a mesma.
    return res.status(401).json({ erro: MENSAGEM_SESSAO_INVALIDA });
  }
}

export { MENSAGEM_SESSAO_INVALIDA };
