#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补丁 4：合并格里不标 WB 数字；花费图双柱标签错开；花费图图例改用色块并说明是花费。"""
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "scripts" / "gugu_chart.py"
text = TARGET.read_text(encoding="utf-8")


def sub(old: str, new: str) -> None:
    global text
    assert old in text, f"未找到：\n{old[:200]}"
    text = text.replace(old, new, 1)


# 1) WB 每日末节点带上「这一格是不是合并格」
sub(
    '                    "x": point["x"],\n'
    '                    "y": point["y"],\n'
    '                    "text": label_text(point["value"]),\n'
    '                }\n'
    '            )\n',
    '                    "x": point["x"],\n'
    '                    "y": point["y"],\n'
    '                    "text": label_text(point["value"]),\n'
    '                    "merged": len(slots[slot_index]["days"]) > 1,\n'
    '                }\n'
    '            )\n',
)

# 2) 合并格里 WB 不标数字（横轴被压缩，标了也挤在一起）
sub(
    '            for item in wb_daily:\n'
    '                if any(abs(item["x"] - x) < 0.14 for x in taken_xs):\n',
    '            for item in wb_daily:\n'
    '                if item.get("merged"):\n'
    '                    continue\n'
    '                if any(abs(item["x"] - x) < 0.14 for x in taken_xs):\n',
)

# 3) 花费图双柱的数字左右错开，免得叠在一起
sub(
    '        for bar in meta["bars"]:\n'
    '            if not bar["text"]:\n'
    '                continue\n'
    '            ax.annotate(\n'
    '                bar["text"],\n'
    '                xy=(bar["x"], bar.get("height", bar["value"])),\n'
    '                xytext=(0, 7 if crowded else 9),\n'
    '                textcoords="offset points",\n'
    '                ha="center",\n',
    '        for bar in meta["bars"]:\n'
    '            if not bar["text"]:\n'
    '                continue\n'
    '            is_wb = bar.get("series") == "wb"\n'
    '            ax.annotate(\n'
    '                bar["text"],\n'
    '                xy=(bar["x"], bar.get("height", bar["value"])),\n'
    '                xytext=(5, 7 if crowded else 9) if is_wb else (-5, 7 if crowded else 9),\n'
    '                textcoords="offset points",\n'
    '                ha="left" if is_wb else "right",\n',
)

# 4) 图例：花费图用色块 + 花费文案
sub(
    '    if meta.get("withWb"):\n'
    '        from matplotlib.lines import Line2D\n'
    '\n'
    '        if meta.get("primary") == "wb":\n',
    '    if meta.get("withWb"):\n'
    '        from matplotlib.lines import Line2D\n'
    '        from matplotlib.patches import Patch\n'
    '\n'
    '        if kind == "spend":\n'
    '            handles = [\n'
    '                Patch(facecolor=COLOR_RED_HEX, label="DS 花费（元）"),\n'
    '                Patch(facecolor=mix_with_white(SPEND_GREEN, 0.55), label="WB 花费（积分 ÷100）"),\n'
    '            ]\n'
    '        elif meta.get("primary") == "wb":\n',
)

sub(
    'COLOR_WB_FLAT = "#e4e4e4"   # WB 持平：比 DS 更浅的灰\n',
    'COLOR_WB_FLAT = "#e4e4e4"   # WB 持平：比 DS 更浅的灰\n'
    'COLOR_RED_HEX = "#d64545"\n',
)

TARGET.write_text(text, encoding="utf-8")
print("patched scripts/gugu_chart.py (pass 4)")