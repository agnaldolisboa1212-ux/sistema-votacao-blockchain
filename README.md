# Sistema de Votação Eletrónica em Blockchain

Eleições estudantis pela internet com cada voto registado num contrato inteligente em Ethereum.
Só votam carteiras habilitadas, cada carteira vota uma única vez e qualquer pessoa pode auditar o resultado.
O desenho segue uma especificação própria: arquitetura em camadas, contrato `Votacao`, modelo de dados e limitações assumidas, resumidas abaixo.

```
contrato/   Contrato Votacao (Solidity) + Hardhat: testes, publicação e tarefas de administração
backend/    API REST (Node.js + Express + MySQL): login, habilitação e cópia dos eventos de voto
frontend/   Interface web (React + Vite + Web3Auth): Habilitar, Votar e Administração
analise/    Deteção de anomalias (Python + Isolation Forest) sobre logs_votacao
scripts/    Arranque e paragem do MySQL portátil
```

Princípio de desenho: **o voto nunca passa pelo backend.** O backend só participa na habilitação.
Na votação, a carteira do eleitor assina a transação e envia-a diretamente ao contrato.

## Requisitos instalados nesta máquina

| Ferramenta | Versão | Onde |
|---|---|---|
| Node.js / npm | 24 / 11 | sistema |
| Python | 3.14 | sistema; venv em `analise/.venv` |
| MySQL Community Server (portátil, sem serviço) | 8.4.9 LTS | `E:\mysql` (dados em `E:\mysql\data`) |

O MySQL escuta só em `127.0.0.1:3306`, com o utilizador `root` **sem senha** (configuração de desenvolvimento, igual ao WAMP).
Como não está instalado como serviço, tem de ser arrancado depois de cada reinício do computador:

```bash
powershell -ExecutionPolicy Bypass -File scripts/iniciar-mysql.ps1
```

Para o parar: `scripts/parar-mysql.ps1`.

> O disco C: tem pouco espaço. Para instalar dependências npm, use a cache no E::
> `npm_config_cache=E:/npm-cache npm install` (Git Bash) ou `$env:npm_config_cache='E:\npm-cache'; npm install` (PowerShell).

## Arranque em desenvolvimento (rede local Hardhat)

Use um terminal por processo, por esta ordem.

1. **MySQL**: `scripts/iniciar-mysql.ps1`.
2. **Blockchain local**: `cd contrato && npx hardhat node`. A rede usa o identificador 31337 e escuta em 127.0.0.1:8545, com contas de teste já carregadas de ETH fictício. O estado perde-se ao reiniciar.
3. **Publicar o contrato e preparar a eleição** (noutro terminal):
   ```bash
   cd contrato
   npx hardhat run scripts/publicar.js --network localhost
   npx hardhat run scripts/preparar-demo.js --network localhost
   ```
   `publicar.js` escreve o endereço e o ABI em `backend/src/contrato/Votacao.json` e `frontend/src/contrato/Votacao.json`.
   É preciso repetir este passo sempre que o `hardhat node` é reiniciado.
4. **Base de dados** (só na primeira vez): `cd backend && npm run bd:criar`.
5. **Backend**: `cd backend && npm run dev`. Arranca em http://localhost:3001.
6. **Frontend**: `cd frontend && npm run dev`. Abre em http://localhost:5173.

### Administração da eleição

O painel `/admin` usa o MetaMask com a conta #0 do Hardhat, que publicou o contrato.
Em alternativa, pela linha de comandos:

```bash
cd contrato
npx hardhat estado --network localhost
npx hardhat candidato --nome "Lista D" --network localhost   # só com a votação fechada
npx hardhat abrir --network localhost
npx hardhat fechar --network localhost
```

### Fluxo de uma votação

1. **Habilitar** (`/habilitar`): o estudante entra com o email e a senha da faculdade e cria a carteira.
   O backend marca-o como habilitado, envia ETH para o gás e regista a carteira no contrato.
   Os estudantes de teste e a senha estão em `backend/scripts/criar-bd.js`.
2. **Votar** (`/votar`): sem login nem email. O estudante liga a carteira, escolhe o candidato e assina.
   As contagens ficam escondidas na interface enquanto a votação está aberta, mas continuam públicas na blockchain.
3. **Fechar**: o administrador fecha a votação e a interface passa a mostrar os resultados.
4. **Auditoria**: o backend copia os eventos `VotoRegistado` para `logs_votacao`. Depois:
   ```bash
   analise/.venv/Scripts/python.exe analise/detetar_anomalias.py
   ```
   Há também `--demo` (dados sintéticos com padrões suspeitos injetados), `--csv ficheiro.csv`,
   `--janela 10` e `--contaminacao 0.05`, este último para menos alertas de gravidade baixa. Ver `analise/README.md`.
   O módulo apenas alerta: liga-se ao MySQL em modo só de leitura e nunca altera votos.

### Repor a demonstração

Depois de reiniciar o `hardhat node`, a blockchain fica vazia, mas a BD continua a marcar os estudantes como habilitados. Para repor tudo:

```bash
cd contrato
npx hardhat run scripts/publicar.js --network localhost
ABRIR_VOTACAO=true npx hardhat run scripts/preparar-demo.js --network localhost
cd ../backend && npm run bd:criar -- --repor
```

O backend deteta sozinho o contrato novo, sem ser preciso reiniciá-lo.

### Web3Auth

Sem `VITE_WEB3AUTH_CLIENT_ID` em `frontend/.env.local`, o frontend usa uma **carteira de desenvolvimento**
gerada no browser e identificada com um selo visível. Para usar o Web3Auth real:

1. Crie um projeto em https://dashboard.web3auth.io e ative a exportação da chave privada.
2. Ponha o Client ID em `VITE_WEB3AUTH_CLIENT_ID`.
3. Com `VITE_REDE_LOCAL=true`, a assinatura é feita na própria página com a chave exportada,
   porque o Chrome bloqueia o acesso do site do Web3Auth à rede local.
   Com a Sepolia, ponha `VITE_REDE_LOCAL=false` para usar o fornecedor normal.

## Testes do contrato

```bash
cd contrato && npx hardhat test
```

Os 8 testes cobrem as permissões do administrador, a adição de candidatos só com a votação fechada,
o registo de eleitores e as quatro condições de `votar`: votação aberta, carteira registada, carteira que ainda não votou e candidato existente.

## Demonstração na Sepolia

1. Preencha `contrato/.env` a partir de `.env.example` (RPC e chave da conta administradora com ETH de teste).
2. Corra `npx hardhat run scripts/publicar.js --network sepolia`.
3. No backend, aponte `RPC_URL` e `CHAVE_ADMIN` para a Sepolia.
4. No frontend, ponha `VITE_REDE_LOCAL=false`.

## Limitações assumidas

Detalhadas na secção 8 da especificação:

- **Pseudonimato, não anonimato total**: o voto fica associado a um endereço público.
- **Resultados parciais legíveis**: estão visíveis na blockchain durante a votação. Mitigação futura: esquema commit-reveal.
- **Ponto único de confiança**: o backend e a conta administradora concentram a habilitação e o envio de gás.
- **Correlação temporal**: a hora da habilitação pode ser cruzada com a hora do voto. Mitigação: habilitar em lote antes de abrir a votação.
- **Eleições reais**: exigem uma auditoria externa do contrato e uma avaliação formal do risco.
