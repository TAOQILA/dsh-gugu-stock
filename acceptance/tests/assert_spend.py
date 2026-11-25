#!/usr/bin/env python3
"""Assert the 谷谷股 spend-bar contract (P0 C17).

Checks that scripts/gugu_chart.py --kind spend:
  * sums only intraday balance DROPS (top-ups never cancel a day's spend),
  * keeps every day as one bar inside its own day cell,
  * uses a 0-based y axis snapped to 10 with 10-step gridlines,
  * colours the biggest spend pure green and the smallest pure red,
  * labels non-zero bars with one decimal.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
from _plugin_path import CHART_PY as SCRIPT
FIXTURES = HERE.parent / "fixtures"

GREEN = "#1a9c5b"
RED = "#d64545"
YELLOW = "#f0c400"

failures: list[str] = []
checks = 0


def check(condition: bool, label: str, detail: str = "") -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(f"{label}{(' — ' + detail) if detail else ''}")


def run_spend(fixture: str, extra: list[str] | None = None) -> dict:
    out = pathlib.Path(tempfile.gettempdir()) / f"gugu-spend-{fixture}.png"
    args = [
        sys.executable,
        str(SCRIPT),
        "--csv",
        str(FIXTURES / fixture),
        "--out",
        str(out),
        "--kind",
        "spend",
        "--json",
    ]
    if extra:
        args.extend(extra)
    proc = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=180)
    check(proc.returncode == 0, f"{fixture}: python exit 0", f"exit {proc.returncode} stderr={proc.stderr[-600:]}")
    line = next((item for item in reversed(proc.stdout.splitlines()) if item.startswith("GUGU_RESULT ")), None)
    check(line is not None, f"{fixture}: prints GUGU_RESULT", proc.stdout[-400:])
    meta = json.loads(line[len("GUGU_RESULT ") :]) if line else {}
    check(out.exists(), f"{fixture}: writes PNG")
    if out.exists():
        check(out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n", f"{fixture}: PNG signature")
    return meta


def main() -> int:
    recharge = run_spend("sample-spend-recharge.csv")
    bars = recharge.get("bars") or []
    check(recharge.get("kind") == "spend", "recharge: meta kind is spend", str(recharge.get("kind")))
    check(len(bars) == 1, "recharge: one day → one bar", str(len(bars)))
    if bars:
        value = float(bars[0]["value"])
        # 10 9 8 7 12 11 10 —— 掉了 1+1+1+1+1=5，充值的 +5 不能把花费吃掉
        check(abs(value - 5.0) < 1e-6, "recharge: spend is 5.0 (top-up ignored)", str(value))

    spend = run_spend("sample-spend.csv")
    values = [float(bar["value"]) for bar in spend.get("bars") or []]
    check(values == [0.0, 7.5, 0.0, 11.0, 0.0], "sample-spend: per-day spend", str(values))
    check(abs(float(spend.get("total") or 0) - 18.5) < 1e-6, "sample-spend: total 18.5", str(spend.get("total")))

    lo, hi = spend.get("ylim") or [None, None]
    check(lo == 0, "sample-spend: y axis starts at 0", str(lo))
    check(hi is not None and hi % 10 == 0 and hi >= max(values), "sample-spend: y ceiling is a 10 multiple above the data", str(hi))
    check(spend.get("gridStep") == 10, "sample-spend: gridline step is 10", str(spend.get("gridStep")))
    check(spend.get("dayBoundaries") == [0, 1, 2, 3, 4, 5], "sample-spend: one boundary per day edge", str(spend.get("dayBoundaries")))
    check(len(spend.get("tickPositions") or []) == len(values), "sample-spend: one tick per day", str(spend.get("tickPositions")))

    centres = [float(bar["x"]) for bar in spend.get("bars") or []]
    widths = [float(bar["width"]) for bar in spend.get("bars") or []]
    x_min, x_max = (float(value) for value in (spend.get("xRange") or [0.0, 0.0]))
    days = len(values)
    expect_centres = []
    expect_widths = []
    for index in range(days):
        left = x_min if index == 0 else float(index)
        right = x_max if index == days - 1 else float(index + 1)
        expect_centres.append((left + right) / 2)
        expect_widths.append((right - left) * 0.62)
    check(
        all(abs(centre - want) < 1e-6 for centre, want in zip(centres, expect_centres)),
        "sample-spend: bars centred in their (possibly trimmed) day cell",
        str(centres),
    )
    check(
        all(abs(width - want) < 1e-6 for width, want in zip(widths, expect_widths)),
        "sample-spend: bar width is 62% of the day cell",
        str(widths),
    )

    colours = [bar.get("color") for bar in spend.get("bars") or []]
    top = max(range(len(values)), key=lambda i: values[i])
    bottom = min(range(len(values)), key=lambda i: values[i])
    check(colours[top] == RED, "sample-spend: biggest spend is pure red", str(colours[top]))
    check(colours[bottom] == GREEN, "sample-spend: smallest spend is pure green", str(colours[bottom]))
    def channels(hex_code: str) -> tuple[int, int, int]:
        return tuple(int(hex_code[i : i + 2], 16) for i in (1, 3, 5))

    def expected(ratio: float) -> str:
        """红 → 黄(0.5) → 绿 两段线性插值，与 spend_color() 同步。"""
        red, yellow, green = channels(RED), channels(YELLOW), channels(GREEN)
        if ratio <= 0.5:
            t = ratio / 0.5
            low, high = green, yellow
        else:
            t = (ratio - 0.5) / 0.5
            low, high = yellow, red
        return "#" + "".join(f"{int(round(low[i] + (high[i] - low[i]) * t)):02x}" for i in range(3))

    span_low, span_high = min(values), max(values)
    for index, value in enumerate(values):
        if index in (top, bottom) or span_high == span_low:
            continue
        ratio = (value - span_low) / (span_high - span_low)
        check(
            colours[index] == expected(ratio),
            f"sample-spend: day {index} colour follows red→yellow→green interpolation",
            f"{colours[index]} vs {expected(ratio)} (ratio {ratio:.2f})",
        )

    texts = [bar.get("text") for bar in spend.get("bars") or []]
    check(texts[0] == "" and texts[2] == "" and texts[4] == "", "sample-spend: zero bars stay unlabelled", str(texts))
    check(texts[1] == "8" and texts[3] == "11", "sample-spend: non-zero bars round to integers", str(texts))

    # 中间值必须是黄色：0 / 5 / 10 三天，5 恰好落在红绿中点
    three = run_spend("sample-spend-three.csv")
    three_bars = three.get("bars") or []
    check([float(bar["value"]) for bar in three_bars] == [0.0, 5.0, 10.0], "three-level: spends are 0/5/10", str([bar["value"] for bar in three_bars]))
    three_colours = [bar.get("color") for bar in three_bars]
    check(three_colours[0] == GREEN, "three-level: smallest spend is pure green", str(three_colours[0]))
    check(three_colours[1] == YELLOW, "three-level: middle spend is pure yellow", str(three_colours[1]))
    check(three_colours[2] == RED, "three-level: biggest spend is pure red", str(three_colours[2]))

    ranged = run_spend("sample-spend.csv", ["--from", "2026-11-03", "--to", "2026-11-05"])
    ranged_values = [float(bar["value"]) for bar in ranged.get("bars") or []]
    check(ranged.get("days") == 3, "range: three days selected", str(ranged.get("days")))
    check(
        ranged.get("firstDate") == "2026-11-03" and ranged.get("lastDate") == "2026-11-05",
        "range: first/last date follow the request",
        str((ranged.get("firstDate"), ranged.get("lastDate"))),
    )
    check(ranged_values == [0.0, 11.0, 0.0], "range: spend day 11-04 still uses the 11-03 drop", str(ranged_values))

    # 柱顶数字用「类目对应的颜色」（用户 m08654：柱状图里数字改成类目对应的颜色）
    multi = run_spend("sample-three-series.csv", ["--sources", "ds,wb,aliyun", "--theme", "light"])
    by_series: dict[str, set] = {}
    for bar in multi.get("bars") or []:
        by_series.setdefault(bar.get("series"), set()).add(bar.get("labelColor"))
    check(sorted(by_series) == ["aliyun", "ds", "wb"], "label colour: all three sources are drawn", str(sorted(by_series)))
    want_light = {"ds": "#2563c9", "wb": "#3f9e73", "aliyun": "#d13a10"}
    for name, want in want_light.items():
        check(
            by_series.get(name) == {want},
            f"label colour: light theme {name} numbers use the {name} colour",
            str(by_series.get(name)),
        )
    check(
        len({next(iter(by_series[name])) for name in by_series}) == 3,
        "label colour: the three sources use three different label colours",
        str({name: next(iter(by_series[name])) for name in by_series}),
    )

    multi_dark = run_spend("sample-three-series.csv", ["--sources", "ds,wb,aliyun", "--theme", "dark"])
    dark_map: dict[str, set] = {}
    for bar in multi_dark.get("bars") or []:
        dark_map.setdefault(bar.get("series"), set()).add(bar.get("labelColor"))
    want_dark = {"ds": "#8fbcf7", "wb": "#46a87c", "aliyun": "#ff8a5c"}
    for name, want in want_dark.items():
        check(
            dark_map.get(name) == {want},
            f"label colour: dark theme {name} numbers use the bright {name} colour",
            str(dark_map.get(name)),
        )

    source = SCRIPT.read_text(encoding="utf-8")
    check(
        'color=bar.get("labelColor", text_color)' in source,
        "label colour: the bar annotation reads the per-series colour",
    )
    check(
        "SPEND_HEADROOM" in source and "hi * SPEND_HEADROOM" in source,
        "spend: a headroom band keeps the hand-drawn legend clear of the bars",
    )

    if failures:
        print(f"FAIL {len(failures)}/{checks}")
        for item in failures:
            print("  - " + item)
        return 1
    print(f"SPEND_OK {checks} assertions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
