#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性补丁：让 gugu_chart.py 支持 3 列 CSV（时间,ds/wb,数值）与双序列。

用法：py -3.12 tools/patch_dual_series.py
（脚本会就地修改 scripts/gugu_chart.py，并在每个替换处断言命中，避免静默改错。）
"""
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "scripts" / "gugu_chart.py"
text = TARGET.read_text(encoding="utf-8")


def sub(old: str, new: str, count: int = 1) -> None:
    global text
    assert text.count(old) >= count, f"未找到待替换片段：\n{old[:200]}"
    text = text.replace(old, new, count)


# ---------------------------------------------------------------- 常量
sub(
    'SPEND_RED = (214, 69, 69)    # 花费最多 → 纯红\n'
    'SPEND_MID = (240, 196, 0)    # 花费居中 → 黄\n'
    'SPEND_GREEN = (26, 156, 91)  # 花费最少 → 纯绿\n',
    'SPEND_RED = (214, 69, 69)    # 花费最多 → 纯红\n'
    'SPEND_MID = (240, 196, 0)    # 花费居中 → 黄\n'
    'SPEND_GREEN = (26, 156, 91)  # 花费最少 → 纯绿\n'
    '\n'
    '# WB（WorkBuddy 积分）在图上按 1/100 缩放：1008.40 积分 → 高度 10.084，\n'
    '# 和 DS 余额（个位数~几十元）落在同一量级，两条线才看得出相对走势。\n'
    'WB_SCALE = 100.0\n'
    'COLOR_WB_UP = "#f0a8a8"     # WB 上升：浅红\n'
    'COLOR_WB_DOWN = "#9bd8bb"   # WB 下降：浅绿\n'
    'COLOR_WB_FLAT = "#e4e4e4"   # WB 持平：比 DS 更浅的灰\n'
    'WB_SERIES_NAME = "WB 积分（÷100）"\n'
    'DS_SERIES_NAME = "DS 余额（元）"\n',
)

# ---------------------------------------------------------------- label_text
sub(
    'def label_text(value: float) -> str:\n'
    '    """节点上显示的数值：四舍五入到 1 位小数（CSV 与纵轴保留真实小数）。"""\n'
    '    rounded = math.floor(float(value) * 10 + 0.5) / 10\n'
    '    return f"{rounded:.1f}"\n',
    'def label_text(value: float) -> str:\n'
    '    """节点上显示的数值：最多 1 位小数，整数就显示整数（1008.40 → 1008.4，1008 → 1008）。"""\n'
    '    rounded = math.floor(float(value) * 10 + 0.5) / 10\n'
    '    if abs(rounded - round(rounded)) < 1e-9:\n'
    '        return str(int(round(rounded)))\n'
    '    return f"{rounded:.1f}"\n',
)

# ---------------------------------------------------------------- parse_rows
sub(
    'def parse_rows(csv_path: str) -> list[tuple[str, str, float]]:\n'
    '    """Return [(date, time, balance)] sorted ascending by time."""\n'
    '    text = read_text(csv_path)\n'
    '    rows: list[tuple[str, str, float]] = []\n'
    '    for cells in csv.reader(text.splitlines()):\n'
    '        if len(cells) < 2:\n'
    '            continue\n'
    '        stamp = cells[0].strip()\n'
    '        if stamp in ("时间", "time", ""):\n'
    '            continue\n'
    '        match = TIME_RE.match(stamp)\n'
    '        if not match:\n'
    '            continue\n'
    '        year, month, day, hour, minute = (int(match.group(i)) for i in range(1, 6))\n'
    '        try:\n'
    '            value = float(cells[1].strip().replace("¥", "").replace("￥", "").replace(",", ""))\n'
    '        except ValueError:\n'
    '            continue\n'
    '        date = f"{year:04d}-{month:02d}-{day:02d}"\n'
    '        time = f"{hour:02d}:{minute:02d}"\n'
    '        rows.append((date, time, value))\n'
    '    rows.sort(key=lambda row: (row[0], row[1]))\n'
    '    return rows\n',
    'def parse_rows(csv_path: str) -> list[tuple[str, str, str, float]]:\n'
    '    """Return [(date, time, kind, value)] sorted ascending by (date, time).\n'
    '\n'
    '    3 列格式（时间,ds/wb,数值）按第 2 列区分 DS 余额与 WB 积分；\n'
    '    旧的 2 列格式（时间,余额）当作 ds，保证老文件还能画。\n'
    '    """\n'
    '    text = read_text(csv_path)\n'
    '    rows: list[tuple[str, str, str, float]] = []\n'
    '    for cells in csv.reader(text.splitlines()):\n'
    '        if len(cells) < 2:\n'
    '            continue\n'
    '        stamp = cells[0].strip()\n'
    '        if stamp in ("时间", "time", ""):\n'
    '            continue\n'
    '        match = TIME_RE.match(stamp)\n'
    '        if not match:\n'
    '            continue\n'
    '        year, month, day, hour, minute = (int(match.group(i)) for i in range(1, 6))\n'
    '        if len(cells) >= 3:\n'
    '            marker = cells[1].strip().lower()\n'
    '            if marker not in ("ds", "wb"):\n'
    '                continue\n'
    '            kind = marker\n'
    '            raw = cells[2]\n'
    '        else:\n'
    '            kind = "ds"\n'
    '            raw = cells[1]\n'
    '        try:\n'
    '            value = float(raw.strip().replace("¥", "").replace("￥", "").replace(",", ""))\n'
    '        except ValueError:\n'
    '            continue\n'
    '        date = f"{year:04d}-{month:02d}-{day:02d}"\n'
    '        time = f"{hour:02d}:{minute:02d}"\n'
    '        rows.append((date, time, kind, value))\n'
    '    rows.sort(key=lambda row: (row[0], row[1], row[2]))\n'
    '    return rows\n',
)

# ---------------------------------------------------------------- 日期函数解包
sub(
    'def pick_window(rows: list[tuple[str, str, float]], max_days: int) -> list[str]:\n'
    '    days: list[str] = []\n'
    '    for date, _time, _value in rows:\n',
    'def pick_window(rows: list[tuple[str, str, str, float]], max_days: int) -> list[str]:\n'
    '    days: list[str] = []\n'
    '    for date, _time, _kind, _value in rows:\n',
)
sub(
    'def all_days(rows: list[tuple[str, str, float]]) -> list[str]:\n'
    '    days: list[str] = []\n'
    '    for date, _time, _value in rows:\n',
    'def all_days(rows: list[tuple[str, str, str, float]]) -> list[str]:\n'
    '    days: list[str] = []\n'
    '    for date, _time, _kind, _value in rows:\n',
)
sub(
    'def select_window(\n'
    '    rows: list[tuple[str, str, float]],\n',
    'def select_window(\n'
    '    rows: list[tuple[str, str, str, float]],\n',
)
sub(
    'def daily_finals(rows: list[tuple[str, str, float]]) -> dict[str, float]:\n'
    '    """每一天的最后一条余额（rows 升序，后写覆盖前写）。"""\n'
    '    finals: dict[str, float] = {}\n'
    '    for date, _time, value in rows:\n'
    '        finals[date] = value\n'
    '    return finals\n',
    'def daily_finals(rows: list[tuple[str, str, str, float]], kind: str = "ds") -> dict[str, float]:\n'
    '    """某一条线每一天的最后一条数值（rows 升序，后写覆盖前写）。"""\n'
    '    finals: dict[str, float] = {}\n'
    '    for date, _time, row_kind, value in rows:\n'
    '        if row_kind == kind:\n'
    '            finals[date] = value\n'
    '    return finals\n',
)

# ---------------------------------------------------------------- build 头部
sub(
    'def build(\n'
    '    csv_path: str,\n'
    '    max_days: int,\n'
    '    kind: str = "line",\n'
    '    date_from: str | None = None,\n'
    '    date_to: str | None = None,\n'
    ') -> dict:\n'
    '    rows = parse_rows(csv_path)\n'
    '    if not rows:\n'
    '        die(2, "GUGU_EMPTY 没有可画的数据")\n'
    '    window = select_window(rows, date_from, date_to, max_days)\n'
    '    if not window:\n'
    '        die(2, "GUGU_RANGE 所选日期区间内没有数据")\n'
    '    by_day: dict[str, list[tuple[str, float]]] = {date: [] for date in window}\n'
    '    for date, time, value in rows:\n'
    '        if date in by_day:\n'
    '            by_day[date].append((time, value))\n'
    '\n'
    '    if kind == "spend":\n'
    '        layout = compute_time_layout(window, by_day)\n'
    '        return build_spend(rows, window, layout)\n',
    'def build(\n'
    '    csv_path: str,\n'
    '    max_days: int,\n'
    '    kind: str = "line",\n'
    '    date_from: str | None = None,\n'
    '    date_to: str | None = None,\n'
    '    with_wb: bool = True,\n'
    ') -> dict:\n'
    '    rows = parse_rows(csv_path)\n'
    '    if not rows:\n'
    '        die(2, "GUGU_EMPTY 没有可画的数据")\n'
    '    window = select_window(rows, date_from, date_to, max_days)\n'
    '    if not window:\n'
    '        die(2, "GUGU_RANGE 所选日期区间内没有数据")\n'
    '\n'
    '    ds_rows = [row for row in rows if row[2] == "ds"]\n'
    '    wb_rows = [row for row in rows if row[2] == "wb"] if with_wb else []\n'
    '    if not ds_rows and not wb_rows:\n'
    '        die(2, "GUGU_EMPTY 没有可画的数据")\n'
    '\n'
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
    '\n'
    '    if kind == "spend":\n'
    '        layout = compute_time_layout(window, by_day)\n'
    '        return build_spend(rows, window, layout, with_wb=with_wb)\n',
)

# ---------------------------------------------------------------- build 主体：WB 点
sub(
    '    slots = build_slots(window, by_day)\n'
    '\n'
    '    points: list[dict] = []\n',
    '    slots = build_slots(window, by_day)\n'
    '\n'
    '    points: list[dict] = []\n',
)

sub(
    '    daily_last = []\n'
    '    last_indices = []\n',
    '    # ---- WB 序列：同一根横轴，纵值按 1/100 缩放，标签仍显示积分原值 ----\n'
    '    slot_of_date: dict[str, tuple[int, int]] = {}\n'
    '    for slot_index, slot in enumerate(slots):\n'
    '        for offset, date in enumerate(slot["days"]):\n'
    '            slot_of_date[date] = (slot_index, offset)\n'
    '    wb_points: list[dict] = []\n'
    '    for date, time, _kind, value in wb_rows:\n'
    '        if date not in slot_of_date:\n'
    '            continue\n'
    '        slot_index, offset = slot_of_date[date]\n'
    '        span = len(slots[slot_index]["days"])\n'
    '        if span == 1:\n'
    '            x = slot_index + day_fraction(time)\n'
    '        else:\n'
    '            x = slot_index + (offset + day_fraction(time)) / span\n'
    '        wb_points.append(\n'
    '            {"date": date, "time": time, "value": value, "x": x, "y": value / WB_SCALE}\n'
    '        )\n'
    '    wb_points.sort(key=lambda item: item["x"])\n'
    '\n'
    '    wb_daily_last: list[dict] = []\n'
    '    if wb_points:\n'
    '        by_date_last: dict[str, dict] = {}\n'
    '        for point in wb_points:\n'
    '            by_date_last[point["date"]] = point\n'
    '        for date in [day for day in window if day in by_date_last]:\n'
    '            point = by_date_last[date]\n'
    '            slot_index, _offset = slot_of_date[date]\n'
    '            wb_daily_last.append(\n'
    '                {\n'
    '                    "date": date,\n'
    '                    "label": slot_label(slots[slot_index]),\n'
    '                    "value": point["value"],\n'
    '                    "x": point["x"],\n'
    '                    "y": point["y"],\n'
    '                    "text": label_text(point["value"]),\n'
    '                }\n'
    '            )\n'
    '\n'
    '    wb_segments = {"up": 0, "down": 0, "flat": 0}\n'
    '    for previous, current in zip(wb_points, wb_points[1:]):\n'
    '        if current["y"] > previous["y"]:\n'
    '            wb_segments["up"] += 1\n'
    '        elif current["y"] < previous["y"]:\n'
    '            wb_segments["down"] += 1\n'
    '        else:\n'
    '            wb_segments["flat"] += 1\n'
    '\n'
    '    daily_last = []\n'
    '    last_indices = []\n',
)

# ylim 要把 WB 的缩放值算进去
sub(
    '    lo, hi = axis_bounds([point["y"] for point in points])\n',
    '    all_y = [point["y"] for point in points] + [point["y"] for point in wb_points]\n'
    '    lo, hi = axis_bounds(all_y if all_y else [0.0])\n',
)

# 返回值补充 WB 元数据
sub(
    '    return {\n'
    '        "ok": True,\n'
    '        "kind": "line",\n'
    '        "days": len(window),\n'
    '        "slots": len(slots),\n'
    '        "points": len(points),\n',
    '    return {\n'
    '        "ok": True,\n'
    '        "kind": "line",\n'
    '        "days": len(window),\n'
    '        "slots": len(slots),\n'
    '        "points": len(points),\n'
    '        "withWb": bool(wb_points),\n'
    '        "wbPoints": len(wb_points),\n'
    '        "wbScale": WB_SCALE,\n'
    '        "wbDailyLast": wb_daily_last,\n'
    '        "wbSegments": wb_segments,\n'
    '        "wbRaw": wb_points,\n',
)

sub(
    '        "segments": segments,\n'
    '        "min": min(point["y"] for point in points),\n'
    '        "max": max(point["y"] for point in points),\n',
    '        "segments": segments,\n'
    '        "min": min(all_y),\n'
    '        "max": max(all_y),\n',
)

# ---------------------------------------------------------------- spend
sub(
    'def spend_by_day(rows: list[tuple[str, str, float]]) -> dict[str, float]:\n',
    'def spend_by_day(rows: list[tuple[str, str, str, float]], kind: str = "ds") -> dict[str, float]:\n',
)
sub(
    '    spend: dict[str, float] = {}\n'
    '    previous: float | None = None\n'
    '    for date, _time, value in rows:\n'
    '        if previous is not None and previous > value:\n',
    '    spend: dict[str, float] = {}\n'
    '    previous: float | None = None\n'
    '    for date, _time, row_kind, value in rows:\n'
    '        if row_kind != kind:\n'
    '            continue\n'
    '        if previous is not None and previous > value:\n',
)

sub(
    'def build_spend(rows: list[tuple[str, str, float]], window: list[str], layout: dict) -> dict:\n'
    '    """每天一根柱子，柱子的红绿深浅按当天花费在区间内的相对高低来定。"""\n'
    '    totals = spend_by_day(rows)\n'
    '\n'
    '    bars = []\n'
    '    for index, date in enumerate(window):\n'
    '        spend = totals.get(date, 0.0)\n'
    '        left_edge = layout["xMin"] if index == 0 else float(index)\n'
    '        right_edge = layout["xMax"] if index == len(window) - 1 else float(index + 1)\n'
    '        bars.append(\n'
    '            {\n'
    '                "date": date,\n'
    '                "label": date[5:],\n'
    '                "value": spend,\n'
    '                "text": label_text(spend) if spend > 0 else "",\n'
    '                "x": (left_edge + right_edge) / 2,\n'
    '                "width": (right_edge - left_edge) * 0.62,\n'
    '            }\n'
    '        )\n'
    '\n'
    '    max_spend = max((bar["value"] for bar in bars), default=0.0)\n'
    '    min_spend = min((bar["value"] for bar in bars), default=0.0)\n'
    '    for bar in bars:\n'
    '        bar["color"] = "#%02x%02x%02x" % tuple(\n'
    '            int(round(channel * 255)) for channel in spend_color(bar["value"], min_spend, max_spend)\n'
    '        )\n'
    '    hi = max(float(AXIS_STEP), float(math.ceil(max_spend / AXIS_STEP) * AXIS_STEP))\n',
    'def mix_with_white(rgb: tuple[float, float, float], amount: float) -> str:\n'
    '    """把颜色往白色混，amount=0 原色、1 全白；用来让 WB 的柱子明显更浅。"""\n'
    '    blended = tuple(channel * (1.0 - amount) + 1.0 * amount for channel in rgb)\n'
    '    return "#%02x%02x%02x" % tuple(int(round(channel * 255)) for channel in blended)\n'
    '\n'
    '\n'
    'def build_spend(\n'
    '    rows: list[tuple[str, str, str, float]],\n'
    '    window: list[str],\n'
    '    layout: dict,\n'
    '    with_wb: bool = True,\n'
    ') -> dict:\n'
    '    """每天一组柱子：DS 一根、WB 一根（浅色）。红绿深浅按当天花费在区间内的相对高低。"""\n'
    '    ds_totals = spend_by_day(rows, "ds")\n'
    '    wb_totals = spend_by_day(rows, "wb") if with_wb else {}\n'
    '    has_wb = any(wb_totals.get(date, 0.0) > 0 for date in window) or bool(\n'
    '        [1 for row in rows if row[2] == "wb" and window[0] <= row[0] <= window[-1]]\n'
    '    ) if with_wb else False\n'
    '\n'
    '    ds_bars = []\n'
    '    wb_bars = []\n'
    '    for index, date in enumerate(window):\n'
    '        left_edge = layout["xMin"] if index == 0 else float(index)\n'
    '        right_edge = layout["xMax"] if index == len(window) - 1 else float(index + 1)\n'
    '        center = (left_edge + right_edge) / 2\n'
    '        group = (right_edge - left_edge) * 0.62\n'
    '        if has_wb:\n'
    '            ds_x, wb_x, bar_width = center - group / 4.0, center + group / 4.0, group / 2.0\n'
    '        else:\n'
    '            ds_x, wb_x, bar_width = center, center, group\n'
    '        ds_spend = ds_totals.get(date, 0.0)\n'
    '        ds_bars.append(\n'
    '            {\n'
    '                "series": "ds",\n'
    '                "date": date,\n'
    '                "label": date[5:],\n'
    '                "value": ds_spend,\n'
    '                "height": ds_spend,\n'
    '                "text": label_text(ds_spend) if ds_spend > 0 else "",\n'
    '                "x": ds_x,\n'
    '                "width": bar_width,\n'
    '            }\n'
    '        )\n'
    '        if has_wb:\n'
    '            wb_spend = wb_totals.get(date, 0.0)\n'
    '            wb_bars.append(\n'
    '                {\n'
    '                    "series": "wb",\n'
    '                    "date": date,\n'
    '                    "label": date[5:],\n'
    '                    "value": wb_spend,\n'
    '                    "height": wb_spend / WB_SCALE,\n'
    '                    "text": label_text(wb_spend) if wb_spend > 0 else "",\n'
    '                    "x": wb_x,\n'
    '                    "width": bar_width,\n'
    '                }\n'
    '            )\n'
    '\n'
    '    max_spend = max((bar["height"] for bar in ds_bars), default=0.0)\n'
    '    min_spend = min((bar["height"] for bar in ds_bars), default=0.0)\n'
    '\n'
    '    def paint(bars: list[dict], lighten: float) -> None:\n'
    '        low = min((bar["height"] for bar in bars), default=0.0)\n'
    '        high = max((bar["height"] for bar in bars), default=0.0)\n'
    '        for bar in bars:\n'
    '            rgb = spend_color(bar["height"], low, high)\n'
    '            bar["color"] = mix_with_white(rgb, lighten) if lighten > 0 else "#%02x%02x%02x" % tuple(\n'
    '                int(round(channel * 255)) for channel in rgb\n'
    '            )\n'
    '\n'
    '    paint(ds_bars, 0.0)\n'
    '    paint(wb_bars, 0.55)\n'
    '\n'
    '    bars = ds_bars + wb_bars\n'
    '    max_height = max([bar["height"] for bar in bars] + [0.0])\n'
    '    max_spend = max(max_spend, max_height)\n'
    '    hi = max(float(AXIS_STEP), float(math.ceil(max_height / AXIS_STEP) * AXIS_STEP))\n',
)

sub(
    '        "bars": bars,\n'
    '        "total": round(sum(bar["value"] for bar in bars), 6),\n'
    '        "min": min_spend,\n'
    '        "max": max_spend,\n'
    '    }\n',
    '        "bars": bars,\n'
    '        "dsBars": ds_bars,\n'
    '        "wbBars": wb_bars,\n'
    '        "withWb": has_wb,\n'
    '        "wbScale": WB_SCALE,\n'
    '        "total": round(sum(bar["value"] for bar in ds_bars), 6),\n'
    '        "wbTotal": round(sum(bar["value"] for bar in wb_bars), 6),\n'
    '        "min": min_spend,\n'
    '        "max": max_spend,\n'
    '    }\n',
)

# ---------------------------------------------------------------- render: 柱状
sub(
    '    if kind == "spend":\n'
    '        for bar in meta["bars"]:\n'
    '            ax.bar(\n'
    '                bar["x"],\n'
    '                bar["value"],\n'
    '                width=bar["width"],\n'
    '                color=bar.get("color", "#7c8fb3"),\n'
    '                edgecolor="none",\n'
    '                zorder=3,\n'
    '            )\n'
    '        for bar in meta["bars"]:\n'
    '            if not bar["text"]:\n'
    '                continue\n'
    '            ax.annotate(\n'
    '                bar["text"],\n'
    '                xy=(bar["x"], bar["value"]),\n'
    '                xytext=(0, 7 if crowded else 9),\n',
    '    if kind == "spend":\n'
    '        for bar in meta["bars"]:\n'
    '            ax.bar(\n'
    '                bar["x"],\n'
    '                bar.get("height", bar["value"]),\n'
    '                width=bar["width"],\n'
    '                color=bar.get("color", "#7c8fb3"),\n'
    '                edgecolor="none",\n'
    '                zorder=3,\n'
    '            )\n'
    '        for bar in meta["bars"]:\n'
    '            if not bar["text"]:\n'
    '                continue\n'
    '            ax.annotate(\n'
    '                bar["text"],\n'
    '                xy=(bar["x"], bar.get("height", bar["value"])),\n'
    '                xytext=(0, 7 if crowded else 9),\n',
)

# ---------------------------------------------------------------- render: 折线 WB
sub(
    '        for item in meta.get("labels") or meta.get("dailyLast") or []:\n',
    '        # ---- WB：浅色折线 + 每日最终节点 ----\n'
    '        wb_raw = meta.get("wbRaw") or []\n'
    '        wb_segments_list, wb_colors_list = [], []\n'
    '        for previous, current in zip(wb_raw, wb_raw[1:]):\n'
    '            wb_segments_list.append([(previous["x"], previous["y"]), (current["x"], current["y"])])\n'
    '            if current["y"] > previous["y"]:\n'
    '                wb_colors_list.append(COLOR_WB_UP)\n'
    '            elif current["y"] < previous["y"]:\n'
    '                wb_colors_list.append(COLOR_WB_DOWN)\n'
    '            else:\n'
    '                wb_colors_list.append(COLOR_WB_FLAT)\n'
    '        if wb_segments_list:\n'
    '            ax.add_collection(\n'
    '                LineCollection(wb_segments_list, colors=wb_colors_list, linewidths=1.3, capstyle="round", zorder=2)\n'
    '            )\n'
    '        wb_daily = meta.get("wbDailyLast") or []\n'
    '        if wb_daily:\n'
    '            ax.scatter(\n'
    '                [item["x"] for item in wb_daily],\n'
    '                [item["y"] for item in wb_daily],\n'
    '                s=26,\n'
    '                c=COLOR_WB_DOWN,\n'
    '                edgecolors="#ffffff",\n'
    '                linewidths=1.0,\n'
    '                zorder=4,\n'
    '            )\n'
    '            for item in wb_daily:\n'
    '                ax.annotate(\n'
    '                    item["text"],\n'
    '                    xy=(item["x"], item["y"]),\n'
    '                    xytext=(0, -12),\n'
    '                    textcoords="offset points",\n'
    '                    ha="center",\n'
    '                    va="top",\n'
    '                    rotation=45 if crowded else 0,\n'
    '                    rotation_mode="anchor",\n'
    '                    fontsize=7 if crowded else 7.5,\n'
    '                    color="#8a8a8a",\n'
    '                    bbox={"boxstyle": "round,pad=0.16", "facecolor": "#ffffff", "edgecolor": "none", "alpha": 0.88},\n'
    '                )\n'
    '\n'
    '        for item in meta.get("labels") or meta.get("dailyLast") or []:\n',
)

# 图例
sub(
    '    title = "谷谷股 · 花费柱状图" if kind == "spend" else "谷谷股 · 余额折线图"\n',
    '    if meta.get("withWb"):\n'
    '        from matplotlib.lines import Line2D\n'
    '\n'
    '        handles = [\n'
    '            Line2D([0], [0], color=COLOR_DOWN, linewidth=1.8, label=DS_SERIES_NAME),\n'
    '            Line2D([0], [0], color=COLOR_WB_DOWN, linewidth=1.8, label=WB_SERIES_NAME),\n'
    '        ]\n'
    '        legend = ax.legend(\n'
    '            handles=handles,\n'
    '            loc="upper left",\n'
    '            frameon=False,\n'
    '            fontsize=8.5,\n'
    '            handlelength=1.6,\n'
    '            borderaxespad=0.2,\n'
    '        )\n'
    '        for text_item in legend.get_texts():\n'
    '            text_item.set_color(TEXT)\n'
    '    title = "谷谷股 · 花费柱状图" if kind == "spend" else "谷谷股 · 余额折线图"\n',
)

# max_x/min_x 要把 WB 点算进去（否则 WB 超出一格时被裁）
sub(
    '    if points:\n'
    '        max_x = max(point["x"] for point in points)\n'
    '        min_x = min(point["x"] for point in points)\n',
    '    wb_xs = [point["x"] for point in (meta.get("wbRaw") or [])]\n'
    '    if points:\n'
    '        max_x = max([point["x"] for point in points] + wb_xs)\n'
    '        min_x = min([point["x"] for point in points] + wb_xs)\n',
)

# ---------------------------------------------------------------- main 参数
sub(
    '    parser.add_argument("--json", action="store_true", help="stdout 输出 GUGU_RESULT <json>")\n',
    '    parser.add_argument("--with-wb", dest="with_wb", choices=("0", "1"), default="1", help="是否把 WB 积分画成第二条线（默认 1）")\n'
    '    parser.add_argument("--json", action="store_true", help="stdout 输出 GUGU_RESULT <json>")\n',
)
sub(
    '        meta = build(args.csv, args.max_days, args.kind, args.date_from, args.date_to)\n',
    '        meta = build(\n'
    '            args.csv, args.max_days, args.kind, args.date_from, args.date_to, args.with_wb != "0"\n'
    '        )\n',
)

TARGET.write_text(text, encoding="utf-8")
print("patched scripts/gugu_chart.py")