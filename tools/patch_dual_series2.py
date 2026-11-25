#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补丁 2：允许窗口里出现「没有 DS 记录的日子」，并支持纯 WB 数据出图。

- 槽位可能没有主序列节点（例如某天只有 WB 记录），首尾裁切与每日末节点都要跳过空槽。
- DS 完全没有记录时，把 WB 当作主序列（仍按 1/100 缩放、仍显示积分原值）。
"""
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "scripts" / "gugu_chart.py"
text = TARGET.read_text(encoding="utf-8")


def sub(old: str, new: str) -> None:
    global text
    assert old in text, f"未找到：\n{old[:200]}"
    text = text.replace(old, new, 1)


# 1) 主序列选择（替换掉旧的「只有 WB 就把 WB 塞进 ds 桶」兜底）
sub(
    '    # 折线/柱状图的时间轴与「连续几天不动就并成一格」的规则都只看 DS 序列；\n'
    '    # WB 只是挂在同一根横轴上的第二条线，不参与合并判定。\n'
    '    by_day: dict[str, list[tuple[str, float]]] = {date: [] for date in window}\n'
    '    for date, time, _kind, value in ds_rows:\n'
    '        if date in by_day:\n'
    '            by_day[date].append((time, value))\n'
    '    if all(len(items) == 0 for items in by_day.values()):\n'
    '        # 区间内只有 WB 数据：用 WB 自己的记录撑起时间轴布局\n'
    '        for date, time, _kind, value in wb_rows:\n'
    '            if date in by_day:\n'
    '                by_day[date].append((time, value))\n'
    '\n',
    '    # 折线/柱状图的时间轴与「连续几天不动就并成一格」的规则以主序列为准：\n'
    '    # 有 DS 用 DS，只有 WB 时用 WB（仍然按 1/100 缩放、标签显示积分原值）。\n'
    '    primary = "ds" if ds_rows else "wb"\n'
    '    primary_rows = ds_rows if primary == "ds" else wb_rows\n'
    '    primary_scale = 1.0 if primary == "ds" else WB_SCALE\n'
    '    by_day: dict[str, list[tuple[str, float]]] = {date: [] for date in window}\n'
    '    for date, time, _kind, value in primary_rows:\n'
    '        if date in by_day:\n'
    '            by_day[date].append((time, value))\n'
    '\n',
)

# 2) 主序列节点：y 用缩放后的值，raw 保留原值供标签显示
sub(
    '            indices.append(len(points))\n'
    '            points.append({"date": date, "time": time, "balance": value, "x": x, "y": value})\n',
    '            indices.append(len(points))\n'
    '            points.append(\n'
    '                {\n'
    '                    "date": date,\n'
    '                    "time": time,\n'
    '                    "balance": value,\n'
    '                    "raw": value,\n'
    '                    "x": x,\n'
    '                    "y": value / primary_scale,\n'
    '                }\n'
    '            )\n',
)

# 3) 首尾裁切：跳过没有主序列节点的槽位
sub(
    '    first_slices = occupied([points[i]["x"] - 0 for i in slot_points[0]])\n'
    '    last_slot = len(slots) - 1\n'
    '    last_slices = occupied([points[i]["x"] - last_slot for i in slot_points[-1]])\n'
    '    x_min = first_slices[0] / SLICES\n'
    '    x_max = last_slot + (last_slices[-1] + 1) / SLICES\n'
    '    if len(slots) == 1:\n'
    '        # 只有一格时两端都作用在同一格上，别把自己裁没了\n'
    '        x_min = min(x_min, x_max - 1.0 / SLICES)\n',
    '    nonempty = [index for index, indices in enumerate(slot_points) if indices]\n'
    '    if not nonempty:\n'
    '        die(2, "GUGU_EMPTY 所选区间内没有可画的节点")\n'
    '    first_slot = nonempty[0]\n'
    '    last_slot = nonempty[-1]\n'
    '    first_slices = occupied([points[i]["x"] - first_slot for i in slot_points[first_slot]])\n'
    '    last_slices = occupied([points[i]["x"] - last_slot for i in slot_points[last_slot]])\n'
    '    x_min = first_slot + first_slices[0] / SLICES\n'
    '    x_max = last_slot + (last_slices[-1] + 1) / SLICES\n'
    '    if len(slots) == 1:\n'
    '        # 只有一格时两端都作用在同一格上，别把自己裁没了\n'
    '        x_min = min(x_min, x_max - 1.0 / SLICES)\n',
)

# 4) 标签用原始值（WB 缩放后仍显示积分原值）
sub(
    '                "text": label_text(points[index]["balance"]),\n',
    '                "text": label_text(points[index].get("raw", points[index]["balance"])),\n',
)

# 5) 每日末节点 / 峰谷判定跳过空槽
sub(
    '    for slot_index, slot in enumerate(slots):\n'
    '        index = slot_points[slot_index][-1]\n',
    '    for slot_index, slot in enumerate(slots):\n'
    '        if not slot_points[slot_index]:\n'
    '            continue\n'
    '        slot = slots[slot_index]\n'
    '        index = slot_points[slot_index][-1]\n',
)

sub(
    '    slot_first_last = [(indices[0], indices[-1]) for indices in slot_points]\n',
    '    slot_first_last = [(indices[0], indices[-1]) for indices in slot_points if indices]\n',
)

# 6) WB 只作为第二条线（主序列已经是 WB 时不再重复画）
sub(
    '    wb_points: list[dict] = []\n'
    '    for date, time, _kind, value in wb_rows:\n',
    '    wb_points: list[dict] = []\n'
    '    for date, time, _kind, value in (wb_rows if primary == "ds" else []):\n',
)

# 7) meta 记录主序列
sub(
    '        "kind": "line",\n'
    '        "days": len(window),\n',
    '        "kind": "line",\n'
    '        "primary": primary,\n'
    '        "days": len(window),\n',
)

# 8) 渲染：主序列为 WB 时用浅色板
sub(
    '    if kind != "spend":\n'
    '        segments, colors = [], []\n'
    '        for previous, current in zip(points, points[1:]):\n'
    '            segments.append([(previous["x"], previous["y"]), (current["x"], current["y"])])\n'
    '            if current["y"] > previous["y"]:\n'
    '                colors.append(COLOR_UP)\n'
    '            elif current["y"] < previous["y"]:\n'
    '                colors.append(COLOR_DOWN)\n'
    '            else:\n'
    '                colors.append(COLOR_FLAT)\n',
    '    if kind != "spend":\n'
    '        if meta.get("primary") == "wb":\n'
    '            up_color, down_color, flat_color = COLOR_WB_UP, COLOR_WB_DOWN, COLOR_WB_FLAT\n'
    '        else:\n'
    '            up_color, down_color, flat_color = COLOR_UP, COLOR_DOWN, COLOR_FLAT\n'
    '        segments, colors = [], []\n'
    '        for previous, current in zip(points, points[1:]):\n'
    '            segments.append([(previous["x"], previous["y"]), (current["x"], current["y"])])\n'
    '            if current["y"] > previous["y"]:\n'
    '                colors.append(up_color)\n'
    '            elif current["y"] < previous["y"]:\n'
    '                colors.append(down_color)\n'
    '            else:\n'
    '                colors.append(flat_color)\n',
)

sub(
    '            marker_colors.append(colors[index - 1] if index > 0 else COLOR_FLAT)\n',
    '            marker_colors.append(colors[index - 1] if index > 0 else flat_color)\n',
)

# 9) 图例：主序列是 WB 时只画 WB 那条
sub(
    '        handles = [\n'
    '            Line2D([0], [0], color=COLOR_DOWN, linewidth=1.8, label=DS_SERIES_NAME),\n'
    '            Line2D([0], [0], color=COLOR_WB_DOWN, linewidth=1.8, label=WB_SERIES_NAME),\n'
    '        ]\n',
    '        if meta.get("primary") == "wb":\n'
    '            handles = [Line2D([0], [0], color=COLOR_WB_DOWN, linewidth=1.8, label=WB_SERIES_NAME)]\n'
    '        else:\n'
    '            handles = [\n'
    '                Line2D([0], [0], color=COLOR_DOWN, linewidth=1.8, label=DS_SERIES_NAME),\n'
    '                Line2D([0], [0], color=COLOR_WB_DOWN, linewidth=1.8, label=WB_SERIES_NAME),\n'
    '            ]\n',
)

TARGET.write_text(text, encoding="utf-8")
print("patched scripts/gugu_chart.py (pass 2)")