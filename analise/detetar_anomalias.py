#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deteção de anomalias (Isolation Forest) nos votos de um sistema de votação em blockchain.

Lê os eventos ``VotoRegistado`` copiados pelo backend para a tabela
``logs_votacao`` (ou de um CSV / dados de demonstração), agrega-os por janelas
de tempo e assinala as janelas atípicas para revisão da comissão eleitoral.

IMPORTANTE: este módulo APENAS ALERTA. Nunca altera nem anula votos; o acesso
à base de dados é só de leitura (apenas SELECT, numa transação READ ONLY).

Utilização:
    python detetar_anomalias.py                  # lê da base de dados MySQL
    python detetar_anomalias.py --csv votos.csv  # lê de um CSV
    python detetar_anomalias.py --demo           # dados sintéticos em memória
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    import numpy as np
    import pandas as pd
    from dotenv import dotenv_values
    from sklearn.ensemble import IsolationForest
    from sklearn.preprocessing import StandardScaler
except ImportError as erro_importacao:  # pragma: no cover - depende do ambiente
    print(
        f"Erro: falta instalar uma dependência ({erro_importacao.name}).\n"
        "Ative o ambiente virtual e execute: pip install -r requirements.txt",
        file=sys.stderr,
    )
    sys.exit(1)

PASTA = Path(__file__).resolve().parent

COLUNAS = ["id", "endereco", "id_candidato", "data_hora", "hash_transacao"]
CARACTERISTICAS = [
    "n_votos",
    "intervalo_medio_s",
    "intervalo_min_s",
    "desvio_intervalos_s",
    "concentracao",
    "n_candidatos",
]

MIN_JANELAS_MODELO = 4          # abaixo disto o modelo não é executado
MIN_VOTOS_CONCENTRACAO = 5      # só falamos de concentração com votos suficientes
LIMIAR_PONTUACAO_ALTA = 0.65    # pontuação do Isolation Forest (0 a 1; > 0,5 = atípico)
LIMIAR_PONTUACAO_MEDIA = 0.57
ORDEM_GRAVIDADE = {"alta": 3, "média": 2, "baixa": 1}

AVISO = (
    "Este módulo apenas alerta para revisão da comissão eleitoral: "
    "nunca altera nem anula votos."
)


class ErroAnalise(Exception):
    """Erro esperado (BD indisponível, CSV inválido, ...) com mensagem amigável."""


# ---------------------------------------------------------------------------
# Formatação (português europeu: vírgula decimal)
# ---------------------------------------------------------------------------
def fmt(valor: float, casas: int = 1) -> str:
    return f"{valor:.{casas}f}".replace(".", ",")


def fmt_curto(valor: float) -> str:
    """Inteiro sem decimais (2), caso contrário uma casa decimal (1,5)."""
    return fmt(valor, 0) if float(valor).is_integer() else fmt(valor, 1)


def fmt_razao(razao: float) -> str:
    return f"{fmt(razao, 0)}x" if razao >= 10 else f"{fmt(razao, 1)}x"


def fmt_pct(fracao: float, casas: int = 0) -> str:
    return f"{fmt(fracao * 100, casas)}%"


def fmt_duracao(segundos: float) -> str:
    segundos = int(round(segundos))
    if segundos < 60:
        return f"{segundos} s"
    if segundos < 3600:
        minutos, resto = divmod(segundos, 60)
        return f"{minutos} min {resto} s" if resto else f"{minutos} min"
    horas, resto = divmod(segundos, 3600)
    return f"{horas} h {resto // 60} min"


def abreviar_endereco(endereco: str) -> str:
    """0x1234567890...abcd -> 0x1234…abcd (privacidade)."""
    endereco = str(endereco)
    return f"{endereco[:6]}…{endereco[-4:]}" if len(endereco) > 12 else endereco


def fmt_intervalo(inicio: pd.Timestamp, fim: pd.Timestamp, segundos: bool = False) -> str:
    formato_hora = "%H:%M:%S" if segundos else "%H:%M"
    if inicio.date() == fim.date():
        return f"{inicio:%Y-%m-%d} {inicio.strftime(formato_hora)}–{fim.strftime(formato_hora)}"
    return f"{inicio:%Y-%m-%d} {inicio.strftime(formato_hora)} – {fim:%Y-%m-%d} {fim.strftime(formato_hora)}"


# ---------------------------------------------------------------------------
# Leitura dos dados
# ---------------------------------------------------------------------------
def carregar_config_bd() -> dict:
    """Lê a configuração da BD de analise/.env ou, em alternativa, ../backend/.env."""
    candidatos = [PASTA / ".env", PASTA.parent / "backend" / ".env"]
    ficheiro = next((c for c in candidatos if c.is_file()), None)
    valores = dotenv_values(ficheiro) if ficheiro else {}

    def obter(chave: str, padrao: str) -> str:
        valor = os.environ.get(chave)
        if valor is None:
            valor = valores.get(chave)
        return padrao if valor is None else str(valor)

    try:
        porta = int(obter("DB_PORTA", "3306"))
    except ValueError:
        raise ErroAnalise("O valor de DB_PORTA no ficheiro .env não é um número válido.")
    return {
        "host": obter("DB_HOST", "127.0.0.1"),
        "porta": porta,
        "utilizador": obter("DB_UTILIZADOR", "root"),
        "senha": obter("DB_SENHA", ""),
        "nome": obter("DB_NOME", "votacao"),
        "ficheiro": ficheiro,
    }


def _mensagem_erro_mysql(erro: Exception, cfg: dict) -> str:
    codigo = erro.args[0] if erro.args and isinstance(erro.args[0], int) else None
    destino = f"{cfg['host']}:{cfg['porta']}"
    if codigo == 1045:
        causa = (f"O MySQL recusou o acesso ao utilizador '{cfg['utilizador']}'. "
                 "Verifique DB_UTILIZADOR e DB_SENHA no ficheiro .env.")
    elif codigo == 1049:
        causa = (f"A base de dados '{cfg['nome']}' não existe em {destino}. "
                 "Corra 'npm run bd:criar' na pasta do backend (ou confirme DB_NOME no .env).")
    elif codigo == 1146:
        causa = (f"Tabela inexistente: 'logs_votacao' não existe na base de dados '{cfg['nome']}'. "
                 "Corra 'npm run bd:criar' na pasta do backend.")
    else:
        causa = (f"Não foi possível ligar ao MySQL em {destino}. "
                 "Verifique se o servidor está instalado e a correr.")
    origem = f" (configuração lida de {cfg['ficheiro']})" if cfg["ficheiro"] else " (sem ficheiro .env; valores por omissão)"
    detalhe = " ".join(str(erro.args[1] if len(erro.args) > 1 else erro).split())
    return (f"{causa}{origem}\n"
            "Sugestão: para experimentar o módulo sem base de dados, use --demo "
            "(dados sintéticos) ou --csv ficheiro.csv.\n"
            f"Detalhe técnico: {detalhe}")


def ler_mysql() -> tuple[pd.DataFrame, str]:
    """Lê os votos da tabela logs_votacao (apenas SELECT, transação só de leitura)."""
    try:
        import pymysql
    except ImportError:
        raise ErroAnalise("Falta o pacote pymysql. Execute: pip install -r requirements.txt")

    cfg = carregar_config_bd()
    ligacao = None
    try:
        ligacao = pymysql.connect(
            host=cfg["host"], port=cfg["porta"], user=cfg["utilizador"],
            password=cfg["senha"], database=cfg["nome"],
            connect_timeout=5, read_timeout=60, charset="utf8mb4",
        )
        with ligacao.cursor() as cursor:
            # Garantia no servidor de que esta sessão não consegue escrever.
            cursor.execute("SET SESSION TRANSACTION READ ONLY")
            cursor.execute(
                "SELECT id, endereco, id_candidato, data_hora, hash_transacao "
                "FROM logs_votacao ORDER BY data_hora, id"
            )
            linhas = cursor.fetchall()
    except pymysql.err.MySQLError as erro:
        raise ErroAnalise(_mensagem_erro_mysql(erro, cfg))
    except OSError as erro:
        raise ErroAnalise(_mensagem_erro_mysql(erro, cfg))
    finally:
        if ligacao is not None:
            try:
                ligacao.close()
            except Exception:
                pass

    dados = pd.DataFrame(linhas, columns=COLUNAS)
    return dados, f"MySQL ({cfg['host']}:{cfg['porta']}/{cfg['nome']}, tabela logs_votacao)"


def ler_csv(caminho: Path) -> tuple[pd.DataFrame, str]:
    if not caminho.is_file():
        raise ErroAnalise(f"O ficheiro CSV '{caminho}' não existe.")
    try:
        dados = pd.read_csv(caminho, dtype={"endereco": str, "hash_transacao": str})
    except Exception as erro:
        raise ErroAnalise(f"Não foi possível ler o CSV '{caminho}': {erro}")
    return dados, f"CSV ({caminho})"


def gerar_demo(semente: int) -> tuple[pd.DataFrame, str, list[dict]]:
    from gerar_dados_teste import gerar_dados

    dados, injecoes = gerar_dados(semente=semente)
    return dados, "demonstração (dados sintéticos gerados em memória)", injecoes


def normalizar_dados(dados: pd.DataFrame) -> pd.DataFrame:
    """Valida as colunas e os tipos; devolve os votos ordenados no tempo."""
    em_falta = [c for c in COLUNAS if c not in dados.columns]
    if em_falta:
        raise ErroAnalise(
            "Faltam colunas nos dados: " + ", ".join(em_falta)
            + ". Esperado: " + ", ".join(COLUNAS) + "."
        )
    dados = dados[COLUNAS].copy()
    if dados.empty:
        return dados

    datas = pd.to_datetime(dados["data_hora"], errors="coerce")
    if getattr(datas.dt, "tz", None) is not None:
        datas = datas.dt.tz_localize(None)
    candidatos = pd.to_numeric(dados["id_candidato"], errors="coerce")
    invalidos = datas.isna() | candidatos.isna()
    if invalidos.any():
        print(f"Aviso: {int(invalidos.sum())} linha(s) com data_hora ou id_candidato inválidos foram ignoradas.",
              file=sys.stderr)
    dados = dados.assign(data_hora=datas, id_candidato=candidatos)[~invalidos].copy()
    dados["id_candidato"] = dados["id_candidato"].astype(int)
    dados = dados.sort_values(["data_hora", "id"], kind="stable").reset_index(drop=True)
    return dados


# ---------------------------------------------------------------------------
# Características por janela de tempo
# ---------------------------------------------------------------------------
def calcular_janelas(dados: pd.DataFrame, janela_min: int) -> pd.DataFrame:
    """Agrega os votos por janela (só janelas com votos) e calcula as características."""
    janela_s = janela_min * 60.0
    d = dados[["id", "id_candidato", "data_hora"]].copy()
    d["janela"] = d["data_hora"].dt.floor(f"{janela_min}min")
    # Intervalo (em segundos) para o voto anterior da mesma janela.
    d["intervalo_s"] = d.groupby("janela")["data_hora"].diff().dt.total_seconds()

    grupos = d.groupby("janela")
    janelas = grupos.agg(
        n_votos=("id", "size"),
        intervalo_medio_s=("intervalo_s", "mean"),
        intervalo_min_s=("intervalo_s", "min"),
        desvio_intervalos_s=("intervalo_s", lambda s: s.std(ddof=0)),
    )
    # Janela com um único voto: não há intervalos; usa-se a duração da janela.
    janelas["intervalo_medio_s"] = janelas["intervalo_medio_s"].fillna(janela_s)
    janelas["intervalo_min_s"] = janelas["intervalo_min_s"].fillna(janela_s)
    janelas["desvio_intervalos_s"] = janelas["desvio_intervalos_s"].fillna(0.0)

    contagens = d.groupby(["janela", "id_candidato"]).size().unstack(fill_value=0)
    janelas["concentracao"] = contagens.max(axis=1) / contagens.sum(axis=1)
    janelas["candidato_dominante"] = contagens.idxmax(axis=1).astype(int)
    janelas["n_candidatos"] = (contagens > 0).sum(axis=1)

    janelas = janelas.reset_index().rename(columns={"janela": "inicio"})
    janelas["fim"] = janelas["inicio"] + pd.Timedelta(minutes=janela_min)
    return janelas


def estatisticas_votos(votos: pd.DataFrame) -> dict:
    """Características de um conjunto de votos consecutivos (usado nas rajadas)."""
    intervalos = votos["data_hora"].diff().dt.total_seconds().dropna()
    contagem = votos["id_candidato"].value_counts().sort_index()
    dominante = int(contagem.idxmax())
    return {
        "n_votos": int(len(votos)),
        "intervalo_medio_s": float(intervalos.mean()) if len(intervalos) else None,
        "intervalo_min_s": float(intervalos.min()) if len(intervalos) else None,
        "desvio_intervalos_s": float(intervalos.std(ddof=0)) if len(intervalos) else None,
        "concentracao": float(contagem.max() / contagem.sum()),
        "candidato_dominante": dominante,
        "n_candidatos": int(len(contagem)),
        "n_enderecos": int(votos["endereco"].nunique()),
    }


# ---------------------------------------------------------------------------
# Regra simples: rajadas
# ---------------------------------------------------------------------------
def detetar_rajadas(dados: pd.DataFrame, limiar_s: float, min_votos: int) -> list[tuple[int, int]]:
    """Devolve (primeiro, último) índices de sequências de pelo menos ``min_votos``
    votos consecutivos em que cada intervalo é inferior a ``limiar_s`` segundos."""
    n = len(dados)
    if n < 2:
        return []
    intervalos = dados["data_hora"].diff().dt.total_seconds().to_numpy()
    curtos = np.nan_to_num(intervalos, nan=np.inf) < limiar_s
    rajadas = []
    i = 1
    while i < n:
        if curtos[i]:
            j = i
            while j + 1 < n and curtos[j + 1]:
                j += 1
            if (j - (i - 1) + 1) >= min_votos:
                rajadas.append((i - 1, j))
            i = j + 1
        else:
            i += 1
    return rajadas


# ---------------------------------------------------------------------------
# Modelo: Isolation Forest
# ---------------------------------------------------------------------------
CARACT_LOG = ["n_votos", "intervalo_medio_s", "intervalo_min_s", "desvio_intervalos_s"]
SINAIS_SUSPEITOS = {"ritmo_alto", "intervalos_curtos", "ritmo_regular", "concentrado"}


def matriz_modelo(janelas: pd.DataFrame) -> pd.DataFrame:
    """Características numéricas usadas pelo modelo.

    As que têm cauda longa (contagens e intervalos) passam por log(1 + x), para
    que um pico de votos e uma janela quase vazia fiquem a distâncias
    comparáveis do comportamento normal.
    """
    x = janelas[CARACTERISTICAS].astype(float).copy()
    for coluna in CARACT_LOG:
        x[coluna] = np.log1p(x[coluna])
    return x


def aplicar_modelo(janelas: pd.DataFrame, contaminacao, semente: int) -> tuple[pd.DataFrame, float]:
    """Normaliza as características e aplica o Isolation Forest.

    Acrescenta as colunas ``pontuacao`` (0 a 1; quanto maior, mais atípica) e
    ``anomala``. Devolve também o limiar de pontuação usado pelo modelo.
    """
    x = StandardScaler().fit_transform(matriz_modelo(janelas).to_numpy())
    modelo = IsolationForest(n_estimators=200, contamination=contaminacao, random_state=semente)
    modelo.fit(x)
    janelas = janelas.copy()
    janelas["pontuacao"] = -modelo.score_samples(x)
    janelas["anomala"] = modelo.predict(x) == -1
    return janelas, float(-modelo.offset_)


def referencia_robusta(janelas: pd.DataFrame) -> dict:
    """Mediana e escala robusta (MAD) de cada característica, para as explicações."""
    x = matriz_modelo(janelas)
    ref = {}
    for coluna in CARACTERISTICAS:
        serie = x[coluna]
        centro = float(serie.median())
        escala = float((serie - centro).abs().median()) * 1.4826
        if escala < 1e-9:
            escala = float(serie.std(ddof=0))
        if escala < 1e-9:
            escala = 1.0
        ref[coluna] = {"mediana": float(janelas[coluna].median()), "centro": centro, "escala": escala}
    return ref


def desvio_robusto(linha: pd.Series, ref: dict, coluna: str) -> float:
    """Quantas "escalas robustas" a janela está acima (+) ou abaixo (-) da mediana."""
    valor = float(linha[coluna])
    if coluna in CARACT_LOG:
        valor = float(np.log1p(valor))
    return (valor - ref[coluna]["centro"]) / ref[coluna]["escala"]


def explicar_janela(linha: pd.Series, ref: dict, janela_min: int, quotas: dict) -> tuple[str, set]:
    """Explica em linguagem simples porque é que a janela é atípica.

    Devolve o texto e o conjunto de "sinais" encontrados (usado na gravidade).
    """
    n = int(linha["n_votos"])
    z = {c: desvio_robusto(linha, ref, c) for c in CARACTERISTICAS}
    med = {c: ref[c]["mediana"] for c in CARACTERISTICAS}
    partes: list[str] = []
    sinais: set[str] = set()

    if z["n_votos"] >= 2 and n >= 1.5 * med["n_votos"]:
        partes.append(f"{n} votos em {janela_min} min, {fmt_razao(n / med['n_votos'])} a mediana "
                      f"({fmt(med['n_votos'], 0)})")
        sinais.add("ritmo_alto")
    elif z["n_votos"] <= -2:
        partes.append(f"apenas {n} voto{'s' if n != 1 else ''} em {janela_min} min "
                      f"(mediana {fmt(med['n_votos'], 0)})")
        sinais.add("pouca_atividade")

    if n >= 2:
        if z["intervalo_medio_s"] <= -2:
            partes.append(f"intervalo médio de {fmt(linha['intervalo_medio_s'])} s entre votos "
                          f"(mediana {fmt(med['intervalo_medio_s'])} s)")
            sinais.add("intervalos_curtos")
        elif z["intervalo_min_s"] <= -2:
            partes.append(f"votos quase simultâneos (intervalo mínimo de {fmt(linha['intervalo_min_s'], 0)} s; "
                          f"mediana das janelas {fmt(med['intervalo_min_s'], 0)} s)")
            sinais.add("intervalos_curtos")
        elif z["intervalo_medio_s"] >= 2:
            partes.append(f"intervalo médio elevado de {fmt(linha['intervalo_medio_s'])} s entre votos "
                          f"(mediana {fmt(med['intervalo_medio_s'])} s)")
            sinais.add("intervalos_longos")
    if n >= 4:
        if z["desvio_intervalos_s"] <= -2:
            partes.append(f"ritmo invulgarmente regular (desvio dos intervalos {fmt(linha['desvio_intervalos_s'])} s; "
                          f"mediana {fmt(med['desvio_intervalos_s'])} s)")
            sinais.add("ritmo_regular")
        elif z["desvio_intervalos_s"] >= 2:
            partes.append(f"ritmo muito irregular (desvio dos intervalos {fmt(linha['desvio_intervalos_s'])} s; "
                          f"mediana {fmt(med['desvio_intervalos_s'])} s)")
            sinais.add("ritmo_irregular")

    # Concentração: compara a quota do candidato dominante na janela com a sua quota total.
    if n >= MIN_VOTOS_CONCENTRACAO:
        candidato = int(linha["candidato_dominante"])
        quota = quotas.get(candidato, 0.0)
        if 0.0 < quota < 1.0 and linha["concentracao"] >= 0.5:
            votos_cand = round(float(linha["concentracao"]) * n)
            z_binomial = (votos_cand - n * quota) / np.sqrt(n * quota * (1.0 - quota))
            if z_binomial >= 3:
                partes.append(f"{fmt_pct(linha['concentracao'])} no candidato {candidato} "
                              f"(no total da votação tem {fmt_pct(quota)})")
                sinais.add("concentrado")

    if not partes:
        partes.append(f"{n} voto{'s' if n != 1 else ''} em {janela_min} min (mediana {fmt(med['n_votos'], 0)}); "
                      "combinação pouco habitual das características, nenhuma isolada fora do normal")
    texto = "; ".join(partes)
    return texto[0].upper() + texto[1:], sinais


def explicar_rajada(est: dict, duracao_s: float, limiar_s: float, ritmo_habitual: float | None,
                    enderecos: list[str], quotas: dict) -> str:
    n = est["n_votos"]
    partes = [f"{n} votos em {fmt_duracao(duracao_s)} (intervalo médio de {fmt(est['intervalo_medio_s'])} s, "
              f"abaixo do limiar de {fmt_curto(limiar_s)} s)"]
    if ritmo_habitual and ritmo_habitual > 0:
        razao = n / max(duracao_s, 1.0) * 60.0 / ritmo_habitual
        if razao >= 2:
            partes.append(f"ritmo {fmt_razao(razao)} o habitual")
    if n >= MIN_VOTOS_CONCENTRACAO and est["concentracao"] >= 0.5:
        candidato = est["candidato_dominante"]
        total = f" (no total da votação tem {fmt_pct(quotas[candidato])})" if candidato in quotas else ""
        partes.append(f"{fmt_pct(est['concentracao'])} no candidato {candidato}{total}")
    if est["n_enderecos"] <= 3:
        partes.append(f"apenas {est['n_enderecos']} endereço(s): " + ", ".join(abreviar_endereco(e) for e in enderecos))
    else:
        partes.append(f"{est['n_enderecos']} endereços distintos")
    return "; ".join(partes)


# ---------------------------------------------------------------------------
# Construção dos alertas
# ---------------------------------------------------------------------------
def gravidade_pontuacao(pontuacao: float) -> str:
    if pontuacao >= LIMIAR_PONTUACAO_ALTA:
        return "alta"
    if pontuacao >= LIMIAR_PONTUACAO_MEDIA:
        return "média"
    return "baixa"


def gravidade_rajada(est: dict, min_votos: int) -> str:
    if est["n_votos"] >= 3 * min_votos or (est["n_votos"] >= 2 * min_votos and est["concentracao"] >= 0.8):
        return "alta"
    return "média"


def _numero(valor, casas: int = 3):
    if valor is None or (isinstance(valor, float) and np.isnan(valor)):
        return None
    return round(float(valor), casas)


def construir_alertas(dados: pd.DataFrame, janelas: pd.DataFrame, rajadas: list[tuple[int, int]],
                      janela_min: int, limiar_rajada: float, min_rajada: int,
                      modelo_executado: bool) -> list[dict]:
    alertas: list[dict] = []
    ritmo_habitual = None
    if len(janelas):
        ritmo_habitual = float(janelas["n_votos"].median()) / janela_min  # votos por minuto
    quotas = {int(c): float(q) for c, q in dados["id_candidato"].value_counts(normalize=True).items()}

    # Rajadas (regra simples) -------------------------------------------------
    intervalos_rajadas = []
    for primeiro, ultimo in rajadas:
        votos = dados.iloc[primeiro:ultimo + 1]
        est = estatisticas_votos(votos)
        inicio, fim = votos["data_hora"].iloc[0], votos["data_hora"].iloc[-1]
        duracao = (fim - inicio).total_seconds()
        intervalos_rajadas.append((inicio, fim, est["n_votos"]))
        alertas.append({
            "tipo": "rajada",
            "gravidade": gravidade_rajada(est, min_rajada),
            "inicio": inicio, "fim": fim,
            "n_votos": est["n_votos"],
            "intervalo_medio_s": _numero(est["intervalo_medio_s"]),
            "intervalo_min_s": _numero(est["intervalo_min_s"]),
            "desvio_intervalos_s": _numero(est["desvio_intervalos_s"]),
            "concentracao": _numero(est["concentracao"]),
            "candidato_dominante": est["candidato_dominante"],
            "n_candidatos": est["n_candidatos"],
            "n_enderecos": est["n_enderecos"],
            "pontuacao": None,
            "explicacao": explicar_rajada(est, duracao, limiar_rajada, ritmo_habitual,
                                          votos["endereco"].drop_duplicates().tolist()[:3], quotas),
        })

    # Janelas assinaladas pelo Isolation Forest -------------------------------
    if modelo_executado:
        ref = referencia_robusta(janelas)
        n_por_janela = dados.groupby(dados["data_hora"].dt.floor(f"{janela_min}min"))["endereco"].nunique()
        for _, linha in janelas[janelas["anomala"]].iterrows():
            sobrepostas = [r for r in intervalos_rajadas if r[0] < linha["fim"] and r[1] >= linha["inicio"]]
            explicacao, sinais = explicar_janela(linha, ref, janela_min, quotas)
            gravidade = gravidade_pontuacao(linha["pontuacao"])
            quieta = bool(sinais & {"pouca_atividade", "intervalos_longos"}) and not (sinais & SINAIS_SUSPEITOS)
            if sobrepostas:
                maior = max(r[2] for r in sobrepostas)
                explicacao += f"; confirmado pela regra das rajadas (sequência de {maior} votos nesta janela)"
                gravidade = "alta"
            elif not sinais:
                # Nenhuma característica isolada fora do normal: só informativo.
                gravidade = "baixa"
            elif quieta:
                # Pouca atividade é atípica, mas por si só não indica manipulação.
                gravidade = {"alta": "média", "média": "baixa", "baixa": "baixa"}[gravidade]
                explicacao += "; pouca atividade, pode ser apenas uma pausa na votação (a confirmar)"
            alertas.append({
                "tipo": "janela_modelo",
                "gravidade": gravidade,
                "inicio": linha["inicio"], "fim": linha["fim"],
                "n_votos": int(linha["n_votos"]),
                "intervalo_medio_s": _numero(linha["intervalo_medio_s"]),
                "intervalo_min_s": _numero(linha["intervalo_min_s"]),
                "desvio_intervalos_s": _numero(linha["desvio_intervalos_s"]),
                "concentracao": _numero(linha["concentracao"]),
                "candidato_dominante": int(linha["candidato_dominante"]),
                "n_candidatos": int(linha["n_candidatos"]),
                "n_enderecos": int(n_por_janela.get(linha["inicio"], 0)),
                "pontuacao": _numero(linha["pontuacao"]),
                "explicacao": explicacao,
            })

    alertas.sort(key=lambda a: (-ORDEM_GRAVIDADE[a["gravidade"]],
                                -(a["pontuacao"] or 0.0), -a["n_votos"], a["inicio"]))
    return alertas


# ---------------------------------------------------------------------------
# Saída: consola e relatórios
# ---------------------------------------------------------------------------
def resumir_dados(dados: pd.DataFrame, janelas: pd.DataFrame) -> dict:
    por_candidato = dados["id_candidato"].value_counts().sort_index()
    return {
        "total_votos": int(len(dados)),
        "enderecos_distintos": int(dados["endereco"].nunique()),
        "periodo_inicio": dados["data_hora"].min() if len(dados) else None,
        "periodo_fim": dados["data_hora"].max() if len(dados) else None,
        "janelas_com_votos": int(len(janelas)),
        "mediana_votos_por_janela": float(janelas["n_votos"].median()) if len(janelas) else None,
        "votos_por_candidato": {int(c): int(n) for c, n in por_candidato.items()},
    }


def imprimir_resumo(resumo: dict, alertas: list[dict], fonte: str, args, modelo_info: dict,
                    injecoes: list[dict] | None) -> None:
    linha = "=" * 72
    print(linha)
    print("ANÁLISE DE ANOMALIAS - VOTAÇÃO ELETRÓNICA")
    print(linha)
    print(f"Fonte: {fonte}")
    print(f"Parâmetros: janela={args.janela} min | contaminação={args.contaminacao_texto} | "
          f"semente={args.semente} | limiar de rajada={fmt_curto(args.limiar_rajada)} s "
          f"(mín. {args.min_rajada} votos)")
    print()
    print("RESUMO")
    total = resumo["total_votos"]
    print(f"  Total de votos: {total}  ({resumo['enderecos_distintos']} endereços distintos)")
    if not total:
        print("  Ainda não há votos registados nesta fonte de dados.")
    else:
        ini, fim = resumo["periodo_inicio"], resumo["periodo_fim"]
        print(f"  Período: {ini:%Y-%m-%d %H:%M:%S} a {fim:%Y-%m-%d %H:%M:%S} ({fmt_duracao((fim - ini).total_seconds())})")
        print(f"  Janelas de {args.janela} min com votos: {resumo['janelas_com_votos']} "
              f"(mediana: {fmt(resumo['mediana_votos_por_janela'], 0)} votos por janela)")
        print("  Votos por candidato:")
        for candidato, n in resumo["votos_por_candidato"].items():
            print(f"    Candidato {candidato}: {n:>4}  ({fmt_pct(n / total, 1)})")
    print()
    if injecoes:
        print("PADRÕES INJETADOS NA DEMONSTRAÇÃO (para conferência)")
        for inj in injecoes:
            print(f"  - {inj['inicio']:%H:%M:%S} a {inj['fim']:%H:%M:%S}: {inj['descricao']}")
        print()

    if not modelo_info["executado"]:
        print("MODELO (Isolation Forest)")
        print(f"  DADOS INSUFICIENTES PARA O MODELO: {modelo_info['motivo']}")
        print("  O modelo não foi executado; abaixo constam apenas as regras simples (rajadas).")
        print()
    else:
        print(f"MODELO (Isolation Forest): {resumo['janelas_com_votos']} janelas analisadas, "
              f"pontuação-limite {fmt(modelo_info['limiar'], 2)} (quanto mais perto de 1, mais atípica).")
        print()

    print(f"ALERTAS ({len(alertas)}), por ordem de gravidade")
    if not alertas:
        print("  Nenhum alerta. Não foram encontrados padrões atípicos.")
    for i, a in enumerate(alertas, start=1):
        grav = a["gravidade"].upper()
        if a["tipo"] == "rajada":
            quando = fmt_intervalo(a["inicio"], a["fim"], segundos=True)
            print(f" {i:>2}. [{grav}] Rajada de votos | {quando}")
        else:
            quando = fmt_intervalo(a["inicio"], a["fim"])
            print(f" {i:>2}. [{grav}] Janela atípica (modelo) | {quando} | pontuação {fmt(a['pontuacao'], 2)}")
        print(f"      {a['explicacao']}")
    print()
    print(AVISO)


def guardar_relatorios(pasta: Path, alertas: list[dict], resumo: dict, fonte: str, args,
                       modelo_info: dict) -> tuple[Path, Path]:
    pasta.mkdir(parents=True, exist_ok=True)
    agora = datetime.now()
    base = pasta / f"anomalias_{agora:%Y%m%d_%H%M%S}"
    colunas = ["gravidade", "tipo", "inicio", "fim", "n_votos", "intervalo_medio_s", "intervalo_min_s",
               "desvio_intervalos_s", "concentracao", "candidato_dominante", "n_candidatos", "n_enderecos",
               "pontuacao", "explicacao"]

    def como_texto(valor):
        return valor.strftime("%Y-%m-%d %H:%M:%S") if isinstance(valor, (pd.Timestamp, datetime)) else valor

    linhas = [{c: como_texto(a[c]) for c in colunas} for a in alertas]
    caminho_csv = base.with_suffix(".csv")
    pd.DataFrame(linhas, columns=colunas).to_csv(caminho_csv, index=False, encoding="utf-8-sig")

    conteudo = {
        "gerado_em": agora.strftime("%Y-%m-%d %H:%M:%S"),
        "aviso": AVISO,
        "fonte": fonte,
        "parametros": {
            "janela_min": args.janela,
            "contaminacao": args.contaminacao_texto,
            "semente": args.semente,
            "limiar_rajada_s": args.limiar_rajada,
            "min_votos_rajada": args.min_rajada,
        },
        "resumo": {
            "total_votos": resumo["total_votos"],
            "enderecos_distintos": resumo["enderecos_distintos"],
            "periodo_inicio": como_texto(resumo["periodo_inicio"]),
            "periodo_fim": como_texto(resumo["periodo_fim"]),
            "janelas_com_votos": resumo["janelas_com_votos"],
            "votos_por_candidato": {str(c): n for c, n in resumo["votos_por_candidato"].items()},
            "modelo_executado": modelo_info["executado"],
            "motivo_modelo_nao_executado": modelo_info["motivo"],
            "pontuacao_limite_modelo": _numero(modelo_info["limiar"]),
            "n_alertas": len(alertas),
        },
        "alertas": linhas,
    }
    caminho_json = base.with_suffix(".json")
    caminho_json.write_text(json.dumps(conteudo, ensure_ascii=False, indent=2), encoding="utf-8")
    return caminho_csv, caminho_json


# ---------------------------------------------------------------------------
# Linha de comandos
# ---------------------------------------------------------------------------
def _contaminacao(texto: str):
    if texto.strip().lower() == "auto":
        return "auto"
    try:
        valor = float(texto.replace(",", "."))
    except ValueError:
        raise argparse.ArgumentTypeError("use 'auto' ou um número entre 0 e 0.5")
    if not 0.0 < valor <= 0.5:
        raise argparse.ArgumentTypeError("a contaminação tem de estar entre 0 (exclusivo) e 0.5")
    return valor


def _inteiro_positivo(texto: str) -> int:
    try:
        valor = int(texto)
    except ValueError:
        raise argparse.ArgumentTypeError("tem de ser um número inteiro")
    if valor < 1:
        raise argparse.ArgumentTypeError("tem de ser maior ou igual a 1")
    return valor


def _numero_positivo(texto: str) -> float:
    try:
        valor = float(texto.replace(",", "."))
    except ValueError:
        raise argparse.ArgumentTypeError("tem de ser um número")
    if valor <= 0:
        raise argparse.ArgumentTypeError("tem de ser maior que 0")
    return valor


def criar_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Deteta janelas de votação atípicas com Isolation Forest e regras simples (rajadas). "
        "Apenas alerta: nunca altera nem anula votos.",
        epilog="Sem --csv nem --demo, os votos são lidos da tabela logs_votacao do MySQL "
        "(configuração em analise/.env ou ../backend/.env).",
    )
    fonte = parser.add_mutually_exclusive_group()
    fonte.add_argument("--csv", type=Path, metavar="CAMINHO",
                       help="ler os votos de um CSV com as colunas da tabela logs_votacao")
    fonte.add_argument("--demo", action="store_true",
                       help="usar dados sintéticos gerados em memória (com padrões suspeitos injetados)")
    parser.add_argument("--janela", type=_inteiro_positivo, default=5, metavar="MIN",
                        help="tamanho da janela de tempo em minutos (por omissão: 5)")
    parser.add_argument("--contaminacao", type=_contaminacao, default="auto", metavar="auto|0-0.5",
                        help="fração esperada de janelas anómalas: 'auto' ou um número entre 0 e 0.5 "
                        "(por omissão: auto)")
    parser.add_argument("--semente", type=int, default=42, help="semente aleatória (por omissão: 42)")
    parser.add_argument("--saida", type=Path, default=PASTA / "relatorios", metavar="PASTA",
                        help="pasta dos relatórios (por omissão: analise/relatorios)")
    parser.add_argument("--limiar-rajada", type=_numero_positivo, default=2.0, metavar="SEGUNDOS",
                        help="intervalo (s) abaixo do qual dois votos seguidos contam para uma rajada "
                        "(por omissão: 2)")
    parser.add_argument("--min-rajada", type=_inteiro_positivo, default=5, metavar="N",
                        help="número mínimo de votos seguidos para considerar uma rajada (por omissão: 5)")
    return parser


def executar(args) -> int:
    injecoes = None
    if args.demo:
        dados, fonte, injecoes = gerar_demo(args.semente)
    elif args.csv is not None:
        dados, fonte = ler_csv(args.csv)
    else:
        dados, fonte = ler_mysql()
    dados = normalizar_dados(dados)

    janelas = calcular_janelas(dados, args.janela) if len(dados) else pd.DataFrame(columns=["n_votos"])
    resumo = resumir_dados(dados, janelas)

    modelo_info = {"executado": False, "motivo": None, "limiar": None}
    if len(dados) == 0:
        modelo_info["motivo"] = "não há votos registados."
    elif len(janelas) < MIN_JANELAS_MODELO:
        modelo_info["motivo"] = (f"só existem {len(janelas)} janela(s) com votos "
                                 f"(mínimo: {MIN_JANELAS_MODELO}).")
    else:
        janelas, limiar = aplicar_modelo(janelas, args.contaminacao, args.semente)
        modelo_info.update(executado=True, limiar=limiar)

    rajadas = detetar_rajadas(dados, args.limiar_rajada, args.min_rajada)
    alertas = construir_alertas(dados, janelas, rajadas, args.janela, args.limiar_rajada,
                                args.min_rajada, modelo_info["executado"])

    imprimir_resumo(resumo, alertas, fonte, args, modelo_info, injecoes)
    caminho_csv, caminho_json = guardar_relatorios(args.saida, alertas, resumo, fonte, args, modelo_info)
    print(f"\nRelatórios guardados em:\n  {caminho_csv}\n  {caminho_json}")
    return 0


def main(argv: list[str] | None = None) -> int:
    for fluxo in (sys.stdout, sys.stderr):
        try:
            fluxo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    args = criar_parser().parse_args(argv)
    args.contaminacao_texto = args.contaminacao if args.contaminacao == "auto" else str(args.contaminacao)
    try:
        return executar(args)
    except ErroAnalise as erro:
        print(f"\nErro: {erro}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nInterrompido pelo utilizador.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
