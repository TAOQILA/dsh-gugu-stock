#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补丁 3：缺数据处断开折线、WB 数字避让（不和 DS 数字或彼此重叠）。"""
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "scripts" / "gugu_chart.py"
text = TARGET.read_text(encoding="utf-8")


def sub(old: str, new: str) -> None:
    global text
    assert old in text, f"未找到：\n{old[:200]}"
    text = text.replace(old, new, 1)


# ---- build：段数统计跳过「跨了空档」的连线 ----
sub(
    '    segments = {"up": 0, "down": 0, "flat": 0}\n'
    '    for previous, current in zip(points, points[1:]):\n'
    '        if current["y"] > previous["y"]:\n',
    '    segments = {"up": 0, "down": 0, "flat": 0}\n'
    '    for previous, current in zip(points, points[1:]):\n'
    '        if current["x"] - previous["x"] > GAP_SLOTS:\n'
    '            continue\n'
    '        if current["y"] > previous["y"]:\n',
)

sub(
    '    wb_segments = {"up": 0, "down": 0, "flat": 0}\n'
    '    for previous, current in zip(wb_points, wb_points[1:]):\n'
    '        if current["y"] > previous["y"]:\n',
    '    wb_segments = {"up": 0, "down": 0, "flat": 0}\n'
    '    for previous, current in zip(wb_points, wb_points[1:]):\n'
    '        if current["x"] - previous["x"] > GAP_SLOTS:\n'
    '            continue\n'
    '        if current["y"] > previous["y"]:\n',
)

# ---- 常量：间隔多大视为「中间没数据」 ----
sub(
    'WB_SCALE = 100.0\n',
    'WB_SCALE = 100.0\n'
    '# 相邻节点横向间隔超过这个值（单位=一格）说明中间几天没数据，折线断开而不是连过去\n'
    'GAP_SLOTS = 1.2\n',
)

# ---- render：主序列分段 + 颜色映射 ----
sub(
    '        segments, colors = [], []\n'
    '        for previous, current in zip(points, points[1:]):\n'
    '            segments.append([(previous["x"], previous["y"]), (current["x"], current["y"])])\n'
    '            if current["y"] > previous["y"]:\n'
    '                colors.append(up_color)\n'
    '            elif current["y"] < previous["y"]:\n'
    '                colors.append(down_color)\n'
    '            else:\n'
    '                colors.append(flat_color)\n',
    '        segments, colors = [], []\n'
    '        segment_colors: dict[int, str] = {}\n'
    '        for index in range(1, len(points)):\n'
    '            previous, current = points[index - 1], points[index]\n'
    '            if current["x"] - previous["x"] > GAP_SLOTS:\n'
    '                continue\n'
    '            segments.append([(previous["x"], previous["y"]), (current["x"], current["y"])])\n'
    '            if current["y"] > previous["y"]:\n'
    '                color = up_color\n'
    '            elif current["y"] < previous["y"]:\n'
    '                color = down_color\n'
    '            else:\n'
    '                color = flat_color\n'
    '            colors.append(color)\n'
    '            segment_colors[index] = color\n',
)

sub(
    '            marker_colors.append(colors[index - 1] if index > 0 else flat_color)\n',
    '            marker_colors.append(segment_colors.get(index, flat_color))\n',
)

# ---- render：WB 分段同样断开 ----
sub(
    '        wb_segments_list, wb_colors_list = [], []\n'
    '        for previous, current in zip(wb_raw, wb_raw[1:]):\n'
    '            wb_segments_list.append([(previous["x"], previous["y"]), (current["x"], current["y"])])\n'
    '            if current["y"] > previous["y"]:\n'
    '                wb_colors_list.append(COLOR_WB_UP)\n'
    '            elif current["y"] < previous["y"]:\n'
    '                wb_colors_list.append(COLOR_WB_DOWN)\n'
    '            else:\n'
    '                wb_colors_list.append(COLOR_WB_FLAT)\n',
    '        wb_segments_list, wb_colors_list = [], []\n'
    '        for previous, current in zip(wb_raw, wb_raw[1:]):\n'
    '            if current["x"] - previous["x"] > GAP_SLOTS:\n'
    '                continue\n'
    '            wb_segments_list.append([(previous["x"], previous["y"]), (current["x"], current["y"])])\n'
    '            if current["y"] > previous["y"]:\n'
    '                wb_colors_list.append(COLOR_WB_UP)\n'
    '            elif current["y"] < previous["y"]:\n'
    '                wb_colors_list.append(COLOR_WB_DOWN)\n'
    '            else:\n'
    '                wb_colors_list.append(COLOR_WB_FLAT)\n',
)

# ---- render：WB 数字避让 ----
sub(
    '            for item in wb_daily:\n'
    '                ax.annotate(\n'
    '                    item["text"],\n'
    '                    xy=(item["x"], item["y"]),\n'
    '                    xytext=(0, -12),\n',
    '            # 数字只在不和 DS 数字、也不和前一个 WB 数字挤在一起时才标\n'
    '            ds_label_xs = [item["x"] for item in (meta.get("labels") or [])]\n'
    '            taken_xs = sorted(ds_label_xs)\n'
    '            last_wb_label_x = None\n'
    '            for item in wb_daily:\n'
    '                if any(abs(item["x"] - x) < 0.14 for x in taken_xs):\n'
    '                    continue\n'
    '                if last_wb_label_x is not None and item["x"] - last_wb_label_x < 0.24:\n'
    '                    continue\n'
    '                last_wb_label_x = item["x"]\n'
    '                ax.annotate(\n'
    '                    item["text"],\n'
    '                    xy=(item["x"], item["y"]),\n'
    '                    xytext=(0, -12),\n',
)

TARGET.write_text(text, encoding="utf-8")
print("patched scripts/gugu_chart.py (pass 3)")