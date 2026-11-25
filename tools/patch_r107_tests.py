"""一次性补丁：v1.7 断言更新（acceptance/tests/assert_dual.py）。

- WB 默认百分比 1.5 -> 2.5（含 scale、高度、回退值）
- 图例/柱宽/数字底衬的源码级断言改为 v1.7 口径
- 新增：WB 柱宽 = DS 的 1/2、图例用 marker 圆点 / 宽度不同的 Patch
"""
from pathlib import Path

TEST = Path(__file__).resolve().parent.parent.parent / "acceptance" / "tests" / "assert_dual.py"
text = TEST.read_text(encoding="utf-8")
original = text


def apply(name: str, old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f"PATCH FAILED [{name}]: not found")
    if text.count(old) > 1:
        raise SystemExit(f"PATCH FAILED [{name}]: {text.count(old)} matches")
    text = text.replace(old, new, 1)
    print(f"ok [{name}]")


apply(
    "docstring percent",
    "  2) WB 默认按 1.5% 缩放（1008.40 积分 → 高度 15.126），可用 --wb-percent 改，标签仍显示积分原值；",
    "  2) WB 默认按 2.5% 缩放（1008.40 积分 → 高度 25.21），可用 --wb-percent 改，标签仍显示积分原值；",
)
apply(
    "default percent",
    '''    check(abs((line.get("wbPercent") or 0) - 1.5) < 1e-9, "dual: WB percent defaults to 1.5", str(line.get("wbPercent")))
    check(abs((line.get("wbScale") or 0) - 100.0 / 1.5) < 1e-6, "dual: WB scale is 100/1.5", str(line.get("wbScale")))''',
    '''    check(abs((line.get("wbPercent") or 0) - 2.5) < 1e-9, "dual: WB percent defaults to 2.5", str(line.get("wbPercent")))
    check(abs((line.get("wbScale") or 0) - 100.0 / 2.5) < 1e-6, "dual: WB scale is 100/2.5", str(line.get("wbScale")))''',
)
apply(
    "line heights",
    '''            abs(float(item["y"]) - float(item["value"]) / (100.0 / 1.5)) < 1e-9,
            f"dual: WB {item['date']} height is value/(100/1.5)",
            f"{item['y']} vs {item['value']}/(100/1.5)",''',
    '''            abs(float(item["y"]) - float(item["value"]) / (100.0 / 2.5)) < 1e-9,
            f"dual: WB {item['date']} height is value/(100/2.5)",
            f"{item['y']} vs {item['value']}/(100/2.5)",''',
)
apply(
    "spend comment percent",
    "    # 花费图：两组柱子，WB 柱子高度也按 1.5%（100/1.5）",
    "    # 花费图：两组柱子，WB 柱子高度也按 2.5%（100/2.5），宽度是 DS 的一半",
)
apply(
    "spend bar heights",
    '''            abs(float(bar["height"]) - float(bar["value"]) / (100.0 / 1.5)) < 1e-9,
            f"dual spend: WB bar {bar['date']} height is value/(100/1.5)",''',
    '''            abs(float(bar["height"]) - float(bar["value"]) / (100.0 / 2.5)) < 1e-9,
            f"dual spend: WB bar {bar['date']} height is value/(100/2.5)",''',
)
apply(
    "zero percent fallback",
    '''    check(abs((tiny.get("wbPercent") or 0) - 1.5) < 1e-9, "dual: zero percent falls back to default", str(tiny.get("wbPercent")))''',
    '''    check(abs((tiny.get("wbPercent") or 0) - 2.5) < 1e-9, "dual: zero percent falls back to default", str(tiny.get("wbPercent")))''',
)

# 源码级：底衬从 bbox 换成 path_effects halo
apply(
    "halo replaces bbox",
    '''        ('"alpha": 1.0}', "DS label backdrop is opaque so it fully covers the WB text"),
''',
    '''        ("path_effects=halo(", "number backdrops are stroked halos that follow the glyph shape"),
''',
)
apply(
    "bbox is gone",
    '''    check(
        source.index("zorder=5.4)") < source.index("s=26,"),
        "dual: DS markers are drawn before WB markers in source order",
    )''',
    '''    check(
        source.index("zorder=5.4)") < source.index("s=26,"),
        "dual: DS markers are drawn before WB markers in source order",
    )
    # v1.7 ⑤：数字底衬不再是整块矩形 bbox，而是贴合字形的半透明描边。
    check("bbox={\\"boxstyle\\"" not in source, "dual: no rectangular bbox backdrop remains")
    check("def halo(" in source, "dual: numbers use the halo() stroke helper")

    # v1.7 ⑥：WB 柱宽固定为 DS 的一半。
    check("wb_width = group / 3.0" in source, "dual: WB bar width is a third of the group")
    check("ds_width = group * 2.0 / 3.0" in source, "dual: DS bar width is two thirds of the group")
    spend_meta = run("--csv", str(dual), "--kind", "spend", "--from", "2026-11-10", "--to", "2026-11-21")
    ds_widths = {bar["date"]: float(bar["width"]) for bar in (spend_meta.get("dsBars") or [])}
    for bar in spend_meta.get("wbBars") or []:
        partner = ds_widths.get(bar["date"])
        if partner is None:
            continue
        check(
            abs(float(bar["width"]) * 2.0 - partner) < 1e-9,
            f"dual spend: WB bar {bar['date']} is half the DS width",
            f"{bar['width']} vs {partner}",
        )

    # v1.7 ⑦：折线图图例用两个 marker 圆点；柱状图图例用宽度不同的同色柱子。
    check('marker="o", linestyle="None"' in source, "dual: line legend uses marker dots")
    check("markerfacecolor=ds_mark_color" in source, "dual: line legend DS dot is blue")
    check("Patch(facecolor=text_color, width=1.6" in source, "dual: spend legend draws a wide bar")
    check("Patch(facecolor=text_color, width=0.8" in source, "dual: spend legend draws a narrow bar")''',
)

TEST.write_text(text, encoding="utf-8")
print(f"patched assert_dual.py ({len(original)} -> {len(text)})")