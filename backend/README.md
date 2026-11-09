# Backend: votação eletrónica estudantil

API em Node.js (Express 5) que autentica os estudantes, verifica a elegibilidade, habilita a carteira
de cada estudante no contrato `Votacao` e copia os eventos `VotoRegistado` para a tabela
`logs_votacao`. **O voto nunca passa pelo backend**: é feito diretamente no contrato pela carteira do estudante.

**Privacidade:** a BD sabe quem é elegível e se já habilitou uma carteira, mas não guarda **qual**
carteira pertence a cada estudante. O endereço só existe em memória durante a habilitação e nunca é
escrito nos registos.

## 1. Instalar

```bash
cd backend
npm install
```

## 2. Configurar

Copie `.env.example` para `.env` e ajuste os valores (o ficheiro explica cada variável).
O `JWT_SEGREDO` tem de ser aleatório e ter pelo menos 32 caracteres. A `CHAVE_ADMIN` de exemplo é a
conta #0 do Hardhat: é pública e serve **só** para desenvolvimento local.

O endereço e o ABI do contrato vêm de `src/contrato/Votacao.json`, escrito pelo script de publicação
do contrato (`contrato/scripts/publicar.js`). Não edite esse ficheiro à mão. `ENDERECO_CONTRATO`,
se estiver definida, sobrepõe-se ao endereço do JSON.

## 3. Criar a base de dados (MySQL 8.4)

```bash
npm run bd:criar             # cria a BD, as tabelas e 6 estudantes de teste
npm run bd:criar -- --repor  # também anula as habilitações e esvazia logs_votacao
```

Estudantes de teste: `ana.martins`, `bruno.costa`, `carla.ferreira`, `diogo.pereira`,
`eduarda.santos` e `filipe.almeida` (não elegível), todos `@faculdade.test`, com a senha `Teste@2026`.

Use `--repor` depois de reiniciar o node do Hardhat: o node novo perde os registos das carteiras,
mas a BD continuaria a marcar os estudantes como habilitados.

## 4. Arrancar

```bash
npm run iniciar   # produção
npm run dev       # desenvolvimento (reinicia ao alterar o código)
```

O servidor arranca mesmo sem MySQL, sem node ou sem contrato publicado: regista um aviso, continua a
tentar em segundo plano e as operações afetadas devolvem 503. `GET /api/saude` mostra o estado.

## API (prefixo `/api`)

| Método e rota | Autenticação | Descrição |
|---|---|---|
| `GET /saude` | — | `{ ok, bd, blockchain: { ligado, chainId, contrato, contratoPublicado } }`. `ok` é `true` só quando está tudo operacional. |
| `POST /auth/login` | — | `{ email, senha }` → `{ token, expiraEm, estudante: { nome, habilitado } }`. Token válido por 15 minutos. Máximo de 10 tentativas falhadas por IP em 15 minutos. |
| `GET /estudante/estado` | Bearer | `{ nome, elegivel, habilitado }` |
| `POST /habilitacao` | Bearer | `{ endereco }` → 201 `{ mensagem, hashTransacao }`. Envia `VALOR_GAS_ETH` para o gás e chama `registarEleitor`. |

Os erros têm sempre o formato `{ "erro": "mensagem" }`.

`logs_votacao.data_hora` fica em **UTC** (hora do bloco).
