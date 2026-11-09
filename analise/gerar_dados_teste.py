#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gerador de dados sintéticos para o módulo de análise de anomalias.

Produz um CSV com as mesmas colunas da tabela ``logs_votacao`` do backend:
``id, endereco, id_candidato, data_hora, hash_transacao``.

O tráfego normal segue um processo de Poisson (chegadas independentes ao
longo de algumas horas) com 3 a 4 candidatos de preferências diferentes. Por
cima desse tráfego são injetados até 2 padrões suspeitos:

1. uma rajada de votos em poucos segundos, concentrada num candidato;
2. uma cadência regular ("robô") de votos, quase todos no mesmo candidato.

Todos os dados são fictícios (endereços e hashes aleatórios).

Utilização:
    python gerar_dados_teste.py --saida dados_teste.csv --semente 42
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

COLUNAS = ["id", "endereco", "id_candidato", "data_hora", "hash_transacao"]

# Início fixo e conhecido, para os resultados serem reprodutíveis.
INICIO_PADRAO = datetime(2026, 3, 10, 9, 0, 0)

# Preferências variadas (sem ser um empate nem uma vitória esmagadora).
PREFERENCIAS = [0.35, 0.28, 0.22, 0.15]


def _hex_aleatorio(rng: np.random.Generator, n_bytes: int) -> str:
    return "0x" + rng.bytes(n_bytes).hex()


def _escolher_candidatos(rng, n, n_candidatos, favorito=None, forca=0.0):
    """Escolhe candidatos segundo as preferências; se ``favorito`` for dado,
    uma fração ``forca`` dos votos vai para esse candidato."""
    prefs = np.array(PREFERENCIAS[:n_candidatos], dtype=float)
    prefs /= prefs.sum()
    ids = np.arange(1, n_candidatos + 1)
    escolhas = rng.choice(ids, size=n, p=prefs)
    if favorito is not None:
        forcar = rng.random(n) < forca
        escolhas = np.where(forcar, favorito, escolhas)
    return escolhas


def gerar_dados(
    semente: int = 42,
    votos_base: int = 450,
    horas: float = 4.0,
    n_candidatos: int = 4,
    n_padroes: int = 2,
    inicio: datetime = INICIO_PADRAO,
) -> tuple[pd.DataFrame, list[dict]]:
    """Gera os votos sintéticos.

    Devolve ``(dados, injecoes)``: o DataFrame com as colunas de ``COLUNAS`` e
    a lista dos padrões suspeitos injetados (para conferência em demonstrações).
    """
    if not 3 <= n_candidatos <= len(PREFERENCIAS):
        raise ValueError(f"O número de candidatos deve estar entre 3 e {len(PREFERENCIAS)}.")
    if n_padroes not in (0, 1, 2):
        raise ValueError("O número de padrões suspeitos deve ser 0, 1 ou 2.")

    rng = np.random.default_rng(semente)
    duracao_s = horas * 3600.0

    # --- Tráfego normal: processo de Poisson homogéneo ----------------------
    n_normais = int(rng.poisson(votos_base))
    instantes = np.sort(rng.uniform(0.0, duracao_s, n_normais))
    # A hora do bloco tem resolução de 1 segundo (DATETIME do MySQL).
    segundos = np.floor(instantes).astype(int)
    normais = pd.DataFrame(
        {
            "data_hora": pd.to_datetime(inicio) + pd.to_timedelta(segundos, unit="s"),
            "id_candidato": _escolher_candidatos(rng, n_normais, n_candidatos),
        }
    )
    partes = [normais]
    injecoes: list[dict] = []

    # --- Padrão 1: rajada em segundos, concentrada num candidato ------------
    if n_padroes >= 1:
        n_rajada = 40
        candidato = 2
        minuto = int(horas * 60 * 0.43)  # cerca de 43% do período
        t0 = pd.to_datetime(inicio) + pd.Timedelta(minutes=minuto, seconds=10)
        # Um "robô" com pausas de menos de 1 s: mesmo arredondado ao segundo
        # (resolução do DATETIME), o intervalo entre votos seguidos fica em 0 ou 1 s.
        passos = rng.uniform(0.15, 0.95, n_rajada)
        instantes_r = np.cumsum(passos) - passos[0]
        datas = t0 + pd.to_timedelta(np.floor(instantes_r).astype(int), unit="s")
        partes.append(
            pd.DataFrame(
                {
                    "data_hora": datas,
                    "id_candidato": _escolher_candidatos(
                        rng, n_rajada, n_candidatos, favorito=candidato, forca=0.9
                    ),
                }
            )
        )
        injecoes.append(
            {
                "tipo": "rajada",
                "inicio": datas[0].to_pydatetime(),
                "fim": datas[-1].to_pydatetime(),
                "n_votos": n_rajada,
                "candidato": candidato,
                "descricao": f"{n_rajada} votos em cerca de {int(instantes_r[-1])} s, ~90% no candidato {candidato}",
            }
        )

    # --- Padrão 2: cadência regular, quase tudo no mesmo candidato ----------
    if n_padroes >= 2:
        n_cadencia = 28
        candidato = 3
        minuto = 5 * round(horas * 60 * 0.78 / 5)  # alinhado a múltiplos de 5 min
        t0 = pd.to_datetime(inicio) + pd.Timedelta(minutes=minuto, seconds=5)
        passos = rng.uniform(8.0, 10.0, n_cadencia)
        instantes_c = np.cumsum(passos) - passos[0]
        datas = t0 + pd.to_timedelta(np.floor(instantes_c).astype(int), unit="s")
        partes.append(
            pd.DataFrame(
                {
                    "data_hora": datas,
                    "id_candidato": _escolher_candidatos(
                        rng, n_cadencia, n_candidatos, favorito=candidato, forca=0.95
                    ),
                }
            )
        )
        injecoes.append(
            {
                "tipo": "cadência regular",
                "inicio": datas[0].to_pydatetime(),
                "fim": datas[-1].to_pydatetime(),
                "n_votos": n_cadencia,
                "candidato": candidato,
                "descricao": (
                    f"{n_cadencia} votos com cadência quase fixa (8 a 10 s), "
                    f"~95% no candidato {candidato}"
                ),
            }
        )

    # --- Montagem final -----------------------------------------------------
    dados = pd.concat(partes, ignore_index=True)
    dados = dados.sort_values("data_hora", kind="stable").reset_index(drop=True)
    n = len(dados)
    dados["id"] = np.arange(1, n + 1)
    dados["endereco"] = [_hex_aleatorio(rng, 20) for _ in range(n)]
    dados["hash_transacao"] = [_hex_aleatorio(rng, 32) for _ in range(n)]
    dados["id_candidato"] = dados["id_candidato"].astype(int)
    dados = dados[COLUNAS]
    return dados, injecoes


def guardar_csv(dados: pd.DataFrame, caminho: Path) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    saida = dados.copy()
    saida["data_hora"] = saida["data_hora"].dt.strftime("%Y-%m-%d %H:%M:%S")
    saida.to_csv(caminho, index=False, encoding="utf-8")


def _criar_parser() -> argparse.ArgumentParser:
    pasta = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="Gera um CSV sintético de votos (formato da tabela logs_votacao) "
        "com padrões suspeitos injetados.",
    )
    parser.add_argument("--saida", type=Path, default=pasta / "dados_teste.csv",
                        help="caminho do CSV a criar (por omissão: analise/dados_teste.csv)")
    parser.add_argument("--semente", type=int, default=42, help="semente aleatória (por omissão: 42)")
    parser.add_argument("--votos", type=int, default=450,
                        help="número médio de votos normais (por omissão: 450)")
    parser.add_argument("--horas", type=float, default=4.0,
                        help="duração do período em horas (por omissão: 4)")
    parser.add_argument("--candidatos", type=int, choices=(3, 4), default=4,
                        help="número de candidatos (por omissão: 4)")
    parser.add_argument("--padroes", type=int, choices=(0, 1, 2), default=2,
                        help="número de padrões suspeitos a injetar (por omissão: 2)")
    return parser


def main() -> int:
    for fluxo in (sys.stdout, sys.stderr):
        try:
            fluxo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    args = _criar_parser().parse_args()
    if args.votos < 1 or args.horas <= 0:
        print("Erro: --votos e --horas têm de ser positivos.", file=sys.stderr)
        return 1
    dados, injecoes = gerar_dados(
        semente=args.semente,
        votos_base=args.votos,
        horas=args.horas,
        n_candidatos=args.candidatos,
        n_padroes=args.padroes,
    )
    guardar_csv(dados, args.saida)
    print(f"Gerados {len(dados)} votos sintéticos em {args.saida}")
    print(f"Período: {dados['data_hora'].min()} a {dados['data_hora'].max()}")
    if injecoes:
        print("Padrões suspeitos injetados:")
        for inj in injecoes:
            print(f"  - {inj['inicio']:%H:%M:%S} a {inj['fim']:%H:%M:%S}: {inj['descricao']}")
    else:
        print("Nenhum padrão suspeito injetado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
