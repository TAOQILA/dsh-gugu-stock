#!/usr/bin/env python3
"""Assert the 谷谷股 line-color modes (P0).

Runs scripts/gugu_chart.py on the three-series fixture in both modes and checks:
- meta.colorMode reflects the mode actually rendered;
- change mode paints red/green (up/down) segments;
- source mode paints only the three source mark colours (blue/green/orange)
  and no change colours;
- the source-code legend branch maps blue/green/orange to the three sources.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
from _plugin_path import PLUGIN, CHART_PY as SCRIPT
FIXTURE = HERE.parent / "fixtures" / "sample-three-series.csv"

# Exact core colours (antialiasing still leaves fully-opaque core pixels).
CHANGE_RED = (0xD6, 0x45, 0x45)
CHANGE_GREEN = (0x1A, 0x9C, 0x5B)
DS_BLUE = (0x25, 0x63, 0xC9)
WB_GREEN = (0x7B, 0xC9, 0xA0)
ALI_ORANGE = (0xE8, 0x46, 0x1A)   # m07048：阿里云改橙红（原正橙 #d9480f）
DS_BLUE_HEX = "#2563c9"
WB_GREEN_HEX = "#7bc9a0"
ALI_ORANGE_HEX = "#e8461a"

failures: list[str] = []
checks = 0


def check(condition: bool, label: str, detail: str = "") -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(f"{label}{(' — ' + detail) if detail else ''}")


def render(mode: str, kind: str = "line") -> tuple[dict, pathlib.Path]:
    out = pathlib.Path(tempfile.gettempdir()) / f"gugu-color-{kind}-{mode}.png"
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--csv", str(FIXTURE),
            "--out", str(out),
            "--json",
            "--kind", kind,
            "--sources", "ds,wb,aliyun",
            "--scale-ds", "100",
            "--scale-wb", "3.25",
            "--scale-aliyun", "12.5",
            "--color-mode", mode,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
    )
    check(proc.returncode == 0, f"{mode}: python exit 0", f"exit {proc.returncode} stderr={proc.stderr[-600:]}")
    line = next((line for line in reversed(proc.stdout.splitlines()) if line.startswith("GUGU_RESULT ")), None)
    check(line is not None, f"{mode}: prints GUGU_RESULT", proc.stdout[-400:])
    meta = json.loads(line[len("GUGU_RESULT ") :]) if line else {}
    check(out.exists(), f"{mode}: writes PNG")
    return meta, out


def count_color(path: pathlib.Path, rgb: tuple[int, int, int]) -> int:
    if not path.exists():
        return 0
    image = Image.open(path).convert("RGB")
    return sum(1 for pixel in image.getdata() if pixel == rgb)


def main() -> int:
    change_meta, change_png = render("change")
    source_meta, source_png = render("source")

    check(change_meta.get("colorMode") == "change", "change mode: meta.colorMode == change", str(change_meta.get("colorMode")))
    check(source_meta.get("colorMode") == "source", "source mode: meta.colorMode == source", str(source_meta.get("colorMode")))
    check(change_meta.get("drawn") == ["ds", "wb", "aliyun"], "change mode: all three series drawn", str(change_meta.get("drawn")))
    check(source_meta.get("drawn") == ["ds", "wb", "aliyun"], "source mode: all three series drawn", str(source_meta.get("drawn")))

    change_red = count_color(change_png, CHANGE_RED)
    change_green = count_color(change_png, CHANGE_GREEN)
    source_red = count_color(source_png, CHANGE_RED)
    source_green = count_color(source_png, CHANGE_GREEN)
    source_blue = count_color(source_png, DS_BLUE)
    source_wb = count_color(source_png, WB_GREEN)
    source_orange = count_color(source_png, ALI_ORANGE)

    check(change_red > 0, "change mode: red up-segments present", str(change_red))
    check(change_green > 0, "change mode: green down-segments present", str(change_green))
    check(source_red == 0, "source mode: no red change-colour segments", str(source_red))
    check(source_green == 0, "source mode: no green change-colour segments", str(source_green))
    check(source_blue > 0, "source mode: DS blue present", str(source_blue))
    check(source_wb > 0, "source mode: WB green present", str(source_wb))
    check(source_orange > 0, "source mode: Aliyun orange present", str(source_orange))

    # 图例：source 模式把蓝/绿/橙映射到三条数据源名称。
    src = SCRIPT.read_text(encoding="utf-8")
    check("COLOR_MODE_SOURCE" in src, "chart script defines the source colour mode")
    check("color_mode == COLOR_MODE_SOURCE" in src, "chart script branches on the source colour mode")
    check('SERIES_LABELS["ds"]' in src and 'SERIES_LABELS["wb"]' in src and 'SERIES_LABELS["aliyun"]' in src,
          "source-mode legend labels all three series")

    # 花费柱状图也跟随颜色模式：source 模式每根柱用数据源固定色，三柱等宽。
    spend_meta, spend_png = render("source", "spend")
    check(spend_meta.get("kind") == "spend", "spend: meta.kind == spend", str(spend_meta.get("kind")))
    check(spend_meta.get("colorMode") == "source", "spend: meta.colorMode == source", str(spend_meta.get("colorMode")))
    spend_bars = spend_meta.get("bars") or []
    widths: dict[str, set[float]] = {}
    colours: dict[str, set[str]] = {}
    for bar in spend_bars:
        widths.setdefault(bar["series"], set()).add(round(float(bar["width"]), 9))
        colours.setdefault(bar["series"], set()).add(str(bar.get("color", "")))
    check(len(widths) == 3, "spend: all three series present", str(sorted(widths)))
    all_widths = {w for values in widths.values() for w in values}
    check(len(all_widths) == 1, "spend: DS/WB/Aliyun bars are equal width", str(widths))
    check(colours.get("ds") == {DS_BLUE_HEX}, "spend source: DS bars are blue", str(colours.get("ds")))
    check(colours.get("wb") == {WB_GREEN_HEX}, "spend source: WB bars are green", str(colours.get("wb")))
    check(colours.get("aliyun") == {ALI_ORANGE_HEX}, "spend source: Aliyun bars are orange", str(colours.get("aliyun")))
    spend_blue = count_color(spend_png, DS_BLUE)
    spend_wb = count_color(spend_png, WB_GREEN)
    spend_orange = count_color(spend_png, ALI_ORANGE)
    check(spend_blue > 0, "spend source: blue DS bars on PNG", str(spend_blue))
    check(spend_wb > 0, "spend source: green WB bars on PNG", str(spend_wb))
    check(spend_orange > 0, "spend source: orange Aliyun bars on PNG", str(spend_orange))
    # 图例三根柱子等宽且采用数据源色。
    check("bar_w = 0.030" in src, "spend source: legend uses a single equal bar width")
    check("wide_w, narrow_w" not in src, "spend source: the old wide/narrow legend widths are gone")
    check("legend_colors" in src and "COLOR_MODE_SOURCE" in src,
          "spend source: legend colours follow the colour mode")

    # m07048 ②：change 模式下阿里云折线按涨跌——源码里 aliyun 与 ds 共用红绿灰基准。
    check('if name in ("ds", "aliyun"):' in src,
          "change mode: Aliyun line shares the red/green/grey change palette with DS")

    # m07048 ②③：change 模式柱子按数据源显示三种花纹，阿里云柱走纯红黄绿热力。
    change_spend_meta, change_spend_png = render("change", "spend")
    change_bars = change_spend_meta.get("bars") or []
    hatch_by_series: dict[str, set[str]] = {}
    colour_by_series: dict[str, set[str]] = {}
    for bar in change_bars:
        hatch_by_series.setdefault(bar["series"], set()).add(str(bar.get("hatch", "")))
        colour_by_series.setdefault(bar["series"], set()).add(str(bar.get("color", "")))
    check(len(hatch_by_series) == 3, "spend change: all three series present", str(sorted(hatch_by_series)))
    check(hatch_by_series.get("ds") == {""}, "spend change: DS bars are plain (no hatch)", str(hatch_by_series.get("ds")))
    check(hatch_by_series.get("wb") == {"///"}, "spend change: WB bars use diagonal hatch", str(hatch_by_series.get("wb")))
    check(hatch_by_series.get("aliyun") == {"..."}, "spend change: Aliyun bars use dot hatch", str(hatch_by_series.get("aliyun")))
    # 阿里云 change 柱走纯热力（红/绿或两端），不是主题混色，也不是橙红固定色。
    ali_change_colours = colour_by_series.get("aliyun", set())
    check(ALI_ORANGE_HEX not in ali_change_colours,
          "spend change: Aliyun bars are NOT the fixed orange-red source colour", str(ali_change_colours))
    check('hatch=bar.get("hatch", "")' in src, "spend change: bar renderer honours the hatch field")
    check("SERIES_HATCH" in src, "spend change: hatch patterns are declared per series")
    check("legend_hatch" in src, "spend change: legend mirrors the per-series hatch")

    print(
        f"COLOR_MODE_OK change(red={change_red},green={change_green}) "
        f"source(blue={source_blue},green={source_wb},orange={source_orange},red={source_red},greenChange={source_green}) "
        f"spendSource(blue={spend_blue},green={spend_wb},orange={spend_orange})"
    )
    if failures:
        print(f"FAIL {len(failures)}/{checks}")
        for item in failures:
            print("  - " + item)
        return 1
    print(f"PASS {checks} assertions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
