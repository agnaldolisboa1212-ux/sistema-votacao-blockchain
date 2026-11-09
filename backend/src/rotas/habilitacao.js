// Habilitação da carteira: POST /api/habilitacao  { endereco }
//
// Privacidade: o endereço recebido só é usado em memória para falar com o contrato.
// Nunca é guardado na BD nem escrito nos registos; a BD só fica a saber que o estudante
// já habilitou "uma" carteira (carteira_registada = 1), não qual.
import { Router } from 'express';
import { ethers } from 'ethers';
import { pool } from '../bd.js';
import { autenticar, MENSAGEM_SESSAO_INVALIDA } from '../middleware/autenticacao.js';
import { habilitacaoDisponivel, habilitarCarteira } from '../servicos/blockchain.js';

const roteador = Router();

const MENSAGEM_FALHA_BLOCKCHAIN = 'Não foi possível registar a carteira na blockchain. Tente novamente.';

/** Desfaz a marca de habilitação (só se o registo na blockchain não aconteceu). */
async function reverterMarca(idEstudante) {
  try {
    await pool.execute('UPDATE estudantes SET carteira_registada = 0 WHERE id = ?', [idEstudante]);
  } catch (err) {
    // Sem id nem endereço no registo, para não permitir correlações.
    console.error(`[habilitacao] Não foi possível reverter a marca de habilitação (${err?.code ?? 'erro'}).`);
  }
}

roteador.post('/', autenticar, async (req, res) => {
  const { endereco } = req.body ?? {};

  if (typeof endereco !== 'string' || !ethers.isAddress(endereco.trim())) {
    return res.status(400).json({ erro: 'Endereço de carteira inválido.' });
  }
  const enderecoNormalizado = ethers.getAddress(endereco.trim());
  if (enderecoNormalizado === ethers.ZeroAddress) {
    return res.status(400).json({ erro: 'Endereço de carteira inválido.' });
  }

  // Sem contrato publicado (ou sem chave de administrador) não vale a pena marcar o estudante.
  if (!(await habilitacaoDisponivel())) {
    return res
      .status(503)
      .json({ erro: 'O serviço de registo na blockchain está indisponível de momento. Tente mais tarde.' });
  }

  // Passo 1: marca atómica. Dois pedidos simultâneos do mesmo estudante não passam ambos daqui.
  const [resultado] = await pool.execute(
    'UPDATE estudantes SET carteira_registada = 1 WHERE id = ? AND elegivel = 1 AND carteira_registada = 0',
    [req.idEstudante],
  );

  if (resultado.affectedRows === 0) {
    const [linhas] = await pool.execute('SELECT elegivel FROM estudantes WHERE id = ? LIMIT 1', [req.idEstudante]);
    if (linhas.length === 0) return res.status(401).json({ erro: MENSAGEM_SESSAO_INVALIDA });
    if (!linhas[0].elegivel) return res.status(403).json({ erro: 'Estudante não elegível para esta eleição.' });
    return res.status(409).json({ erro: 'Este estudante já habilitou uma carteira.' });
  }

  // Passos 2 a 4 (verificação no contrato, ETH para o gás e registarEleitor), em fila.
  let registo;
  try {
    registo = await habilitarCarteira(enderecoNormalizado);
  } catch {
    registo = { estado: 'falhou' };
  }

  switch (registo.estado) {
    case 'registada':
      return res.status(201).json({
        mensagem: 'Carteira habilitada com sucesso. Já pode votar.',
        hashTransacao: registo.hashTransacao,
      });

    case 'ja-registada':
      await reverterMarca(req.idEstudante);
      return res.status(409).json({ erro: 'Esta carteira já está registada.' });

    case 'incerto':
      // A transação de registo foi enviada mas não foi confirmada. A marca NÃO é revertida:
      // se a transação vier a ser minerada e o estudante pudesse habilitar outra carteira,
      // ficaria com duas carteiras registadas (dois votos).
      return res.status(503).json({
        erro:
          'O registo da carteira foi enviado mas ainda não foi confirmado na blockchain. ' +
          'Verifique mais tarde ou contacte a comissão eleitoral.',
      });

    default:
      await reverterMarca(req.idEstudante);
      return res.status(503).json({ erro: MENSAGEM_FALHA_BLOCKCHAIN });
  }
});

export default roteador;
