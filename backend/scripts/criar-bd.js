// Cria a base de dados, aplica o esquema (bd/esquema.sql) e insere os estudantes de teste.
//
// Utilização:
//   npm run bd:criar              cria o que faltar; não altera estudantes que já existam
//   npm run bd:criar -- --repor   além disso, repõe carteira_registada = 0 em todos os estudantes
//                                 e esvazia logs_votacao (útil depois de reiniciar o node do Hardhat)
//
// SENHA DE TESTE: todos os estudantes de teste usam a senha abaixo (também indicada no .env.example).
// Serve apenas para desenvolvimento e demonstração.
const SENHA_TESTE = 'Teste@2026';
const CUSTO_BCRYPT = 10;

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const CAMINHO_ESQUEMA = fileURLToPath(new URL('../bd/esquema.sql', import.meta.url));

// Seis estudantes de teste; o último NÃO é elegível (para testar a resposta 403).
const ESTUDANTES_TESTE = [
  { numero: '2026001', nome: 'Ana Sofia Martins', email: 'ana.martins@faculdade.test', curso: 'Engenharia Informática', elegivel: 1 },
  { numero: '2026002', nome: 'Bruno Miguel Costa', email: 'bruno.costa@faculdade.test', curso: 'Direito', elegivel: 1 },
  { numero: '2026003', nome: 'Carla Isabel Ferreira', email: 'carla.ferreira@faculdade.test', curso: 'Economia', elegivel: 1 },
  { numero: '2026004', nome: 'Diogo Alexandre Pereira', email: 'diogo.pereira@faculdade.test', curso: 'Medicina', elegivel: 1 },
  { numero: '2026005', nome: 'Eduarda Lopes Santos', email: 'eduarda.santos@faculdade.test', curso: 'Arquitetura', elegivel: 1 },
  { numero: '2026006', nome: 'Filipe Rocha Almeida', email: 'filipe.almeida@faculdade.test', curso: 'Gestão', elegivel: 0 },
];

function texto(nome, predefinido) {
  const valor = process.env[nome];
  return valor === undefined || valor.trim() === '' ? predefinido : valor.trim();
}

async function principal() {
  const repor = process.argv.includes('--repor');
  const nomeBd = texto('DB_NOME', 'votacao');
  if (!/^[A-Za-z0-9_]+$/.test(nomeBd)) {
    throw new Error('DB_NOME só pode ter letras, números e "_".');
  }

  const ligacao = await mysql.createConnection({
    host: texto('DB_HOST', '127.0.0.1'),
    port: Number(texto('DB_PORTA', '3306')),
    user: texto('DB_UTILIZADOR', 'root'),
    password: process.env.DB_SENHA ?? '',
    charset: 'utf8mb4',
    multipleStatements: true,
    connectTimeout: 5000,
  });

  try {
    await ligacao.query(
      `CREATE DATABASE IF NOT EXISTS \`${nomeBd}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await ligacao.query(`USE \`${nomeBd}\``);
    console.log(`Base de dados "${nomeBd}" pronta.`);

    await ligacao.query(await readFile(CAMINHO_ESQUEMA, 'utf8'));
    console.log('Esquema aplicado (tabelas estudantes e logs_votacao).');

    let inseridos = 0;
    for (const estudante of ESTUDANTES_TESTE) {
      // Um hash por estudante (sais diferentes), todos com a mesma senha de teste.
      const senhaHash = await bcrypt.hash(SENHA_TESTE, CUSTO_BCRYPT);
      const [resultado] = await ligacao.execute(
        `INSERT INTO estudantes (numero_estudante, nome, email, senha_hash, curso, elegivel)
         SELECT ?, ?, ?, ?, ?, ? FROM DUAL
         WHERE NOT EXISTS (SELECT 1 FROM estudantes WHERE numero_estudante = ? OR email = ?)`,
        [
          estudante.numero,
          estudante.nome,
          estudante.email.toLowerCase(),
          senhaHash,
          estudante.curso,
          estudante.elegivel,
          estudante.numero,
          estudante.email.toLowerCase(),
        ],
      );
      inseridos += resultado.affectedRows;
    }
    console.log(
      `Estudantes de teste: ${inseridos} inserido(s), ${ESTUDANTES_TESTE.length - inseridos} já existiam.`,
    );

    if (repor) {
      const [habilitacoes] = await ligacao.query('UPDATE estudantes SET carteira_registada = 0');
      await ligacao.query('DELETE FROM logs_votacao');
      console.log(
        `Estado de demonstração reposto: ${habilitacoes.affectedRows} habilitação(ões) anulada(s) e logs_votacao vazia.`,
      );
    }

    console.log(`Senha de teste de todos os estudantes: ${SENHA_TESTE} (o estudante ${ESTUDANTES_TESTE[5].email} não é elegível).`);
  } finally {
    await ligacao.end();
  }
}

principal().catch((err) => {
  console.error(`Não foi possível criar a base de dados (${err?.code ?? err?.message ?? 'erro'}).`);
  if (err?.code === 'ECONNREFUSED') {
    console.error('Confirme que o MySQL está a correr e que DB_HOST/DB_PORTA no .env estão corretos.');
  }
  process.exitCode = 1;
});
