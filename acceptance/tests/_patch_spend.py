# -*- coding: utf-8 -*-
"""补丁 2：花费改为「当天所有下降幅度的和」，柱色按花费高低红→绿渐变。"""
from pathlib import Path

path = Path(__file__).resolve().parents[2] / "dsh-gugu-stock" / "scripts" / "gugu_chart.py"
src = path.read_text(encoding="utf-8")


def swap(old: str, new: str) -> None:
    global src
    assert old in src, old[:70]
    src = src.replace(old, new, 1)


swap(
    'COLOR_SPEND = "#7c8fb3"  # 花费柱状图：灰蓝，和折线的红/绿区分开\n',
    'SPEND_RED = (214, 69, 69)    # 花费最少 → 纯红\nSPEND_GREEN = (26, 156, 91)  # 花费最多 → 纯绿\n',
)

# 花费 = 当天所有下降幅度之和（充值等上涨不计）
swap(
    '''def build_spend(rows: list[tuple[str, str, float]], window: list[str], layout: dict) -> dict:
    """每天的花费 = 前一天日终余额 − 当天日终余额（充值/上涨当天记 0）。"""
    finals = daily_finals(rows)
    ordered = all_days(rows)
    previous_of = {date: (ordered[index - 1] if index > 0 else None) for index, date in enumerate(ordered)}

    bars = []
    for index, date in enumerate(window):
        prior_date = previous_of.get(date)
        prior = finals.get(prior_date) if prior_date else None
        today = finals[date]
        spend = max(0.0, round(prior - today, 6)) if prior is not None else 0.0
        left_edge = layout["xMin"] if index == 0 else float(index)''',
    '''def spend_by_day(rows: list[tuple[str, str, float]]) -> dict[str, float]:
    """每天花了多少 = 当天所有「下降」幅度之和。

    只看相邻两条记录：掉多少算花多少，涨上去（充值/赠金）不计入花费，也不会
    抵消当天已经掉下去的部分。例如 10 9 8 7 12 11 10 一天里掉过的总量是 5。
    """
    spend: dict[str, float] = {}
    previous: float | None = None
    for date, _time, value in rows:
        if previous is not None and previous > value:
            spend[date] = spend.get(date, 0.0) + (previous - value)
        previous = value
    return {date: round(value, 6) for date, value in spend.items()}


def spend_color(value: float, low: float, high: float) -> tuple[float, float, float]:
    """花得越多越接近纯绿，越少越接近纯红。"""
    if high - low < 1e-9:
        ratio = 0.5
    else:
        ratio = (value - low) / (high - low)
    ratio = min(1.0, max(0.0, ratio))
    return tuple(
        (SPEND_RED[channel] + (SPEND_GREEN[channel] - SPEND_RED[channel]) * ratio) / 255.0
        for channel in range(3)
    )


def build_spend(rows: list[tuple[str, str, float]], window: list[str], layout: dict) -> dict:
    """每天一根柱子，柱子的红绿深浅按当天花费在区间内的相对高低来定。"""
    totals = spend_by_day(rows)

    bars = []
    for index, date in enumerate(window):
        spend = totals.get(date, 0.0)
        left_edge = layout["xMin"] if index == 0 else float(index)''',
)

swap(
    '''    max_spend = max((bar["value"] for bar in bars), default=0.0)
    hi = max(float(AXIS_STEP), float(math.ceil(max_spend / AXIS_STEP) * AXIS_STEP))''',
    '''    max_spend = max((bar["value"] for bar in bars), default=0.0)
    min_spend = min((bar["value"] for bar in bars), default=0.0)
    for bar in bars:
        bar["color"] = "#%02x%02x%02x" % tuple(
            int(round(channel * 255)) for channel in spend_color(bar["value"], min_spend, max_spend)
        )
    hi = max(float(AXIS_STEP), float(math.ceil(max_spend / AXIS_STEP) * AXIS_STEP))''',
)

swap(
    '''        "bars": bars,
        "total": round(sum(bar["value"] for bar in bars), 6),
        "min": min((bar["value"] for bar in bars), default=0.0),
        "max": max_spend,''',
    '''        "bars": bars,
        "total": round(sum(bar["value"] for bar in bars), 6),
        "min": min_spend,
        "max": max_spend,''',
)

# 柱体用每根柱子自己的颜色
swap(
    '''                color=COLOR_SPEND,''',
    '''                color=bar.get("color", "#7c8fb3"),''',
)

path.write_text(src, encoding="utf-8")
print("patched spend semantics")
