# Módulo de análise: deteção de anomalias nos votos

Analisa os votos registados (tabela `logs_votacao`, copiada pelo backend a partir dos eventos `VotoRegistado` do contrato) e **assinala janelas de tempo atípicas** com um *Isolation Forest*, além de duas regras simples e explicáveis (rajadas de votos).

> **O módulo apenas alerta.** Nunca altera nem anula votos: o acesso à base de dados é só de leitura (apenas `SELECT`, numa transação `READ ONLY`). A decisão sobre cada alerta é da comissão eleitoral.

## Instalação

Requer Python 3.10 ou superior.

```powershell
cd analise
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

(No Linux/macOS: `source .venv/bin/activate` e `pip install -r requirements.txt`.)

## Utilização

Escolha **uma** fonte de dados (são mutuamente exclusivas):

```powershell
# 1. Base de dados MySQL (por omissão)
.venv\Scripts\python.exe detetar_anomalias.py

# 2. Ficheiro CSV (mesmas colunas da tabela: id, endereco, id_candidato, data_hora, hash_transacao)
.venv\Scripts\python.exe gerar_dados_teste.py --saida dados_teste.csv   # gera um CSV sintético
.venv\Scripts\python.exe detetar_anomalias.py --csv dados_teste.csv

# 3. Demonstração: dados sintéticos em memória, com padrões suspeitos injetados
.venv\Scripts\python.exe detetar_anomalias.py --demo
```

### Configuração da base de dados

Copie `.env.example` para `.env` e ajuste (`DB_HOST`, `DB_PORTA`, `DB_UTILIZADOR`, `DB_SENHA`, `DB_NOME`). Se `analise/.env` não existir, é usado `../backend/.env` (mesmas chaves). Variáveis de ambiente com o mesmo nome têm prioridade sobre os ficheiros. Se a base de dados não estiver disponível, o programa explica o problema e sugere `--demo`; termina com código diferente de 0 apenas em caso de erro (com alertas, termina com 0).

### Opções

| Opção | Por omissão | Descrição |
|---|---|---|
| `--janela MIN` | `5` | Tamanho da janela de tempo, em minutos |
| `--contaminacao` | `auto` | Fração esperada de janelas anómalas: `auto` ou um número entre 0 e 0.5 (por exemplo `0.05` para assinalar no máximo cerca de 5% das janelas) |
| `--semente` | `42` | Semente aleatória (resultados reprodutíveis) |
| `--saida PASTA` | `relatorios/` | Pasta dos relatórios |
| `--limiar-rajada S` | `2` | Intervalo (segundos) abaixo do qual dois votos seguidos contam para uma rajada |
| `--min-rajada N` | `5` | Número mínimo de votos seguidos para ser rajada |

## O que é produzido

- Resumo na consola: total de votos, período, votos por candidato e alertas por ordem de gravidade (alta, média, baixa), cada um com uma explicação em linguagem simples.
- `relatorios/anomalias_AAAAMMDD_HHMMSS.csv` e `.json` com os mesmos alertas.
- Nos relatórios por janela não há endereços; onde aparecem na consola, são abreviados (`0x1234…abcd`).

Com menos de 4 janelas com votos, o modelo não é executado (mensagem "dados insuficientes para o modelo"), mas o resumo e as regras simples continuam a ser mostrados.

## Características por janela de tempo

| Característica | Significado |
|---|---|
| `n_votos` | Número de votos na janela |
| `intervalo_medio_s` | Intervalo médio, em segundos, entre votos seguidos da janela |
| `intervalo_min_s` | Menor intervalo entre dois votos seguidos da janela |
| `desvio_intervalos_s` | Desvio-padrão dos intervalos: valores muito baixos indicam um ritmo "de robô", demasiado regular |
| `concentracao` | Fração dos votos da janela que foi para o candidato mais votado nessa janela |
| `candidato_dominante` | Esse candidato (informativo, não entra no modelo) |
| `n_candidatos` | Número de candidatos diferentes com votos na janela |

Uma janela com um só voto não tem intervalos: usa-se a duração da janela como intervalo e 0 como desvio. As janelas sem votos não são analisadas. As características são normalizadas (as contagens e os intervalos passam antes por `log(1+x)`) antes do Isolation Forest. A **pontuação** vai de 0 a 1: quanto mais perto de 1, mais atípica é a janela (acima de 0,5 é considerada atípica com `--contaminacao auto`).

## Regras simples (rajadas)

Uma **rajada** é uma sequência de pelo menos `--min-rajada` votos seguidos em que cada intervalo é inferior a `--limiar-rajada` segundos. Ao contrário do modelo, a regra é independente da janela e não depende de haver dados suficientes. Uma janela do modelo que contenha uma rajada é marcada com gravidade alta.

Notas:

- A hora de cada voto tem a resolução de 1 segundo (`DATETIME`) e vários votos podem pertencer ao mesmo bloco; em eleições muito concorridas, ajuste `--limiar-rajada` e `--min-rajada`.
- Janelas com pouca atividade também são atípicas, mas só baixam a gravidade (podem ser apenas uma pausa na votação).

## Ficheiros

- `detetar_anomalias.py`: o programa principal.
- `gerar_dados_teste.py`: gera um CSV sintético (chegadas de Poisson, 4 candidatos, uma rajada e uma cadência regular injetadas). Opções: `--saida`, `--semente`, `--votos`, `--horas`, `--candidatos`, `--padroes`.
- `requirements.txt`, `.env.example`, `.gitignore`.
