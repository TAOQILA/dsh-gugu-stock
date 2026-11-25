#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""双序列（DS 余额 + WB 积分）出图断言。

覆盖 m02345 的四条要求：
  2) WB 默认按 2.5% 缩放（1008.40 积分 → 高度 25.21），可用 --wb-percent 改，标签仍显示积分原值；
  3) 数字最多 1 位小数、整数不带小数位；
  4) WB 那条线用更浅的颜色；
  5) 花费图也画 WB 的浅色柱。
用法：py -3.12 acceptance/tests/assert_dual.py
"""
from __future__ import annotations

import json
import math
import os
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
# 两种布局都支持：仓库根（<root>/dsh-gugu-stock/...）与插件根（<root>/scripts/...）
_PLUGIN = ROOT / "dsh-gugu-stock"
if not (_PLUGIN / "scripts" / "gugu_chart.py").is_file():
    _PLUGIN = ROOT
SCRIPT = _PLUGIN / "scripts" / "gugu_chart.py"
FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "fixtures"

checks = 0
failures: list[str] = []


def check(condition: bool, label: str, note: str = "") -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(label + (f" → {note}" if note else ""))


def run(*args: str) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        out = pathlib.Path(tmp) / "chart.png"
        completed = subprocess.run(
            [sys.executable, str(SCRIPT), *args, "--out", str(out), "--json"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        if completed.returncode != 0:
            raise SystemExit(f"chart failed ({completed.returncode}): {completed.stderr[-800:]}")
        line = [item for item in completed.stdout.splitlines() if item.startswith("GUGU_RESULT ")]
        if not line:
            raise SystemExit("no GUGU_RESULT line")
        return json.loads(line[-1][len("GUGU_RESULT ") :])


def label_text(value: float) -> str:
    """图表标注规则：直接用插件里的 coarse_label（粗粒度中文单位），测试不另抄一份。"""
    scripts = str(SCRIPT.parent)
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    import gugu_chart

    return gugu_chart.label_text(value)


def main() -> int:
    dual = FIXTURES / "sample-dual.csv"
    legacy = FIXTURES / "sample60.csv"

    line = run("--csv", str(dual), "--kind", "line", "--from", "2026-11-10", "--to", "2026-11-21")
    check(line.get("ok") is True, "dual: chart builds")
    check(line.get("kind") == "line", "dual: kind is line", str(line.get("kind")))
    check(line.get("primary") == "ds", "dual: DS is the primary series", str(line.get("primary")))
    check(line.get("withWb") is True, "dual: WB series is present")
    check(abs((line.get("wbPercent") or 0) - 3.25) < 1e-9, "dual: WB percent defaults to 3.25", str(line.get("wbPercent")))
    check(abs((line.get("wbScale") or 0) - 100.0 / 3.25) < 1e-6, "dual: WB scale is 100/3.25", str(line.get("wbScale")))

    wb_daily = line.get("wbDailyLast") or []
    check(len(wb_daily) >= 3, "dual: every WB day has a final node", str(len(wb_daily)))
    for item in wb_daily:
        check(
            abs(float(item["y"]) - float(item["value"]) / (100.0 / 3.25)) < 1e-9,
            f"dual: WB {item['date']} height is value/(100/3.25)",
            f"{item['y']} vs {item['value']}/(100/3.25)",
        )
        check(
            item.get("text") == label_text(float(item["value"])),
            f"dual: WB {item['date']} label shows the raw credits",
            f"{item.get('text')} vs {item['value']}",
        )

    # 数字格式（v1.20.5 起）：图上数字统一用粗粒度中文单位（1千 / 7百万 / 1亿1千万 / 67），
    # 所以这里校验「每一条都等于插件规则算出来的文字」，不再要求纯数字。
    pairs = [(item.get("text"), float(item.get("balance"))) for item in (line.get("labels") or [])]
    pairs += [(item.get("text"), float(item.get("value"))) for item in wb_daily]
    check(
        all(str(text) == label_text(number) for text, number in pairs),
        "dual: every label follows the coarse Chinese rule",
        str(pairs[:5]),
    )

    # 横轴不再合并：每天一格、标签只写 MM-DD
    check(
        not any("~" in str(label) for label in (line.get("dates") or [])),
        "dual: no condensed MM-DD~MM-DD columns any more",
        str(line.get("dates")),
    )
    check(
        len(line.get("dates") or []) == line.get("days"),
        "dual: the axis shows every day in the window",
        f"{len(line.get('dates') or [])} vs {line.get('days')}",
    )

    # WB 每天的数字都要标出来：showLabel 恒真，且渲染端没有「跳过」分支
    check(all(item.get("showLabel") is True for item in wb_daily), "dual: every WB day node is labelled")
    wb_days = {item["date"] for item in wb_daily}
    check(
        len(wb_daily) == len(wb_days),
        "dual: one WB label per day (no duplicate per-day nodes)",
        f"{len(wb_daily)} vs {len(wb_days)}",
    )
    source = SCRIPT.read_text(encoding="utf-8")
    for banned in ('abs(item["x"] - x) < 0.14', "last_wb_label_x", "if item.get(\"merged\"):"):
        check(banned not in source, f"dual: the WB label skip guard {banned!r} is gone")

    # DS 永远压在 WB 上面（m04068）：折线 3 > 2、节点 5.4 > 4、数字 6 > 5 且底衬不透明
    for needle, why in (
        ('capstyle="round", zorder=3)', "DS line sits above the WB line (zorder 3 > 2)"),
        ('capstyle="round", zorder=2', "WB line stays at zorder 2"),
        ('linewidths=1.2, zorder=5.4)', "DS markers sit above the WB markers (5.4 > 4)"),
        ("zorder=5,", "WB labels stay at zorder 5"),
        ("zorder=6,", "DS labels sit above the WB labels (6 > 5)"),
        ("path_effects=halo(", "number backdrops are stroked halos that follow the glyph shape"),
    ):
        check(needle in source, f"dual: {why}")
    check(
        source.index("zorder=5.4)") < source.index("s=26,"),
        "dual: DS markers are drawn before WB markers in source order",
    )
    # v1.7 ⑤：数字底衬不再是整块矩形 bbox，而是贴合字形的半透明描边。
    check("bbox={\"boxstyle\"" not in source, "dual: no rectangular bbox backdrop remains")
    check("def halo(" in source, "dual: numbers use the halo() stroke helper")

    # v1.13⑥：DS / WB / 阿里云一律等宽，不再降低 WB 宽度。
    check("width = group / len(side)" in source, "dual: balance bars are divided equally (ut is excluded)")
    check(
        "geometry[TOKEN_SERIES] = (center, (right_edge - left_edge) * 0.92)" in source,
        "dual: the ut bar spans the whole day and sits behind the others",
    )
    check("wb_width = group / 3.0" not in source, "dual: the old narrow-WB width is gone")
    check("ds_width = group * 2.0 / 3.0" not in source, "dual: the old wide-DS width is gone")
    spend_meta = run("--csv", str(dual), "--kind", "spend", "--from", "2026-11-10", "--to", "2026-11-21")
    ds_widths = {bar["date"]: float(bar["width"]) for bar in (spend_meta.get("dsBars") or [])}
    for bar in spend_meta.get("wbBars") or []:
        partner = ds_widths.get(bar["date"])
        if partner is None:
            continue
        check(
            abs(float(bar["width"]) - partner) < 1e-9,
            f"dual spend: WB bar {bar['date']} has the same width as DS",
            f"{bar['width']} vs {partner}",
        )

    # v1.7 ⑦：折线图图例用两个 marker 圆点；柱状图图例用等宽的柱子（靠颜色区分）。
    check('marker="o", linestyle="None"' in source, "dual: line legend uses marker dots")
    check("markerfacecolor=ds_mark_color" in source, "dual: line legend DS dot is blue")
    check("bar_w = 0.030" in source, "dual: spend legend draws equal-width bars")
    check("bar_w, bar_h" not in source and "wide_w, narrow_w" not in source,
          "dual: the old wide/narrow legend widths are gone")

    # 相邻两个节点都有有效数值就必须连线：没有「跨空档不画」的特例
    xs = [float(value) for value in (line.get("nodeXs") or [])]
    expected_segments = max(0, len(xs) - 1)
    drawn = sum((line.get("segments") or {}).values())
    widest = max((b - a for a, b in zip(xs, xs[1:])), default=0.0)
    check(widest > 1.2, "dual fixture really contains a wide gap (regression guard)", f"widest gap {widest:.3f}")
    check(
        drawn == expected_segments,
        "dual: every adjacent node pair is connected, wide gaps included",
        f"drawn {drawn} vs adjacent-pairs {expected_segments}",
    )

    # WB 的深浅随主题反过来：明色底比 DS 浅、暗色底比 DS 深（m04120）
    def brightness(hex_color: str) -> int:
        value = str(hex_color).lstrip("#")
        return sum(int(value[index : index + 2], 16) for index in (0, 2, 4))

    sys.path.insert(0, str(SCRIPT.parent))
    import gugu_chart  # noqa: E402  （同目录脚本，import 不会执行 main）

    light = gugu_chart.THEMES["light"]
    dark = gugu_chart.THEMES["dark"]
    for label, palette, expect_lighter in (
        ("light", light, True),
        ("dark", dark, False),
    ):
        for line_key, ds_color, name in (
            ("wb_line_down", gugu_chart.COLOR_DOWN, "green"),
            ("wb_line_up", gugu_chart.COLOR_UP, "red"),
        ):
            wb_value = brightness(palette[line_key])
            ds_value = brightness(ds_color)
            if expect_lighter:
                check(
                    wb_value > ds_value,
                    f"dual: {label} theme WB {name} line is lighter than the DS {name}",
                    f"{palette[line_key]} vs {ds_color}",
                )
            else:
                check(
                    wb_value < ds_value,
                    f"dual: {label} theme WB {name} line is deeper than the DS {name}",
                    f"{palette[line_key]} vs {ds_color}",
                )
    # 暗色底上的 WB 节点/数字也必须比 DS 深，且不能压到看不清（留一点亮度）
    for key in ("wb_mark", "wb_text"):
        check(
            brightness(dark[key]) < brightness(dark["ds_mark"]),
            f"dual: dark theme {key} is deeper than the DS mark",
            f"{dark[key]} vs {dark['ds_mark']}",
        )
        check(
            brightness(dark[key]) > 150,
            f"dual: dark theme {key} stays visible on the dark background",
            str(dark[key]),
        )

    # 旧的 2 列文件仍然只画一条线
    old = run("--csv", str(legacy), "--kind", "line")
    check(old.get("withWb") is False, "legacy 2-column CSV: no WB series")
    check(old.get("primary") == "ds", "legacy 2-column CSV: DS is primary")

    # 花费图：两组柱子，WB 柱子高度也按 3.25%（100/3.25），宽度是 DS 的一半
    spend = run("--csv", str(dual), "--kind", "spend", "--from", "2026-11-10", "--to", "2026-11-21")
    check(spend.get("kind") == "spend", "dual spend: kind is spend")
    check(spend.get("withWb") is True, "dual spend: WB bars are drawn")
    series = {bar.get("series") for bar in spend.get("bars") or []}
    check(series == {"ds", "wb"}, "dual spend: both series present", str(sorted(series)))
    for bar in spend.get("bars") or []:
        if bar.get("series") != "wb":
            continue
        check(
            abs(float(bar["height"]) - float(bar["value"]) / (100.0 / 3.25)) < 1e-9,
            f"dual spend: WB bar {bar['date']} height is value/(100/3.25)",
            f"{bar['height']} vs {bar['value']}",
        )
        check(
            bar.get("text") in ("", label_text(float(bar["value"]))),
            f"dual spend: WB bar {bar['date']} label shows raw credits",
            str(bar.get("text")),
        )
    def rgb(hex_color: str) -> tuple[int, int, int]:
        value = str(hex_color).lstrip("#")
        return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))

    ds_bars = {bar["date"]: bar for bar in (spend.get("dsBars") or [])}
    check(spend.get("theme") == "light", "dual spend: meta carries the resolved theme", str(spend.get("theme")))
    for bar in spend.get("wbBars") or []:
        wb_rgb = rgb(bar.get("color"))
        check(all(channel >= 140 for channel in wb_rgb), f"dual spend: WB bar {bar['date']} is a pale colour", str(bar.get("color")))
        partner = ds_bars.get(bar["date"])
        if partner and partner.get("color"):
            check(
                sum(wb_rgb) > sum(rgb(partner.get("color"))),
                f"dual spend: WB bar {bar['date']} is lighter than the DS bar",
                f"{bar.get('color')} vs {partner.get('color')}",
            )

    # 暗色主题下反过来：WB 的柱子必须比同日的 DS 柱更深
    dark_spend = run(
        "--csv", str(dual), "--kind", "spend", "--from", "2026-11-10", "--to", "2026-11-21",
        "--theme", "dark",
    )
    check(dark_spend.get("theme") == "dark", "dual spend dark: meta theme is dark", str(dark_spend.get("theme")))
    dark_ds = {bar["date"]: bar for bar in (dark_spend.get("dsBars") or [])}
    for bar in dark_spend.get("wbBars") or []:
        partner = dark_ds.get(bar["date"])
        if not partner or not partner.get("color"):
            continue
        check(
            sum(rgb(bar.get("color"))) < sum(rgb(partner.get("color"))),
            f"dual spend dark: WB bar {bar['date']} is deeper than the DS bar",
            f"{bar.get('color')} vs {partner.get('color')}",
        )
    # ---- WB 缩放可配置：--wb-percent 传 4 就按 4%（=100/4）画 ----
    custom = run(
        "--csv", str(dual), "--kind", "line", "--from", "2026-11-10", "--to", "2026-11-21",
        "--wb-percent", "4",
    )
    check(abs((custom.get("wbPercent") or 0) - 4.0) < 1e-9, "dual: --wb-percent 4 is honoured", str(custom.get("wbPercent")))
    check(abs((custom.get("wbScale") or 0) - 25.0) < 1e-9, "dual: wbScale follows 100/percent", str(custom.get("wbScale")))
    for item in (custom.get("wbDailyLast") or [])[:5]:
        check(
            abs(float(item["y"]) - float(item["value"]) / 25.0) < 1e-9,
            f"dual custom: WB {item['date']} height is value/25",
            f"{item['y']} vs {item['value']}/25",
        )

    # ---- 越界/非法百分比夹到 [0.1, 20]，不会崩溃 ----
    huge = run(
        "--csv", str(dual), "--kind", "line", "--from", "2026-11-10", "--to", "2026-11-21",
        "--wb-percent", "999",
    )
    check(abs((huge.get("wbPercent") or 0) - 20.0) < 1e-9, "dual: percent above max clamps to 20", str(huge.get("wbPercent")))
    tiny = run(
        "--csv", str(dual), "--kind", "line", "--from", "2026-11-10", "--to", "2026-11-21",
        "--wb-percent", "0",
    )
    check(abs((tiny.get("wbPercent") or 0) - 3.25) < 1e-9, "dual: zero percent falls back to default", str(tiny.get("wbPercent")))

    check(float(spend["ylim"][0]) == 0.0, "dual spend: y axis starts at 0", str(spend["ylim"]))
    check(int(spend["ylim"][1]) % 10 == 0, "dual spend: y axis top is a multiple of 10", str(spend["ylim"]))

    if failures:
        print(f"FAIL {len(failures)}/{checks}")
        for item in failures:
            print("  - " + item)
        return 1
    print(f"DUAL_OK {checks} assertions")
    return 0


if __name__ == "__main__":
    sys.exit(main())