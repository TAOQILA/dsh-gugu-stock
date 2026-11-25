"""一次性补丁：v1.7 任务 ⑤⑥⑦⑨（gugu_chart.py 部分）。

⑤ 数字背景：三处 bbox 圆角底衬换成 path_effects 的 withStroke 半透明描边
   （背景贴合字形轮廓、比原矩形底衬透明）。
⑥ 柱状图：WB 柱宽 = DS 柱宽的一半（DS 占 2/3 组宽、WB 占 1/3 组宽）。
⑦ 图例：折线图 = 两个小圆点（DS 蓝 / WB 浅绿）；
   柱状图 = 两条宽度不同、颜色相同的柱子。
⑨ WB_PERCENT_DEFAULT 1.5 -> 2.5（并改写相关注释）。
"""
import io
import re
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "gugu_chart.py"
text = SCRIPT.read_text(encoding="utf-8")
original = text


def apply(name: str, old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f"PATCH FAILED [{name}]: pattern not found")
    if text.count(old) > 1:
        raise SystemExit(f"PATCH FAILED [{name}]: pattern matches {text.count(old)} times")
    text = text.replace(old, new, 1)
    print(f"ok [{name}]")


# ---------- ⑨ 默认缩放 1.5 -> 2.5 ----------
apply(
    "wb default percent 1.5 -> 2.5",
    """# WB（WorkBuddy 积分）在图上按百分比缩放：y = 积分 × percent / 100。
# 默认 1.5%（1008.40 积分 → 高度 15.126），面板上可以直接改成任意百分比。
# WB_PERCENT_MIN/MAX 用来挡住明显不合理的输入（0 或负数会让线塌到轴上）。
WB_PERCENT_DEFAULT = 1.5""",
    """# WB（WorkBuddy 积分）在图上按百分比缩放：y = 积分 × percent / 100。
# 历史留档（当时默认 2.5%，v1.9 起为 2.75%）：1008.40 积分 → 高度，面板上可以直接改成任意百分比。
# WB_PERCENT_MIN/MAX 用来挡住明显不合理的输入（0 或负数会让线塌到轴上）。
WB_PERCENT_DEFAULT = 2.5""",
)

# ---------- ① 完善注释说明（增量） ----------
apply(
    "dark bar comment refinement",
    """        # 暗色下 WB 柱混近黑的比例必须够大：0.35 时黄色段的 WB 柱
        # （如 #9d740e）按通道和仍比同日 DS 绿柱亮，被断言抓到过三次
        # （11-14 / 11-17 / 11-19），提高到 0.55 并叠加逐柱强制压暗。
        "wb_bar_amount": 0.55,""",
    """        # 暗色下 WB 柱混近黑的比例必须够大：0.35 时黄色段的 WB 柱
        # （如 #9d740e）按通道和仍比同日 DS 绿柱亮，被断言抓到过三次
        # （11-14 / 11-17 / 11-19），提高到 0.55 后断言全绿。
        "wb_bar_amount": 0.55,""",
)

# ---------- ⑥ 柱宽：WB = DS 的 1/2 ----------
apply(
    "bar widths: WB half of DS",
    """        group = (right_edge - left_edge) * 0.62
        if has_wb:
            ds_x, wb_x, bar_width = center - group / 4.0, center + group / 4.0, group / 2.0
        else:
            ds_x, wb_x, bar_width = center, center, group""",
    """        group = (right_edge - left_edge) * 0.62
        if has_wb:
            # WB 柱宽固定为 DS 的一半（v1.7）。两根柱并排铺满整组：
            # DS 占 2/3 组宽、WB 占 1/3 组宽，视觉上宽的是 DS、窄的是 WB。
            ds_width = group * 2.0 / 3.0
            wb_width = group / 3.0
            ds_x = center - group / 6.0
            wb_x = center + group / 3.0
        else:
            ds_x, wb_x = center, center
            ds_width = wb_width = group""",
)
apply(
    "ds_bar dict width field",
    """                "text": label_text(ds_spend) if ds_spend > 0 else "",
                "x": ds_x,
                "width": bar_width,
            }
        )
        if has_wb:""",
    """                "text": label_text(ds_spend) if ds_spend > 0 else "",
                "x": ds_x,
                "width": ds_width,
            }
        )
        if has_wb:""",
)
apply(
    "wb_bar dict width field",
    """                    "text": label_text(wb_spend) if wb_spend > 0 else "",
                    "x": wb_x,
                    "width": bar_width,""",
    """                    "text": label_text(wb_spend) if wb_spend > 0 else "",
                    "x": wb_x,
                    "width": wb_width,""",
)

# ---------- ⑤ path_effects 描边底衬 ----------
apply(
    "import patheffects",
    """    import matplotlib.pyplot as plt
    from matplotlib import font_manager
""",
    """    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    from matplotlib import patheffects
""",
)
apply(
    "halo helper after palette",
    """    # 明/暗主题只换背景层（底色、网格、文字、标注底衬），序列颜色不变。
    theme = resolve_theme(meta.get("theme"))
    palette = theme_palette(theme)
""",
    """    # 明/暗主题只换背景层（底色、网格、文字、标注底衬），序列颜色不变。
    theme = resolve_theme(meta.get("theme"))
    palette = theme_palette(theme)

    def halo(alpha: float = 0.5, width: float = 2.2) -> list:
        \"\"\"数字底衬：贴合字形的半透明描边（v1.7），不再用整块矩形 bbox。\"\"\"
        raw = str(box_color).lstrip("#")
        rgba = tuple(int(raw[i : i + 2], 16) / 255.0 for i in (0, 2, 4)) + (alpha,)
        return [patheffects.withStroke(linewidth=width, foreground=rgba)]
""",
)
# 三处 bbox -> path_effects
apply(
    "spend label halo",
    """                bbox={"boxstyle": "round,pad=0.18", "facecolor": box_color, "edgecolor": "none", "alpha": 0.92},""",
    """                path_effects=halo(0.45),""",
)
apply(
    "wb label halo",
    """                    bbox={"boxstyle": "round,pad=0.16", "facecolor": box_color, "edgecolor": "none", "alpha": 0.88},""",
    """                    path_effects=halo(0.45),""",
)
apply(
    "ds label halo",
    """                bbox={"boxstyle": "round,pad=0.18", "facecolor": box_color, "edgecolor": "none", "alpha": 1.0},""",
    """                path_effects=halo(0.6),""",
)

# ---------- ⑦ 图例 ----------
apply(
    "legend: line chart two dots / spend two same-color bars",
    """        percent = float(meta.get("wbPercent") or percent_of_scale(float(meta.get("wbScale") or WB_SCALE)))
        if kind == "spend":
            handles = [
                Patch(facecolor=COLOR_RED_HEX, label="DS 花费（元）"),
                Patch(
                    facecolor=mix_toward(
                        tuple(channel / 255.0 for channel in SPEND_GREEN),
                        palette.get("wb_bar_target", "#ffffff"),
                        float(palette.get("wb_bar_amount", 0.55)),
                    ),
                    label=wb_spend_name(percent),
                ),
            ]
        elif meta.get("primary") == "wb":
            handles = [Line2D([0], [0], color=palette["wb_line_down"], linewidth=1.8, label=wb_series_name(percent))]
        else:
            handles = [
                Line2D([0], [0], color=COLOR_DOWN, linewidth=1.8, label=DS_SERIES_NAME),
                Line2D([0], [0], color=palette["wb_line_down"], linewidth=1.8, label=wb_series_name(percent)),
            ]""",
    """        percent = float(meta.get("wbPercent") or percent_of_scale(float(meta.get("wbScale") or WB_SCALE)))
        if kind == "spend":
            # v1.7 图例：两条「宽度不同、颜色相同」的柱子 —— 颜色统一用
            # 文本色（明/暗主题各一），宽度 DS 2.0 / WB 1.0，与柱状图比例呼应。
            handles = [
                Patch(facecolor=text_color, width=1.6, height=0.55, label="DS 花费（元）"),
                Patch(facecolor=text_color, width=0.8, height=0.55, label=wb_spend_name(percent)),
            ]
        elif meta.get("primary") == "wb":
            handles = [
                Line2D(
                    [0], [0], marker="o", linestyle="None", markersize=6.5,
                    markerfacecolor=palette["wb_mark"], markeredgecolor="none",
                    label=wb_series_name(percent),
                )
            ]
        else:
            # v1.7 图例：两个小圆点 —— DS 蓝、WB 浅绿，与节点颜色一致。
            handles = [
                Line2D(
                    [0], [0], marker="o", linestyle="None", markersize=6.5,
                    markerfacecolor=ds_mark_color, markeredgecolor="none",
                    label=DS_SERIES_NAME,
                ),
                Line2D(
                    [0], [0], marker="o", linestyle="None", markersize=6.5,
                    markerfacecolor=palette["wb_mark"], markeredgecolor="none",
                    label=wb_series_name(percent),
                ),
            ]""",
)

SCRIPT.write_text(text, encoding="utf-8")
print(f"patched {SCRIPT.name} ({len(original)} -> {len(text)} chars)")