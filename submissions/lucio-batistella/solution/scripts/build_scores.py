"""
Motor de scoring do Lead Scorer.

Le os CSVs brutos do CRM, calcula um Priority Score explicavel para cada
oportunidade ABERTA (Prospecting/Engaging) e escreve solution/frontend/deals.json,
que e o unico arquivo que o frontend estatico consome.

Uso:
    python build_scores.py

Sem dependencias externas (so biblioteca padrao) -- roda em qualquer
Python 3.9+ sem instalar nada.
"""

from __future__ import annotations

import csv
import json
import statistics
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
OUT_PATH = Path(__file__).resolve().parents[1] / "frontend" / "deals.json"

OPEN_STAGES = {"Prospecting", "Engaging"}
CLOSED_STAGES = {"Won", "Lost"}

# Peso de cada fator categorico na correcao da probabilidade de vitoria,
# e o "k" do encolhimento (shrinkage) por tamanho de amostra: quanto mais
# historico aquele vendedor/produto/setor tem, mais confiamos no desvio
# dele em relacao a media geral. Ver README > "Como o score funciona".
AGENT_WEIGHT, AGENT_K = 0.5, 30
PRODUCT_WEIGHT, PRODUCT_K = 0.3, 50
SECTOR_WEIGHT, SECTOR_K = 0.2, 50


def parse_date(s: str) -> date | None:
    if not s:
        return None
    return datetime.strptime(s, "%Y-%m-%d").date()


@dataclass
class HistoricalStats:
    baseline_rate: float
    won_day_median: float
    lost_day_median: float
    agent_rate: dict[str, tuple[float, int]]      # sales_agent -> (win_rate, n)
    product_rate: dict[str, tuple[float, int]]    # product -> (win_rate, n)
    sector_rate: dict[str, tuple[float, int]]      # sector -> (win_rate, n)
    product_avg_value: dict[str, float]           # product -> avg close_value quando Won


@dataclass
class ScoreBreakdown:
    estimated_value: float
    win_probability: float
    baseline_rate: float
    agent_delta: float
    product_delta: float
    sector_delta: float
    momentum_multiplier: float
    momentum_label: str
    confidence: str
    expected_value: float
    priority_score: int  # 0-100, percentil do expected_value entre todos os deals abertos


def load_rows(name: str) -> list[dict]:
    with open(DATA_DIR / name, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def rate_by(rows: list[dict], closed: list[dict], key_fn) -> dict[str, tuple[float, int]]:
    buckets: dict[str, list[int]] = {}
    for r in closed:
        k = key_fn(r)
        buckets.setdefault(k, []).append(1 if r["deal_stage"] == "Won" else 0)
    return {k: (sum(v) / len(v), len(v)) for k, v in buckets.items()}


def compute_stats(pipeline: list[dict], accounts: dict[str, dict], teams: dict[str, dict]) -> HistoricalStats:
    closed = [r for r in pipeline if r["deal_stage"] in CLOSED_STAGES]
    baseline = sum(1 for r in closed if r["deal_stage"] == "Won") / len(closed)

    def sector_of(r: dict) -> str:
        a = accounts.get(r["account"])
        return a["sector"] if a else "unknown"

    agent_rate = rate_by(pipeline, closed, lambda r: r["sales_agent"])
    product_rate = rate_by(pipeline, closed, lambda r: r["product"])
    sector_rate = rate_by(pipeline, closed, sector_of)

    won = [r for r in closed if r["deal_stage"] == "Won"]
    lost = [r for r in closed if r["deal_stage"] == "Lost"]

    def cycle_days(r: dict) -> int | None:
        e, c = parse_date(r["engage_date"]), parse_date(r["close_date"])
        return (c - e).days if e and c else None

    won_days = [d for d in (cycle_days(r) for r in won) if d is not None]
    lost_days = [d for d in (cycle_days(r) for r in lost) if d is not None]

    product_value: dict[str, list[float]] = {}
    for r in won:
        if r["close_value"]:
            product_value.setdefault(r["product"], []).append(float(r["close_value"]))
    product_avg_value = {k: statistics.mean(v) for k, v in product_value.items()}

    return HistoricalStats(
        baseline_rate=baseline,
        won_day_median=statistics.median(won_days),
        lost_day_median=statistics.median(lost_days),
        agent_rate=agent_rate,
        product_rate=product_rate,
        sector_rate=sector_rate,
        product_avg_value=product_avg_value,
    )


def shrink(raw_rate: float, n: int, baseline: float, k: float) -> float:
    """Credibility shrinkage: poucas amostras -> puxa pra media geral."""
    weight = n / (n + k)
    return baseline + (raw_rate - baseline) * weight


def momentum(deal_stage: str, engage_date: date | None, today: date, stats: HistoricalStats) -> tuple[float, str]:
    if deal_stage == "Prospecting" or engage_date is None:
        return 1.0, "sem histórico de tempo (deal ainda não avançou para Engaging)"

    age = (today - engage_date).days
    if age <= stats.lost_day_median:
        return 1.0, f"recente ({age}d) — ainda dentro da janela em que a maioria dos deals perdidos já teria caído"
    if age <= stats.won_day_median:
        return 1.10, f"{age}d no funil — já passou do ponto em que deals perdidos costumam cair (mediana de perda: {stats.lost_day_median:.0f}d); sinal de tração real"
    if age <= 2 * stats.won_day_median:
        return 1.05, f"{age}d no funil — acima da mediana de vitória ({stats.won_day_median:.0f}d), mas ainda em faixa plausível"
    return 0.90, f"{age}d no funil — bem acima da mediana de vitória ({stats.won_day_median:.0f}d); risco de estagnação, vale um follow-up"


def score_deal(row: dict, stats: HistoricalStats, accounts: dict[str, dict], today: date) -> ScoreBreakdown:
    account = accounts.get(row["account"])
    sector = account["sector"] if account else None

    a_rate, a_n = stats.agent_rate.get(row["sales_agent"], (stats.baseline_rate, 0))
    p_rate, p_n = stats.product_rate.get(row["product"], (stats.baseline_rate, 0))
    s_rate, s_n = stats.sector_rate.get(sector, (stats.baseline_rate, 0)) if sector else (stats.baseline_rate, 0)

    agent_adj = shrink(a_rate, a_n, stats.baseline_rate, AGENT_K)
    product_adj = shrink(p_rate, p_n, stats.baseline_rate, PRODUCT_K)
    sector_adj = shrink(s_rate, s_n, stats.baseline_rate, SECTOR_K)

    agent_delta = AGENT_WEIGHT * (agent_adj - stats.baseline_rate)
    product_delta = PRODUCT_WEIGHT * (product_adj - stats.baseline_rate)
    sector_delta = SECTOR_WEIGHT * (sector_adj - stats.baseline_rate)

    win_probability = min(0.95, max(0.05, stats.baseline_rate + agent_delta + product_delta + sector_delta))

    estimated_value = stats.product_avg_value.get(row["product"], statistics.mean(stats.product_avg_value.values()))

    engage = parse_date(row["engage_date"])
    mom_mult, mom_label = momentum(row["deal_stage"], engage, today, stats)

    expected_value = win_probability * estimated_value * mom_mult

    confidence = "baixa" if row["deal_stage"] == "Prospecting" or not row["account"] else (
        "média" if a_n < AGENT_K or p_n < PRODUCT_K else "alta"
    )

    return ScoreBreakdown(
        estimated_value=round(estimated_value, 2),
        win_probability=round(win_probability, 3),
        baseline_rate=round(stats.baseline_rate, 3),
        agent_delta=round(agent_delta, 3),
        product_delta=round(product_delta, 3),
        sector_delta=round(sector_delta, 3),
        momentum_multiplier=mom_mult,
        momentum_label=mom_label,
        confidence=confidence,
        expected_value=round(expected_value, 2),
        priority_score=0,  # preenchido depois, via percentil
    )


def narrative(row: dict, b: ScoreBreakdown, account: dict | None) -> str:
    """Gera a explicacao em linguagem natural (NLG determinístico, sem
    chamada de API) escolhendo qual fator domina para variar a redação."""
    parts = []

    if b.priority_score >= 75:
        parts.append(f"Prioridade alta (top {100 - b.priority_score}% do pipeline aberto).")
    elif b.priority_score >= 40:
        parts.append("Prioridade média.")
    else:
        parts.append("Prioridade baixa — foque nos deals acima antes deste.")

    parts.append(
        f"Valor estimado ~${b.estimated_value:,.0f} (média histórica do produto \"{row['product']}\" quando fechado)."
    )

    delta_pp = (b.win_probability - b.baseline_rate) * 100
    if abs(delta_pp) >= 1:
        direction = "acima" if delta_pp > 0 else "abaixo"
        parts.append(
            f"Chance de fechar estimada em {b.win_probability*100:.0f}%, {abs(delta_pp):.0f}pp {direction} da média geral ({b.baseline_rate*100:.0f}%)."
        )
    else:
        parts.append(f"Chance de fechar próxima da média geral do pipeline ({b.baseline_rate*100:.0f}%).")

    parts.append(b.momentum_label.capitalize() + ".")

    if b.confidence == "baixa":
        parts.append("Confiança baixa: deal em estágio inicial, com pouco dado histórico equivalente.")

    return " ".join(parts)


def assign_percentiles(scored: list[dict]) -> None:
    values = sorted(d["score"]["expected_value"] for d in scored)
    n = len(values)
    for d in scored:
        v = d["score"]["expected_value"]
        rank = sum(1 for x in values if x <= v)
        d["score"]["priority_score"] = round(100 * rank / n)


def build() -> None:
    pipeline = load_rows("sales_pipeline.csv")
    accounts = {r["account"]: r for r in load_rows("accounts.csv")}
    teams = {r["sales_agent"]: r for r in load_rows("sales_teams.csv")}

    stats = compute_stats(pipeline, accounts, teams)

    today = max(
        (parse_date(r["close_date"]) for r in pipeline if r["close_date"]), default=date.today()
    )

    scored: list[dict] = []
    for row in pipeline:
        if row["deal_stage"] not in OPEN_STAGES:
            continue
        breakdown = score_deal(row, stats, accounts, today)
        account = accounts.get(row["account"])
        team = teams.get(row["sales_agent"], {})
        scored.append(
            {
                "opportunity_id": row["opportunity_id"],
                "sales_agent": row["sales_agent"],
                "manager": team.get("manager", ""),
                "regional_office": team.get("regional_office", ""),
                "product": row["product"],
                "account": row["account"] or None,
                "sector": account["sector"] if account else None,
                "deal_stage": row["deal_stage"],
                "engage_date": row["engage_date"] or None,
                "score": asdict(breakdown),
                "narrative": "",  # preenchido depois de calcular percentil
            }
        )

    assign_percentiles(scored)
    for d in scored:
        row_lookup = {"product": d["product"], "deal_stage": d["deal_stage"]}
        d["narrative"] = narrative(row_lookup, ScoreBreakdown(**d["score"]), accounts.get(d["account"]))

    scored.sort(key=lambda d: -d["score"]["priority_score"])

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "as_of_date": today.isoformat(),
        "baseline_win_rate": round(stats.baseline_rate, 3),
        "won_day_median": stats.won_day_median,
        "lost_day_median": stats.lost_day_median,
        "total_open_deals": len(scored),
        "deals": scored,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {len(scored)} deals abertos pontuados -> {OUT_PATH}")


if __name__ == "__main__":
    build()
