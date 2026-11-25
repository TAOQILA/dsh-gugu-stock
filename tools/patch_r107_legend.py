"""修 v1.7 ⑦ 花费图图例：Patch 不支持 width 参数，改成手工在坐标轴里画两根柱子。"""
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "gugu_chart.py"
text = SCRIPT.read_text(encoding="utf-8")


def apply(name: str, old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f"PATCH FAILED [{name}]: not found")
    if text.count(old) > 1:
        raise SystemExit(f"PATCH FAILED [{name}]: {text.count(old)} matches")
    text = text.replace(old, new, 1)
    print(f"ok [{name}]")


apply(
    "import Rectangle",
    """        from matplotlib.patches import Patch""",
    """        from matplotlib.patches import Rectangle""",
)

apply(
    "spend legend drawn manually",
    """        if kind == "spend":
            # v1.7 图例：两条「宽度不同、颜色相同」的柱子 —— 颜色统一用
            # 文本色（明/暗主题各一），宽度 DS 2.0 / WB 1.0，与柱状图比例呼应。
            handles = [
                Patch(facecolor=text_color, width=1.6, height=0.55, label="DS 花费（元）"),
                Patch(facecolor=text_color, width=0.8, height=0.55, label=wb_spend_name(percent)),
            ]""",
    """        if kind == "spend":
            # v1.7 图例：两条「宽度不同、颜色相同」的柱子。Patch 不能指定宽高，
            # 所以直接在坐标轴里手工画两个矩形（轴坐标），再各跟一段文字。
            bar_h = 0.030
            wide_w, narrow_w = 0.030, 0.015
            label_x = 0.012 + wide_w + 0.012
            for row, (bar_w, label) in enumerate(
                ((wide_w, "DS 花费（元）"), (narrow_w, wb_spend_name(percent)))
            ):
                y = 0.945 - row * 0.085
                ax.add_patch(
                    Rectangle(
                        (0.012, y - bar_h / 2.0),
                        bar_w,
                        bar_h,
                        transform=ax.transAxes,
                        facecolor=text_color,
                        edgecolor="none",
                        clip_on=False,
                        zorder=10,
                    )
                )
                ax.text(
                    label_x,
                    y,
                    label,
                    transform=ax.transAxes,
                    va="center",
                    ha="left",
                    fontsize=8.5,
                    color=text_color,
                    zorder=10,
                )
            handles = None""",
)

# handles 可能是 None：跳过 ax.legend
apply(
    "skip legend when handles None",
    """        legend = ax.legend(
            handles=handles,
            loc="upper left",
            frameon=False,
            fontsize=8.5,
            handlelength=1.6,
            borderaxespad=0.2,
        )
        for text_item in legend.get_texts():
            text_item.set_color(text_color)""",
    """        if handles:
            legend = ax.legend(
                handles=handles,
                loc="upper left",
                frameon=False,
                fontsize=8.5,
                handlelength=1.6,
                borderaxespad=0.2,
            )
            for text_item in legend.get_texts():
                text_item.set_color(text_color)""",
)

SCRIPT.write_text(text, encoding="utf-8")
print("patched gugu_chart.py legend")