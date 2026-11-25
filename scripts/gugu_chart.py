#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
谷谷股折线图生成器（标准库 + matplotlib，不依赖 DSH）。

用法:
  python gugu_chart.py --csv balances.csv --out chart.png [--max-days 60] [--json] [--meta meta.json]

输出:
  - PNG 折线图
  - stdout 一行 `GUGU_RESULT <json>`（--json 时），JSON 同时写 --meta 文件

退出码:
  0 成功 / 2 没有可画的数据 / 3 缺少 matplotlib / 1 其它错误
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
import math
import os
import re
import sys
import traceback

COLOR_DOWN = "#1a9c5b"   # 下降：绿
COLOR_UP = "#d64545"     # 上升：红
COLOR_FLAT = "#c8c8c8"   # 持平：浅灰
# 历史上这里有个 SLICES = 8：把每天切成 8 份、只画有数据的那几份，用来裁掉
# 首/末日两端的空白。按用户要求（m03986）该机制已彻底删除 —— 现在每天固定占
# 一整格，横轴从第一天 0 点到最后一天 24 点，不做任何分片裁切。
SPEND_HEADROOM = 1.22  # 花费图轴顶留给图例的空白带（柱子最高只到 1/1.22 ≈ 0.82）
GRID_STEP = 10
AXIS_STEP = 10  # 纵轴上下限贴近 10 的倍数（25 → 10，用户 m08518）
# 图表主题：明 / 暗 / 自动（auto 由调用方解析成 light 或 dark 再传进来）。
# 每个主题只换「底色 + 文字 + 网格」这些背景层，序列本身的红/绿/蓝/浅绿保持不变。
THEME_DEFAULT = "auto"
THEME_NAMES = ("light", "dark")
THEMES = {
    "light": {
        "bg": "#ffffff",
        "frame": "#e3e3e3",
        "day_line": "#e9e9e9",
        "grid_major": "#e4e4e4",
        "text": "#4a4a4a",
        "title": "#222222",
        "label_box": "#ffffff",
        "ds_mark": "#2563c9",
        "ds_text": "#2563c9",
        "wb_mark": "#7bc9a0",
        "wb_text": "#3f9e73",
        # WB 在明色底上永远比 DS 浅（浅红/浅绿/浅灰 + 混白）。
        "wb_line_up": "#f0a8a8",
        "wb_line_down": "#9bd8bb",
        "wb_line_flat": "#e4e4e4",
        "wb_bar_target": "#ffffff",
        "wb_bar_amount": 0.55,
        # 阿里云卡券走橙红系（m07048：橙红而非正橙）：和 DS 蓝、WB 绿都拉开色相距离。
        # 明色底用偏深的橙红保证白底对比度；change 模式下线/柱走红绿灰基准，
        # 这些 aliyun_line_* 只作主题变体参考；source 模式节点/线用 aliyun_mark。
        "aliyun_mark": "#e8461a",
        "aliyun_text": "#d13a10",
        "aliyun_line_up": "#f04e23",
        "aliyun_line_down": "#c2330d",
        "aliyun_line_flat": "#e8c0b0",
        "aliyun_bar_target": "#ffd4c0",
        "aliyun_bar_amount": 0.55,
        # Tokens 消耗（v1.19）：紫色。它不是余额，涨跌语义不适用，所以线段/柱子
        # 在两种颜色模式下都用这一个颜色，不参与 red/green/flat 判定。
        "ut_mark": "#7c3aed",
        "ut_text": "#6d28d9",
        "ut_bar_target": "#ede9fe",
        "ut_bar_amount": 0.55,
    },
    "dark": {
        "bg": "#1c1e22",
        "frame": "#3c3f45",
        "day_line": "#2c2f34",
        "grid_major": "#33363b",
        "text": "#c8cbd0",
        "title": "#f2f3f5",
        "label_box": "#1c1e22",
        "ds_mark": "#7fb2f5",
        "ds_text": "#8fbcf7",
        # 暗色底上反过来：WB 必须比 DS 更深（深红/深绿/深灰 + 混黑），
        # 但仍要能看清，所以不是压到纯黑，而是压到深色调。
        "wb_mark": "#3f9e73",
        "wb_text": "#46a87c",
        "wb_line_up": "#8c3a3a",
        "wb_line_down": "#14724a",
        "wb_line_flat": "#4a4d52",
        "wb_bar_target": "#0b0d10",
        # 暗色下 WB 柱混近黑的比例必须够大：0.35 时黄色段的 WB 柱
        # （如 #9d740e）按通道和仍比同日 DS 绿柱亮，被断言抓到过三次
        # （11-14 / 11-17 / 11-19），提高到 0.55 后断言全绿。
        "wb_bar_amount": 0.55,
        # 暗色底上的阿里云（m07048 橙红系）：亮橙红节点 + 深棕柱，醒目且不与 WB 深绿混淆。
        "aliyun_mark": "#ff6b3d",
        "aliyun_text": "#ff8a5c",
        "aliyun_line_up": "#ff7a4d",
        "aliyun_line_down": "#e0501f",
        "aliyun_line_flat": "#6b4a3d",
        "aliyun_bar_target": "#5a2c08",
        "aliyun_bar_amount": 0.45,
        # 暗色底上的紫：亮紫节点，保证在 #1c1e22 上够醒目。
        "ut_mark": "#a78bfa",
        "ut_text": "#bba3ff",
        "ut_bar_target": "#241a38",
        "ut_bar_amount": 0.45,
    },
}
# 序列的固定顺序：画图、图例、柱状图排布都按这个顺序来。
# ut（v1.19）= 本机所有 DSH 会话（含已归档会话）累计消耗的 token 总量，单位 token。
SERIES_ORDER = ("ds", "wb", "aliyun", "ut")
# 余额型序列：画的是 CSV 里的原值（按百分比缩放）。
LEVEL_SERIES = ("ds", "wb", "aliyun")
# 消耗型序列：CSV 里存的是「累计值」，图上画的是「当日增量」。
TOKEN_SERIES = "ut"
SERIES_LABELS = {"ds": "DS 余额", "wb": "WB 积分", "aliyun": "阿里云卡券", "ut": "Tokens 消耗"}
# m07048：增减(change)模式下柱子的颜色按花费高低（红黄绿热力），
# 数据源靠花纹区分——DS 纯色、WB 斜线、阿里云圆点。
SERIES_HATCH = {"ds": "", "wb": "///", "aliyun": "...", "ut": ""}
# CSV 第 2 列的别名：阿里云写成短名 `al`，内部仍叫 aliyun。
CSV_KIND_ALIASES = {"al": "aliyun"}
# 每条序列的「高度缩放百分比」：y = value * scale / 100。
# 默认 DS=100（元）、WB=3.25%（积分）、阿里云=12.5%（元）。
# 余额型三条是百分比；ut 是 divisor（每 1 个纵轴单位 = 多少 token），
# 因为 8 亿 token 用百分比要写成 0.0001% 这种没法看的数字。
SCALE_DEFAULTS = {"ds": 100.0, "wb": 3.25, "aliyun": 12.5, "ut": 12500000.0}
SCALE_MIN = 0.01
SCALE_MAX = 10000.0
UT_DIVISOR_MIN = 1000.0
UT_DIVISOR_MAX = 1000000000.0
# 默认（明色）调色板；render 里按 meta["theme"] 覆盖成实际主题。
BG = THEMES["light"]["bg"]
FRAME = THEMES["light"]["frame"]
DAY_LINE = THEMES["light"]["day_line"]  # 每日开头/结尾的竖向分隔线
TEXT = THEMES["light"]["text"]
TITLE = THEMES["light"]["title"]
SPEND_RED = (214, 69, 69)    # 花费最多 → 纯红
SPEND_MID = (240, 196, 0)    # 花费居中 → 黄
SPEND_GREEN = (26, 156, 91)  # 花费最少 → 纯绿

# WB（WorkBuddy 积分）在图上按百分比缩放：y = 积分 × percent / 100。
# 默认 3.25%（1008.40 积分 → 高度 32.77），面板上可以直接改成任意百分比。
# 老参数 --wb-percent 仍然写在这个区间里；--scale-wb 是它的新名字。
# 三条序列的百分比默认值集中在 SCALE_DEFAULTS（ds=100 / wb=3.25 / aliyun=12.5）。
WB_PERCENT_DEFAULT = SCALE_DEFAULTS["wb"]
WB_PERCENT_MIN = 0.1
WB_PERCENT_MAX = 20.0
WB_SCALE = 100.0 / WB_PERCENT_DEFAULT
# 相邻两个节点只要都有有效数值就必须连线。历史上这里有个 GAP_SLOTS=1.2
# 的启发式：两点横向距离超过 1.2 格就当「缺数据」不画线。但那会把真实的
# 相邻节点误判成断点（例如 11-16 最后一个节点 06:15 与 11-17 第一个节点
# 20:06 相距 1.58 格，其实是连续两天），线就凭空消失了。数据缺口的表达
# 交给「没有节点」本身，而不是靠删除连线，因此该阈值已移除。
# WB 的线段颜色现在按主题取（明色底「比 DS 浅」、暗色底「比 DS 深」），
# 下面三个常量只保留作明色主题的默认值参考，render 不再直接使用。
COLOR_WB_UP = "#f0a8a8"     # WB 上升（明色）：浅红
COLOR_WB_DOWN = "#9bd8bb"   # WB 下降（明色）：浅绿
COLOR_WB_FLAT = "#e4e4e4"   # WB 持平（明色）：浅灰
COLOR_RED_HEX = "#d64545"
# 数字与节点按序列上色：DS 一律蓝、WB 一律浅绿（线段仍按涨跌红/绿/灰）。
COLOR_DS_MARK = "#2563c9"
COLOR_WB_MARK = "#7bc9a0"
# 阿里云卡券（第三条序列）：橙红系，明/暗两套主题分别取色（见 THEMES 的 aliyun_mark）
COLOR_ALIYUN_MARK = "#e8461a"
COLOR_UT_MARK = "#7c3aed"   # Tokens 消耗：紫（v1.19）
DS_SERIES_NAME = "DS 余额（元）"


def percent_text(percent: float) -> str:
    """1.5 → '1.5%'，2.0 → '2%'：整数不拖 .0，最多留两位小数。"""
    text = f"{percent:.2f}".rstrip("0").rstrip(".")
    return text + "%"


def wb_series_name(percent: float) -> str:
    return f"WB 积分（{percent_text(percent)}）"


def wb_spend_name(percent: float) -> str:
    return f"WB 花费（积分 {percent_text(percent)}）"


def aliyun_spend_name(percent: float) -> str:
    return f"阿里云花费（元 {percent_text(percent)}）"


def percent_of_scale(scale: float) -> float:
    return round(100.0 / scale, 4)


def scale_factor(percent: float) -> float:
    """百分比 → 乘数：100 → 1.0、3.25 → 0.0325（y = value × factor）。"""
    return float(percent) / 100.0


def sanitize_scale(value, fallback: float) -> float:
    """--scale-* 的百分比：非法/缺省退回 fallback，正数夹进 [SCALE_MIN, SCALE_MAX]。"""
    try:
        percent = float(value)
    except (TypeError, ValueError):
        return float(fallback)
    if not math.isfinite(percent) or percent <= 0:
        return float(fallback)
    return min(SCALE_MAX, max(SCALE_MIN, percent))


def parse_sources(value) -> set[str] | None:
    """把 --sources 的逗号列表解析成集合；忽略空项与未知项。

    返回 None 表示「没给 / 给了但一个有效名都没有」，调用方按旧行为处理。
    """
    if value is None:
        return None
    if isinstance(value, (set, list, tuple)):
        items = [str(item) for item in value]
    else:
        text = str(value).strip()
        if not text:
            return None
        items = text.split(",")
    wanted = {item.strip().lower() for item in items if item and item.strip()}
    wanted &= set(SERIES_ORDER)
    return wanted or None


def resolve_sources(value, with_wb: bool = True) -> dict[str, bool]:
    """决定哪几条序列要画。

    - 不传 --sources：旧行为 —— ds 恒开、wb 由 --with-wb 决定、aliyun 关。
    - 传了 --sources：只画列出的序列（可乱序、可只给子集）。
    - 传 dict（内部调用）：按 dict 里的布尔值。
    """
    if isinstance(value, dict):
        return {name: bool(value.get(name)) for name in SERIES_ORDER}
    wanted = parse_sources(value)
    if wanted is None:
        return {"ds": True, "wb": bool(with_wb), "aliyun": False, "ut": False}
    return {name: name in wanted for name in SERIES_ORDER}


def sanitize_scale_for(name: str, value, fallback: float) -> float:
    """按序列类型校验缩放值：余额型是百分比，ut 是 divisor（每格多少 token）。"""
    if name == TOKEN_SERIES:
        try:
            divisor = float(value)
        except (TypeError, ValueError):
            return float(fallback)
        if not math.isfinite(divisor) or divisor <= 0:
            return float(fallback)
        return min(UT_DIVISOR_MAX, max(UT_DIVISOR_MIN, divisor))
    return sanitize_scale(value, fallback)


def resolve_scales(scales, wb_scale: float) -> dict[str, float]:
    """决定每条序列各自的缩放：余额型是百分比（y = value × percent / 100），
    ut 是 divisor（y = value / divisor）。"""
    values = dict(scales) if isinstance(scales, dict) else {}
    if values.get("wb") is None:
        values["wb"] = percent_of_scale(wb_scale) if wb_scale else SCALE_DEFAULTS["wb"]
    return {name: sanitize_scale_for(name, values.get(name), SCALE_DEFAULTS[name]) for name in SERIES_ORDER}


def divisor_text(divisor: float) -> str:
    """"10 万 tokens" / "3.5 亿 tokens" 这类人话，图例上用它。"""
    value = float(divisor)
    if value >= 1e8:
        return f"{value / 1e8:g} 亿 tokens"
    if value >= 1e4:
        return f"{value / 1e4:g} 万 tokens"
    return f"{value:g} tokens"


def ut_series_name(divisor: float) -> str:
    return "Tokens 消耗"


def ut_spend_name(divisor: float) -> str:
    return "Tokens 消耗"


# 图上数字统一用粗粒度中文单位（用户 m12402）：取「不超过它的最大单位」，
# 系数向下取整。732万→7百万、4876万→4千万、1亿1578万→1亿1千万、
# 554万→5百万、57万→57万、1376→1千、167→1百、67→67。
COARSE_UNITS = (
    ("亿", 100000000),
    ("千万", 10000000),
    ("百万", 1000000),
    ("万", 10000),
    ("千", 1000),
    ("百", 100),
)


def coarse_whole(total: int) -> str:
    for unit, scale in COARSE_UNITS:
        if total >= scale:
            head = total // scale
            rest = total - head * scale
            # 「亿」的余数再走一遍（1亿1578万 → 1亿1千万），更细的尾数直接丢掉。
            return f"{head}{unit}" + (coarse_whole(rest) if unit == "亿" and rest else "")
    return str(total)


def coarse_label(value: float) -> str:
    number = float(value or 0.0)
    if number < 0:
        return "-" + coarse_label(-number)
    return coarse_whole(int(math.floor(number + 0.5)))


def token_label(value: float) -> str:
    """Tokens 消耗（紫色）专用：取不超过数值的最大单位、系数向下取整。

    7,320,000 → 7百万、48,760,000 → 4千万、115,780,000 → 1亿1千万、1,376 → 1千、
    167 → 1百、67 → 67。CSV 里仍是原值，只有显示被压缩。
    """
    return coarse_label(value)


def ds_series_name(percent: float) -> str:
    return DS_SERIES_NAME if abs(percent - 100.0) < 1e-9 else f"DS 余额（{percent_text(percent)}）"


def aliyun_series_name(percent: float) -> str:
    return f"阿里云卡券（{percent_text(percent)}）"


COLOR_MODE_CHANGE = "change"   # 按涨跌着色：涨红、跌绿、平灰
COLOR_MODE_SOURCE = "source"   # 按数据源着色：DS 蓝、WB 绿、阿里云橙
COLOR_MODES = (COLOR_MODE_CHANGE, COLOR_MODE_SOURCE)
COLOR_MODE_DEFAULT = COLOR_MODE_CHANGE


def resolve_color_mode(value) -> str:
    """把外部传进来的折线颜色模式收敛到合法值。"""
    if isinstance(value, str):
        candidate = value.strip().lower()
        if candidate in COLOR_MODES:
            return candidate
    return COLOR_MODE_DEFAULT


def series_line_colors(palette: dict, name: str, mode: str = COLOR_MODE_CHANGE) -> tuple[str, str, str]:
    """某条序列的涨/跌/平线段颜色。

    - change（默认）：DS 与阿里云都用基准红绿灰（m07048：阿里云的线在增减
      模式下必须按涨跌着色），WB 仍用主题里的浅红/浅绿/浅灰变体；
    - source：整条线固定用该数据源的标记色（DS 蓝 / WB 绿 / 阿里云橙红），
      三个颜色相同即表现为一条纯色线。
    """
    if name == TOKEN_SERIES:
        # ut 画的是「当天消耗了多少 token」，不是余额，涨跌语义不适用：
        # 两种颜色模式下都固定紫色（用户 m09984 要的就是一条紫线）。
        mark = palette.get("ut_mark", COLOR_UT_MARK)
        return mark, mark, mark
    if resolve_color_mode(mode) == COLOR_MODE_SOURCE:
        mark = palette.get(f"{name}_mark", COLOR_DS_MARK)
        return mark, mark, mark
    if name in ("ds", "aliyun"):
        # m07048：阿里云与 DS 一样按涨跌的红/绿/灰，不再是橙色变体。
        return COLOR_UP, COLOR_DOWN, COLOR_FLAT
    return (
        palette.get(f"{name}_line_up", COLOR_UP),
        palette.get(f"{name}_line_down", COLOR_DOWN),
        palette.get(f"{name}_line_flat", COLOR_FLAT),
    )


def count_segments(points: list[dict]) -> dict:
    """相邻节点两两比较，统计涨/跌/平段数。"""
    segments = {"up": 0, "down": 0, "flat": 0}
    for previous, current in zip(points, points[1:]):
        if current["y"] > previous["y"]:
            segments["up"] += 1
        elif current["y"] < previous["y"]:
            segments["down"] += 1
        else:
            segments["flat"] += 1
    return segments


def last_value(rows: list[tuple[str, str, str, float]], kind: str, window: list[str]):
    """窗口内某条序列最后一个原始值（未乘缩放）；没有该序列时返回 None。"""
    if not window:
        return None
    low, high = window[0], window[-1]
    found = None
    for date, _time, row_kind, value in rows:
        if row_kind == kind and low <= date <= high:
            found = value
    return found


def clampa_percent(value: float) -> float:
    """把用户填的百分比夹到 [WB_PERCENT_MIN, WB_PERCENT_MAX]，非法值退回默认。"""
    try:
        percent = float(value)
    except (TypeError, ValueError):
        return WB_PERCENT_DEFAULT
    if not math.isfinite(percent) or percent <= 0:
        return WB_PERCENT_DEFAULT
    return min(WB_PERCENT_MAX, max(WB_PERCENT_MIN, percent))

TIME_RE = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?")


def label_text(value: float) -> str:
    """余额类序列（DS / WB / 阿里云）图上显示的数字：四舍五入到整数、纯阿拉伯数字。

    用户 m12655：粗粒度中文单位**只给紫色的 Tokens 消耗用**，其余三条序列回到
    1008 / 24 / 67 这种纯数字（1008.40 → 1008，23.6 → 24，-0.4 → 0）。
    """
    return str(int(math.floor(float(value) + 0.5)))


def resolve_theme(value: str) -> str:
    """auto/空 → light；light/dark 原样；其它值退回 light。"""
    text = str(value or "").strip().lower()
    return text if text in THEME_NAMES else "light"


def theme_palette(name: str) -> dict:
    return THEMES[resolve_theme(name)]


def die(code: int, message: str) -> "None":
    print(message, file=sys.stderr)
    raise SystemExit(code)


def read_text(csv_path: str) -> str:
    with open(csv_path, "rb") as fh:
        raw = fh.read()
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw.decode("utf-8-sig")
    for encoding in ("utf-8", "gbk", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def parse_rows(csv_path: str) -> list[tuple[str, str, str, float]]:
    """Return [(date, time, kind, value)] sorted ascending by (date, time).

    3 列格式（时间,来源,数值）按第 2 列区分 DS 余额 / WB 积分 / 阿里云卡券；
    旧的 2 列格式（时间,余额）当作 ds，保证老文件还能画。
    """
    text = read_text(csv_path)
    rows: list[tuple[str, str, str, float]] = []
    for cells in csv.reader(text.splitlines()):
        if len(cells) < 2:
            continue
        stamp = cells[0].strip()
        if stamp in ("时间", "time", ""):
            continue
        match = TIME_RE.match(stamp)
        if not match:
            continue
        year, month, day, hour, minute = (int(match.group(i)) for i in range(1, 6))
        if len(cells) >= 3:
            marker = cells[1].strip().lower()
            # CSV 里阿里云一列写短名 `al`（旧版本可能写过 `aliyun`），内部序列名仍是 aliyun。
            marker = CSV_KIND_ALIASES.get(marker, marker)
            if marker not in SERIES_ORDER:
                continue
            kind = marker
            raw = cells[2]
        else:
            kind = "ds"
            raw = cells[1]
        try:
            value = float(raw.strip().replace("¥", "").replace("￥", "").replace(",", ""))
        except ValueError:
            continue
        date = f"{year:04d}-{month:02d}-{day:02d}"
        time = f"{hour:02d}:{minute:02d}"
        rows.append((date, time, kind, value))
    rows.sort(key=lambda row: (row[0], row[1], row[2]))
    return rows


def day_fraction(time: str) -> float:
    """把 "HH:MM" 映射到当天的位置：12:00 -> 0.5，23:30 -> 0.979。

    横轴按真实时间校准，所以一天固定占 1 格（24 小时），记录少的那天也不会
    被摊开，记录多的一天会自然挤在一起。
    """
    hour, minute = (int(part) for part in time.split(":")[:2])
    return (hour * 60 + minute) / (24 * 60)


def pick_window(rows: list[tuple[str, str, str, float]], max_days: int) -> list[str]:
    days: list[str] = []
    for date, _time, _kind, _value in rows:
        if not days or days[-1] != date:
            days.append(date)
    return days[-max_days:] if max_days > 0 else days


def all_days(rows: list[tuple[str, str, str, float]]) -> list[str]:
    days: list[str] = []
    for date, _time, _kind, _value in rows:
        if not days or days[-1] != date:
            days.append(date)
    return days


def select_window(
    rows: list[tuple[str, str, str, float]],
    date_from: str | None,
    date_to: str | None,
    max_days: int,
) -> list[str]:
    """决定横轴要画哪几天：给了起止日期就按区间，否则回退到最近 max_days 天。"""
    days = all_days(rows)
    if not days:
        return []
    if date_from or date_to:
        low = date_from or days[0]
        high = date_to or days[-1]
        return [date for date in days if low <= date <= high]
    return days[-max_days:] if max_days > 0 else days


def daily_finals(rows: list[tuple[str, str, str, float]], kind: str = "ds") -> dict[str, float]:
    """某一条线每一天的最后一条数值（rows 升序，后写覆盖前写）。"""
    finals: dict[str, float] = {}
    for date, _time, row_kind, value in rows:
        if row_kind == kind:
            finals[date] = value
    return finals


UT_ROW_MAX = 1500000000  # 跑旧代码的实例会把整个累计值写进一行；增量不可能到 15 亿


def ut_daily(rows: list[tuple[str, str, str, float]]) -> dict[str, dict]:
    """ut 折成「每天的 token 消耗量」。

    从 v1.21 起 CSV 里的 ut 行存的是**两次采样之间的增量**（不是累计），所以：
    当天消耗 = 当天所有增量相加；日内曲线 = 从 00:00 的 0 一条条加上去
    （所以每天 00:00 一定是 0，第二天再从头累）。``total`` 是从头累计到当天结束
    的总量，用来画「总消耗」与做校验。
    """
    series = [
        (date, time, value)
        for date, time, kind, value in rows
        if kind == TOKEN_SERIES and float(value) <= UT_ROW_MAX
    ]
    if not series:
        return {}
    per_day: dict[str, list[tuple[str, float]]] = {}
    for date, time, value in series:
        per_day.setdefault(date, []).append((time, float(value)))
    out: dict[str, dict] = {}
    running = 0.0
    for date in sorted(per_day):
        entries = per_day[date]
        points: list[tuple[str, float]] = [("00:00:00", 0.0)]
        acc = 0.0
        for time, delta in entries:
            # 增量行不该是负数；真有负数（老数据/手工改动）就当 0，别把总量拉低。
            acc += delta if delta > 0 else 0.0
            acc = round(acc, 6)
            if points and points[-1][0] == time:
                points[-1] = (time, acc)
            else:
                points.append((time, acc))
        day_total = points[-1][1]
        running = round(running + day_total, 6)
        out[date] = {
            "value": day_total,
            "time": entries[-1][0],
            "total": running,
            "points": points,
            "baseline": round(running - day_total, 6),
        }
    return out


def ut_day_info(tokens_daily: dict[str, dict], date: str) -> dict:
    """取某一天的 ut 数据；**这一天没有 ut 采样也返回 0**（用户 m12026）。

    用户要的是「把之前的日期也补上、无数据也得是 0」——所以图上 ut 的线/柱
    覆盖整个时间窗，没采过样（或还没装 v1.19）的日子就是一条贴 0 的线、一根
    高度 0 的柱子，而不是干脆不画。
    """
    info = tokens_daily.get(date)
    if info:
        return info
    return {
        "value": 0.0,
        "time": None,
        "total": None,
        "points": [("00:00:00", 0.0)],
        "baseline": None,
    }


def bar_height(name: str, value: float, scales: dict) -> float:
    """柱子/节点高度：余额型按百分比缩放，ut 按 divisor 折算。"""
    if name == TOKEN_SERIES:
        divisor = float(scales.get(TOKEN_SERIES) or SCALE_DEFAULTS[TOKEN_SERIES])
        return value / max(1e-9, divisor)
    return value / (100.0 / float(scales.get(name) or SCALE_DEFAULTS.get(name, 100.0)))


def compute_time_layout(
    window: list[str], by_day: dict[str, list[tuple[str, float]]]
) -> dict:
    """按真实时钟排布横轴：一天一整格，两端都不裁。

    横轴范围固定是 [0, 天数]；第 i 天的刻度落在 i+0.5。首/末日哪怕只有一条
    凌晨的记录，那一整格也照常保留（用户 m03986 要求删掉 8 分片裁切机制）。
    """
    ticks = [index + 0.5 for index in range(len(window))]
    return {
        "xMin": 0.0,
        "xMax": float(len(window)),
        "trimLeft": False,
        "trimRight": False,
        "ticks": ticks,
    }


def axis_bounds(values: list[float]) -> tuple[float, float]:
    lo = float(math.floor(min(values) / AXIS_STEP) * AXIS_STEP)
    hi = float(math.ceil(max(values) / AXIS_STEP) * AXIS_STEP)
    # 余额贴着 0 但略微为负（-0.011989 这种分位浮点噪声）时，floor 会把纵轴
    # 拉到 -10，底部留出一整格空白（用户 m15687）。只要最低值还在 0 的
    # 十分之一步以内，就认为它就是 0，纵轴从 0 起。真的跌穿（-5 之类）时
    # 仍然按 10 的倍数向下取整，负余额照样看得见。
    if lo < 0 and min(values) > -AXIS_STEP / 10:
        lo = 0.0
    if hi - lo < AXIS_STEP:
        # A flat (or single-point) series would sit exactly on the frame; give it
        # one step of air above and below so the line and its dots stay visible.
        lo = max(0.0, lo - AXIS_STEP)
        hi = hi + AXIS_STEP
    return lo, hi


def build_slots(window: list[str], by_day: dict[str, list[tuple[str, float]]]) -> list[dict]:
    """横轴一格 = 一天，永远不合并。

    早期版本会把「连续几天余额一动不动」的日期压成一格并标成
    `MM-DD~MM-DD`，但那样横轴就不再是完整的日期表了；现在每天都占
    等宽的 1 格、标签只写 `MM-DD`，哪怕几天数值完全一样也逐日画出。
    """
    return [{"days": [date], "value": None} for date in window]


def slot_label(slot: dict) -> str:
    return slot["days"][0][5:]


def tick_labels(dates: list[str]) -> list[str]:
    """横轴刻度文字：每个月只在它出现的第一天写 `MM-DD`，同月其余日期只写 `DD`。

    这样 13 天的图里只有最左边那个 `11-10` 带月份，后面全是 `11`、`12`…
    读起来更短，也不会每格都重复同一个月份。跨月时（比如 10 月末到 11 月初）
    新月份再次出现的第一天会重新带上 `MM-DD`。
    """
    labels: list[str] = []
    last_month = None
    for date in dates:
        month = date[:7]
        labels.append(date[5:] if month != last_month else date[8:])
        last_month = month
    return labels


def build(
    csv_path: str,
    max_days: int,
    kind: str = "line",
    date_from: str | None = None,
    date_to: str | None = None,
    with_wb: bool = True,
    wb_scale: float = WB_SCALE,
    theme: str = THEME_DEFAULT,
    sources=None,
    scales=None,
    color_mode: str = COLOR_MODE_DEFAULT,
) -> dict:
    rows = parse_rows(csv_path)
    if not rows:
        die(2, "GUGU_EMPTY 没有可画的数据")
    window = select_window(rows, date_from, date_to, max_days)
    if not window:
        die(2, "GUGU_RANGE 所选日期区间内没有数据")

    # 哪几条序列要画、每条各自缩放多少：CLI 的 --sources / --scale-* 在这里生效。
    wanted = resolve_sources(sources, with_wb)
    percents = resolve_scales(scales, wb_scale)
    series_rows = {name: [row for row in rows if row[2] == name] for name in SERIES_ORDER}
    # 余额型序列照常按原值画；ut 是累计值，先折成每日消耗再画。
    active = [name for name in LEVEL_SERIES if wanted[name] and series_rows[name]]
    tokens_daily = ut_daily(rows) if wanted[TOKEN_SERIES] else {}
    # 整个窗口都画 ut：没采过样的日子按 0 处理（用户 m12026），不再只画有数据的几天。
    tokens_days = list(window) if wanted[TOKEN_SERIES] else []
    drawn_all = active + ([TOKEN_SERIES] if tokens_days else [])
    if not drawn_all:
        die(2, "GUGU_EMPTY 启用的序列里没有可画的数据")

    # 折线/柱状图的时间轴以主序列为准：有 DS 用 DS，否则 WB、再否则阿里云
    # （纵值按各自百分比缩放、标签仍显示原值）。横轴每天一格，不做任何合并。
    # 只剩 ut 开着时，ut 自己当主序列（每天一个节点，画的是当天消耗量）。
    primary = active[0] if active else TOKEN_SERIES
    by_day: dict[str, list[tuple[str, float]]] = {date: [] for date in window}
    if primary == TOKEN_SERIES:
        primary_rows = []
        primary_scale = float(percents[TOKEN_SERIES])
        for date in tokens_days:
            for point_time, point_value in ut_day_info(tokens_daily, date)["points"]:
                by_day[date].append((point_time, point_value))
    else:
        primary_rows = series_rows[primary]
        primary_scale = 100.0 / percents[primary]
        for date, time, _kind, value in primary_rows:
            if date in by_day:
                by_day[date].append((time, value))

    if kind == "total":
        return build_total(
            rows,
            window,
            with_wb=with_wb,
            wb_scale=wb_scale,
            theme=theme,
            sources=wanted,
            scales=percents,
            color_mode=color_mode,
        )

    if kind == "spend":
        layout = compute_time_layout(window, by_day)
        return build_spend(
            rows,
            window,
            layout,
            with_wb=with_wb,
            wb_scale=wb_scale,
            theme=theme,
            sources=wanted,
            scales=percents,
            color_mode=color_mode,
        )

    slots = build_slots(window, by_day)

    points: list[dict] = []
    slot_points: list[list[int]] = []
    for slot_index, slot in enumerate(slots):
        entries = [(date, time, value) for date in slot["days"] for time, value in by_day[date]]
        indices: list[int] = []
        total = max(1, len(entries))
        for order, (date, time, value) in enumerate(entries):
            if len(slot["days"]) == 1:
                # 一格一天：节点按真实时钟落在这一格里的对应位置
                x = slot_index + day_fraction(time)
            else:
                # 兜底（当前不会走到）：多天组按顺序在格内均匀铺开
                x = slot_index + (order + 0.5) / total
            indices.append(len(points))
            points.append(
                {
                    "date": date,
                    "time": time,
                    "balance": value,
                    "raw": value,
                    "x": x,
                    "y": value / primary_scale,
                }
            )
        slot_points.append(indices)

    if not any(slot_points):
        die(2, "GUGU_EMPTY 所选区间内没有可画的节点")

    # 一天一整格，从第一天 0 点到最后一天 24 点，两端都不裁（m03986）。
    x_min = 0.0
    x_max = float(len(slots))
    ticks = [slot_index + 0.5 for slot_index in range(len(slots))]
    labels_x = [slot_label(slot) for slot in slots]
    trim_left = False
    trim_right = False

    segments = {"up": 0, "down": 0, "flat": 0}
    for previous, current in zip(points, points[1:]):
        if current["y"] > previous["y"]:
            segments["up"] += 1
        elif current["y"] < previous["y"]:
            segments["down"] += 1
        else:
            segments["flat"] += 1

    # ---- 其余启用的序列：同一根横轴，纵值按各自百分比缩放，标签仍显示原值 ----
    slot_of_date: dict[str, tuple[int, int]] = {}
    for slot_index, slot in enumerate(slots):
        for offset, date in enumerate(slot["days"]):
            slot_of_date[date] = (slot_index, offset)
    series_lines: list[dict] = []
    secondary_points: dict[str, list[dict]] = {}
    secondary_last: dict[str, list[dict]] = {}
    segments_by_series: dict[str, dict] = {primary: segments}
    for name in active[1:]:
        scale_value = 100.0 / percents[name]
        points_out: list[dict] = []
        for date, time, _kind, value in series_rows[name]:
            if date not in slot_of_date:
                continue
            slot_index, offset = slot_of_date[date]
            span = len(slots[slot_index]["days"])
            if span == 1:
                x = slot_index + day_fraction(time)
            else:
                x = slot_index + (offset + day_fraction(time)) / span
            points_out.append(
                {
                    "series": name,
                    "date": date,
                    "time": time,
                    "value": value,
                    "x": x,
                    "y": value / scale_value,
                }
            )
        points_out.sort(key=lambda item: item["x"])
        secondary_points[name] = points_out
        segments_by_series[name] = count_segments(points_out)

        daily_out: list[dict] = []
        by_date_last: dict[str, dict] = {}
        for point in points_out:
            by_date_last[point["date"]] = point
        for date in [day for day in window if day in by_date_last]:
            point = by_date_last[date]
            slot_index, _offset = slot_of_date[date]
            daily_out.append(
                {
                    "series": name,
                    "date": date,
                    "label": slot_label(slots[slot_index]),
                    "value": point["value"],
                    "x": point["x"],
                    "y": point["y"],
                    "text": label_text(point["value"]),
                    # 横轴不再合并，这个字段只为兼容旧调用方恒为 False
                    "merged": len(slots[slot_index]["days"]) > 1,
                    "showLabel": True,
                }
            )
        secondary_last[name] = daily_out
        # 图例文字：WB 用「WB 积分（3.25%）」，阿里云用「阿里云卡券（12.5%）」
        legend = aliyun_series_name(percents[name]) if name == "aliyun" else wb_series_name(percents[name])
        series_lines.append(
            {
                "name": name,
                "percent": percents[name],
                "points": points_out,
                "dailyLast": daily_out,
                "segments": segments_by_series[name],
                "legend": legend,
            }
        )

    # ---- ut（Tokens 消耗，v1.19）：每天一个紫色节点，值是当天的消耗量 ----
    if primary != TOKEN_SERIES and tokens_days:
        divisor = float(percents[TOKEN_SERIES])
        ut_points: list[dict] = []
        for date in tokens_days:
            info = ut_day_info(tokens_daily, date)
            slot_index, _offset = slot_of_date[date]
            # 每天 00:00 一定是 0（日消耗当天清零），之后每个采样点画累计值，
            # 于是每天是一条从 0 抬起来的锯齿；只有当天最后一点标数字。
            for point_time, point_value in info["points"]:
                ut_points.append(
                    {
                        "series": TOKEN_SERIES,
                        "date": date,
                        "time": point_time,
                        "value": point_value,
                        "x": slot_index + day_fraction(point_time),
                        "y": bar_height(TOKEN_SERIES, point_value, percents),
                    }
                )
        ut_points.sort(key=lambda item: item["x"])
        ut_daily_last: list[dict] = []
        # 只有当天最后一个采样点带节点数字（00:00 的 0 和中间过程点都不标）。
        last_by_date: dict[str, dict] = {}
        for point in ut_points:
            last_by_date[point["date"]] = point
        for point in sorted(last_by_date.values(), key=lambda item: item["x"]):
            slot_index, _offset = slot_of_date[point["date"]]
            ut_daily_last.append(
                {
                    "series": TOKEN_SERIES,
                    "date": point["date"],
                    "label": slot_label(slots[slot_index]),
                    "value": point["value"],
                    "x": point["x"],
                    "y": point["y"],
                    "text": token_label(point["value"]),
                    "merged": False,
                    "showLabel": True,
                }
            )
        secondary_points[TOKEN_SERIES] = ut_points
        secondary_last[TOKEN_SERIES] = ut_daily_last
        segments_by_series[TOKEN_SERIES] = count_segments(ut_points)
        series_lines.append(
            {
                "name": TOKEN_SERIES,
                "divisor": divisor,
                "points": ut_points,
                "dailyLast": ut_daily_last,
                "segments": segments_by_series[TOKEN_SERIES],
                "legend": ut_series_name(divisor),
            }
        )

    # 旧键沿用：wbPoints / wbRaw / wbDailyLast / wbSegments / withWb
    wb_points: list[dict] = secondary_points.get("wb", []) if primary == "ds" else []
    wb_daily_last: list[dict] = secondary_last.get("wb", []) if primary == "ds" else []
    wb_segments: dict = segments_by_series.get("wb") or {"up": 0, "down": 0, "flat": 0}

    daily_last = []
    last_indices = []
    for slot_index, slot in enumerate(slots):
        if not slot_points[slot_index]:
            continue
        slot = slots[slot_index]
        index = slot_points[slot_index][-1]
        last_indices.append(index)
        daily_last.append(
            {
                "date": slot["days"][-1],
                "label": slot_label(slot),
                "balance": points[index]["balance"],
                "x": points[index]["x"],
                "y": points[index]["y"],
            }
        )

    all_y = [point["y"] for point in points] + [
        point["y"] for name in secondary_points for point in secondary_points[name]
    ]
    lo, hi = axis_bounds(all_y if all_y else [0.0])

    # 标注规则：每一格的最终节点、整张图最左/最右两个节点、窗口内的最高点与最低点，
    # 以及「每一格自己的峰和谷」都标数值；峰/谷恰好是格首或格末时跳过（格末本来就有数字）。
    single_day = len(slots) == 1
    peak_high = max(range(len(points)), key=lambda i: points[i]["balance"])
    peak_low = min(range(len(points)), key=lambda i: points[i]["balance"])

    slot_first_last = [(indices[0], indices[-1]) for indices in slot_points if indices]
    slot_edges = {index for first, last in slot_first_last for index in (first, last)}
    slot_lows = {min(range(a, b + 1), key=lambda i: points[i]["balance"]) for a, b in slot_first_last}
    slot_peaks = set()
    for first, last in slot_first_last:
        span = range(first, last + 1)
        for candidate in (
            max(span, key=lambda i: points[i]["balance"]),
            min(span, key=lambda i: points[i]["balance"]),
        ):
            if candidate != first and candidate != last:
                slot_peaks.add(candidate)

    mark_indices = sorted({0, len(points) - 1, peak_high, peak_low, *last_indices, *slot_peaks})
    labels = []
    for index in mark_indices:
        first = index == 0
        last = index == len(points) - 1
        ha = "center"
        dx = 0
        if first and not last:
            if points[index]["x"] - x_min > 0.12:
                ha, dx = "right", -8
            else:
                ha, dx = "left", 8
        elif last and not first:
            if x_max - points[index]["x"] > 0.12:
                ha, dx = "left", 8
            else:
                ha, dx = "right", -8
        # 谷点的数字放到点下方；每格的首末点不放下面
        below = (index == peak_low or index in slot_lows) and index not in slot_edges and not first and not last
        labels.append(
            {
                "x": points[index]["x"],
                "y": points[index]["y"],
                "balance": points[index]["balance"],
                "text": (
                    token_label(points[index]["balance"])
                    if primary == TOKEN_SERIES
                    else label_text(points[index].get("raw", points[index]["balance"]))
                ),
                "time": points[index]["time"],
                "ha": ha,
                "dx": dx,
                "below": below,
            }
        )

    # 相邻标注挤在一起时交替抬高半行，数字才不会叠成一团
    last_label_x = None
    lift = False
    for item in labels:
        if item.get("below"):
            continue
        if last_label_x is not None and item["x"] - last_label_x < 0.16:
            lift = not lift
        else:
            lift = False
        item["lift"] = 11 if lift else 0
        last_label_x = item["x"]

    return {
        "ok": True,
        "kind": "line",
        "primary": primary,
        "days": len(window),
        "slots": len(slots),
        "points": len(points),
        "withWb": bool(wb_points),
        "wbPoints": len(wb_points),
        "wbScale": wb_scale,
        "wbPercent": percent_of_scale(wb_scale),
        "theme": resolve_theme(theme),
        "colorMode": resolve_color_mode(color_mode),
        "wbDailyLast": wb_daily_last,
        "wbSegments": wb_segments,
        "wbRaw": wb_points,
        "singleDay": single_day,
        "firstDate": window[0],
        "lastDate": window[-1],
        "ylim": [lo, hi],
        "gridStep": GRID_STEP,
        "axisStep": AXIS_STEP,
        "dates": labels_x,
        "tickLabels": tick_labels(window),
        "tickPositions": ticks,
        "dayBoundaries": list(range(len(slots) + 1)),
        "trimLeft": trim_left,
        "trimRight": trim_right,
        "xRange": [x_min, x_max],
        "dailyLast": daily_last,
        "lastIndices": last_indices,
        "markIndices": mark_indices,
        "labels": labels,
        # 旧键保留：segments 仍然是「主序列相邻两点的涨/跌/平」统计（老断言按它算）。
        "segments": segments,
        # 新键：每条启用的序列各自一份涨/跌/平统计
        "segmentsBySeries": segments_by_series,
        "sources": dict(wanted),
        "scales": dict(percents),
        "seriesCount": len(drawn_all),
        "drawn": drawn_all,
        "primaryPercent": percents[primary],
        # ut（Tokens 消耗）：节点数、每日数据、窗口内消耗合计、divisor
        "utDivisor": float(percents[TOKEN_SERIES]),
        "utTimezone": "local",
        "utPoints": len(secondary_points.get(TOKEN_SERIES, [])) if primary != TOKEN_SERIES else len(points),
        # 每天第一个点必须是 00:00 的 0（日消耗当天清零）；给验收脚本一个可直接断言的表。
        "utMidnight": [
            {"date": date, "time": "00:00:00", "value": 0.0} for date in tokens_days
        ],
        "utDailyLast": secondary_last.get(TOKEN_SERIES, []) if primary != TOKEN_SERIES else daily_last,
        "utSegments": segments_by_series.get(TOKEN_SERIES),
        "utTotal": round(
            sum(
                ut_day_info(tokens_daily, date)["value"]
                for date in tokens_days
            ),
            6,
        )
        if tokens_days
        else 0.0,
        "utLast": (
            ut_day_info(tokens_daily, tokens_days[-1])["total"] if tokens_days else None
        ),
        "seriesLines": series_lines,
        "dsLast": last_value(rows, "ds", window),
        "wbLast": last_value(rows, "wb", window),
        "aliyunLast": last_value(rows, "aliyun", window),
        "min": min(all_y),
        "max": max(all_y),
        "nodeXs": [point["x"] for point in points],
        "pointsRaw": points,
    }


def spend_by_day(rows: list[tuple[str, str, str, float]], kind: str = "ds") -> dict[str, float]:
    """每天花了多少 = 当天所有「下降」幅度之和。

    只看相邻两条记录：掉多少算花多少，涨上去（充值/赠金）不计入花费，也不会
    抵消当天已经掉下去的部分。例如 10 9 8 7 12 11 10 一天里掉过的总量是 5。
    """
    spend: dict[str, float] = {}
    previous: float | None = None
    for date, _time, row_kind, value in rows:
        if row_kind != kind:
            continue
        if previous is not None and previous > value:
            spend[date] = spend.get(date, 0.0) + (previous - value)
        previous = value
    return {date: round(value, 6) for date, value in spend.items()}


def spend_color(value: float, low: float, high: float) -> tuple[float, float, float]:
    """花得越多越接近纯红、越少越接近纯绿，中间值落在黄色上。"""
    if high - low < 1e-9:
        # 整段花费完全一样时没法比大小：花了就按「最红」，全为 0 就随便（柱子本来就没有高度）
        ratio = 1.0 if value > 0 else 0.0
    else:
        ratio = (value - low) / (high - low)
    ratio = min(1.0, max(0.0, ratio))
    if ratio <= 0.5:
        start, end, t = SPEND_GREEN, SPEND_MID, ratio / 0.5
    else:
        start, end, t = SPEND_MID, SPEND_RED, (ratio - 0.5) / 0.5
    return tuple((start[channel] + (end[channel] - start[channel]) * t) / 255.0 for channel in range(3))


def mix_with_white(rgb: tuple[float, float, float], amount: float) -> str:
    """把颜色往白色混，amount=0 原色、1 全白；明色主题让 WB 的柱子明显更浅。"""
    blended = tuple(channel * (1.0 - amount) + 1.0 * amount for channel in rgb)
    return "#%02x%02x%02x" % tuple(int(round(channel * 255)) for channel in blended)


def mix_toward(rgb: tuple[float, float, float], target_hex: str, amount: float) -> str:
    """把颜色往某个目标色混，amount=0 原色、1 全目标色。

    暗色主题用它把 WB 的柱子往近黑压，做出「比 DS 更深」的效果，
    同时保留一点本色，不至于在深色底上糊成一块。
    """
    raw = str(target_hex or "#ffffff").lstrip("#")
    target = tuple(int(raw[index:index + 2], 16) / 255.0 for index in (0, 2, 4))
    blended = tuple(
        rgb[channel] * (1.0 - amount) + target[channel] * amount for channel in range(3)
    )
    return "#%02x%02x%02x" % tuple(int(round(channel * 255)) for channel in blended)


def build_spend(
    rows: list[tuple[str, str, str, float]],
    window: list[str],
    layout: dict,
    with_wb: bool = True,
    wb_scale: float = WB_SCALE,
    theme: str = THEME_DEFAULT,
    sources=None,
    scales=None,
    color_mode: str = COLOR_MODE_DEFAULT,
) -> dict:
    """每天一组柱子：DS / WB / 阿里云三根等宽柱。

    只画启用的序列；柱高按各自百分比缩放（y = value × percent / 100）。
    增减模式下红绿深浅按当天花费在区间内的相对高低；数据源模式下每根柱
    用数据源固定色（DS 蓝 / WB 绿 / 阿里云橙红）。
    """
    wanted = resolve_sources(sources, with_wb)
    percents = resolve_scales(scales, wb_scale)
    totals = {name: spend_by_day(rows, name) if wanted[name] else {} for name in SERIES_ORDER}
    in_window = {name: False for name in SERIES_ORDER}
    for row in rows:
        if wanted[row[2]] and window[0] <= row[0] <= window[-1]:
            in_window[row[2]] = True
    # ut（v1.19）：柱高是「当天消耗了多少 token」，直接取每日增量，不走 spend_by_day。
    tokens_by_day = ut_daily(rows) if wanted[TOKEN_SERIES] else {}
    # 同样铺满整个窗口：没有 ut 采样的日子是一根高度 0 的紫柱（用户 m12026）。
    ut_days = list(window) if wanted[TOKEN_SERIES] else []
    if ut_days:
        in_window[TOKEN_SERIES] = True
        totals[TOKEN_SERIES] = {
            date: ut_day_info(tokens_by_day, date)["value"] for date in window
        }
    drawn = [name for name in SERIES_ORDER if wanted[name] and in_window[name]]
    if not drawn:
        # 窗口内一条都没有：退回「启用且整表有数据」的第一条，避免画空图炸掉
        drawn = [name for name in SERIES_ORDER if wanted[name]][:1]

    bars_by_series: dict[str, list[dict]] = {name: [] for name in SERIES_ORDER}
    for index, date in enumerate(window):
        left_edge = layout["xMin"] if index == 0 else float(index)
        right_edge = layout["xMax"] if index == len(window) - 1 else float(index + 1)
        center = (left_edge + right_edge) / 2
        group = (right_edge - left_edge) * 0.62
        side = [name for name in drawn if name != TOKEN_SERIES]
        if not side:
            # 只剩 ut 时它独占整日（本来就是整日宽的半透明柱）。
            geometry = {TOKEN_SERIES: (center, (right_edge - left_edge) * 0.92)}
        else:
            # 余额序列一律等宽、并排铺满整组，彼此不重叠，靠颜色区分。
            width = group / len(side)
            cursor = center - group / 2.0
            geometry = {}
            for name in side:
                geometry[name] = (cursor + width / 2.0, width)
                cursor += width
        if TOKEN_SERIES in drawn:
            # ut 柱（v1.20.3）：宽度覆盖整日、居中、半透明，垫在其它柱子后面。
            geometry[TOKEN_SERIES] = (center, (right_edge - left_edge) * 0.92)
        for name in drawn:
            x, width = geometry[name]
            day_total = totals[name].get(date, 0.0)
            bars_by_series[name].append(
                {
                    "series": name,
                    "date": date,
                    "label": date[5:],
                    "value": day_total,
                    "height": bar_height(name, day_total, percents),
                    "text": (
                        # ut 的 0 也写出来：没采过样的日子要让用户看到「这里是 0」。
                        token_label(day_total)
                        if name == TOKEN_SERIES
                        else (label_text(day_total) if day_total > 0 else "")
                    ),
                    "x": x,
                    "width": width,
                    # ut 柱半透明、层级最低：它是一整天的「底色」，不遮挡余额柱。
                    "alpha": 0.30 if name == TOKEN_SERIES else None,
                    "zorder": 1.4 if name == TOKEN_SERIES else 3,
                }
            )

    palette = theme_palette(theme)

    mode = resolve_color_mode(color_mode)
    hatch_edge = palette["text"]

    def paint(bars: list[dict], name: str) -> None:
        if name == TOKEN_SERIES:
            # ut 固定紫色（两种颜色模式一致）：它画的是消耗量，不参与红黄绿热力，
            # 也不靠花纹区分，一眼认出「这条紫色是 tokens」即可。
            fixed = palette.get("ut_mark", COLOR_UT_MARK)
            for bar in bars:
                bar["color"] = fixed
            return
        if mode == COLOR_MODE_SOURCE:
            # 数据源模式：三根柱子各用数据源固定色（DS 蓝 / WB 绿 / 阿里云橙红），
            # 与折线图 source 模式的配色一致，不再按花费高低做热力渐变。
            fixed = palette.get(f"{name}_mark", COLOR_DS_MARK)
            for bar in bars:
                bar["color"] = fixed
            return
        # 增减模式（m07048）：颜色按花费高低取红黄绿热力；DS 与阿里云都用
        # 纯热力（不混浅色），保证「花得多=红、花得少=绿」在三条序列上一致。
        # 数据源靠花纹区分：DS 纯色、WB 斜线、阿里云圆点。
        low = min((bar["height"] for bar in bars), default=0.0)
        high = max((bar["height"] for bar in bars), default=0.0)
        shift = 0.0 if name in ("ds", "aliyun") else float(palette.get(f"{name}_bar_amount", 0.55))
        target = palette.get(f"{name}_bar_target", "#ffffff")
        hatch = SERIES_HATCH.get(name, "")
        for bar in bars:
            rgb = spend_color(bar["height"], low, high)
            if shift <= 0:
                bar["color"] = "#%02x%02x%02x" % tuple(
                    int(round(channel * 255)) for channel in rgb
                )
            else:
                # 明色主题混白（更浅），暗色主题混近黑（更深）。
                bar["color"] = mix_toward(rgb, target, shift)
            bar["hatch"] = hatch
            bar["edgeColor"] = hatch_edge if hatch else "none"

    for name in drawn:
        paint(bars_by_series[name], name)
        # 柱顶数字用「类目对应的颜色」（DS 蓝 / WB 绿 / 阿里云橙红），与图例一致，
        # 这样在增减模式下柱子颜色随涨跌变化时，数字仍然一眼能认出是哪个数据源。
        label_color = palette.get(f"{name}_text", palette["text"])
        for bar in bars_by_series[name]:
            bar["labelColor"] = label_color

    ds_bars = bars_by_series["ds"]
    wb_bars = bars_by_series["wb"]
    aliyun_bars = bars_by_series["aliyun"]
    bars = [bar for name in drawn for bar in bars_by_series[name]]
    focus = ds_bars or [bar for name in drawn for bar in bars_by_series[name]]
    max_spend = max((bar["height"] for bar in focus), default=0.0)
    min_spend = min((bar["height"] for bar in focus), default=0.0)
    max_height = max([bar["height"] for bar in bars] + [0.0])
    max_spend = max(max_spend, max_height)
    hi = max(float(AXIS_STEP), float(math.ceil(max_height / AXIS_STEP) * AXIS_STEP))
    return {
        "ok": True,
        "kind": "spend",
        "days": len(window),
        "points": len(bars),
        "firstDate": window[0],
        "lastDate": window[-1],
        "ylim": [0.0, hi],
        "gridStep": GRID_STEP,
        "axisStep": AXIS_STEP,
        "dates": [date[5:] for date in window],
        "tickLabels": tick_labels(window),
        "tickPositions": layout["ticks"],
        "dayBoundaries": list(range(len(window) + 1)),
        "trimLeft": layout["trimLeft"],
        "trimRight": layout["trimRight"],
        "xRange": [layout["xMin"], layout["xMax"]],
        "colorMode": resolve_color_mode(color_mode),
        "bars": bars,
        "dsBars": ds_bars,
        "wbBars": wb_bars,
        "aliyunBars": aliyun_bars,
        "withWb": "wb" in drawn,
        "wbScale": wb_scale,
        "wbPercent": percent_of_scale(wb_scale),
        "theme": resolve_theme(theme),
        "sources": dict(wanted),
        "scales": dict(percents),
        "seriesCount": sum(1 for name in SERIES_ORDER if wanted[name]),
        "drawn": drawn,
        "total": round(sum(bar["value"] for bar in ds_bars), 6),
        "wbTotal": round(sum(bar["value"] for bar in wb_bars), 6),
        "aliyunTotal": round(sum(bar["value"] for bar in aliyun_bars), 6),
        # ut（Tokens 消耗）
        "utBars": bars_by_series[TOKEN_SERIES],
        "utTotal": round(sum(bar["value"] for bar in bars_by_series[TOKEN_SERIES]), 6),
        "utDivisor": float(percents[TOKEN_SERIES]),
        "utLast": (
            ut_day_info(tokens_by_day, ut_days[-1])["total"] if ut_days else None
        ),
        "dsLast": last_value(rows, "ds", window),
        "wbLast": last_value(rows, "wb", window),
        "aliyunLast": last_value(rows, "aliyun", window),
        "min": min_spend,
        "max": max_spend,
    }


def draw_token_area(ax, points, palette, zorder=1.2, alpha=0.30) -> None:
    """ut 只画「线下方的面积」（用户 m12287）：没有折线、没有节点。

    紫色折线本身不可见，靠一层半透明紫填充表示当天累计消耗的走势——面积从
    0 轴长到曲线，视觉上比一条贴着轴底的细线清楚，也不会压住任何余额序列。
    """
    usable = [
        point
        for point in (points or [])
        if isinstance(point.get("x"), (int, float)) and isinstance(point.get("y"), (int, float))
    ]
    if len(usable) < 2:
        return
    usable.sort(key=lambda point: point["x"])
    xs = [point["x"] for point in usable]
    ys = [max(0.0, float(point["y"])) for point in usable]
    ax.fill_between(
        xs,
        ys,
        0.0,
        color=palette.get(f"{TOKEN_SERIES}_mark", COLOR_UT_MARK),
        alpha=alpha,
        linewidth=0,
        zorder=zorder,
    )


def ut_axis_items(meta: dict, points: list[dict]) -> list[dict]:
    """把 ut 的每日数字对齐到「日期刻度正中间」，供横轴下方的标签使用。"""
    dates = meta.get("dates") or []
    out = []
    for item in points:
        if not item.get("text"):
            continue
        date = item.get("date")
        x = float(dates.index(date)) + 0.5 if date in dates else float(item["x"])
        out.append({"x": x, "text": item["text"]})
    return out


def draw_ut_axis_labels(ax, items: list[dict], color: str) -> None:
    """ut 的每日数字统一画在横轴下方、日期标签上方：每个日期一个紫色数值。

    这样它不会再去压 DS/WB 的数字；横轴刻度用 `pad` 往下让开一段给它。
    """
    if not items:
        return
    transform = ax.get_xaxis_transform()
    # 数字比一个日期格还宽（「2亿1千万」≈ 5 个字），所以相邻两个上下错开两档，
    # 否则它们会在横轴下面连成一条。日期标签再用 pad 再往下让一段。
    levels = (-4, -15)
    for index, item in enumerate(items):
        ax.annotate(
            item["text"],
            xy=(float(item["x"]), 0.0),
            xycoords=transform,
            xytext=(0, levels[index % 2]),
            textcoords="offset points",
            ha="center",
            va="top",
            rotation=0,
            fontsize=6.2,
            color=color,
            clip_on=False,
            annotation_clip=False,
            zorder=8,
        )


def build_total(
    rows: list[tuple[str, str, str, float]],
    window: list[str],
    with_wb: bool = True,
    wb_scale: float = WB_SCALE,
    theme: str = THEME_DEFAULT,
    sources=None,
    scales=None,
    color_mode: str = COLOR_MODE_DEFAULT,
) -> dict:
    """消耗累计图（v1.23）：横轴日期，纵轴每种数据从窗口开头累计下来的消耗量。

    余额型（ds/wb/阿里云）用 spend_by_day 的「掉下去多少算花多少」逐日累加；
    ut 用每日 token 增量逐日累加（紫色、半透明、垫在其它线后面）。
    """
    wanted = resolve_sources(sources, with_wb)
    percents = resolve_scales(scales, wb_scale)
    daily = {name: spend_by_day(rows, name) if wanted[name] else {} for name in LEVEL_SERIES}
    tokens_by_day = ut_daily(rows) if wanted[TOKEN_SERIES] else {}
    drawn = [name for name in SERIES_ORDER if wanted[name]]
    if not drawn:
        die(2, "GUGU_EMPTY 启用的序列里没有可画的数据")

    running = {name: 0.0 for name in SERIES_ORDER}
    series_points: dict[str, list[dict]] = {name: [] for name in SERIES_ORDER}
    every: list[dict] = []
    for index, date in enumerate(window):
        x = index + 0.5
        for name in drawn:
            if name == TOKEN_SERIES:
                day_total = ut_day_info(tokens_by_day, date)["value"]
            else:
                day_total = daily[name].get(date, 0.0)
            running[name] = round(running[name] + float(day_total), 6)
            point = {
                "series": name,
                "date": date,
                "x": x,
                "value": running[name],
                "y": bar_height(name, running[name], percents),
                # 用户 m15384：消耗累计图每个节点也显示数值（ut 用粗粒度中文单位，
                # 余额型三条用整数）。
                "text": token_label(running[name]) if name == TOKEN_SERIES else label_text(running[name]),
            }
            series_points[name].append(point)
            every.append(point)

    heights = [point["y"] for point in every] or [0.0]
    lo, hi = axis_bounds(heights)

    total_lines = []
    for name in drawn:
        points = series_points[name]
        if not points:
            continue
        last = points[-1]
        total_lines.append(
            {
                "series": name,
                "points": points,
                "total": last["value"],
                "text": token_label(last["value"]) if name == TOKEN_SERIES else label_text(last["value"]),
            }
        )

    labels = tick_labels(window)
    return {
        "kind": "total",
        "firstDate": window[0],
        "lastDate": window[-1],
        "days": len(window),
        "dates": window,
        "tickPositions": [index + 0.5 for index in range(len(window))],
        "tickLabels": labels,
        "dayBoundaries": [float(index) for index in range(len(window) + 1)],
        "xRange": [0.0, float(len(window))],
        "ylim": [lo, hi],
        "pointsRaw": every,
        "drawn": drawn,
        "sources": wanted,
        "scales": percents,
        "primary": next((name for name in drawn if name != TOKEN_SERIES), TOKEN_SERIES),
        "theme": resolve_theme(theme),
        "colorMode": resolve_color_mode(color_mode),
        "totalLines": total_lines,
        "wbPercent": percents["wb"],
        "utTotal": round(running[TOKEN_SERIES], 6) if TOKEN_SERIES in drawn else 0.0,
    }


def render(meta: dict, out_path: str) -> None:
    try:
        import matplotlib
    except ImportError:
        traceback.print_exc()
        raise SystemExit(3)
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    from matplotlib import patheffects
    from matplotlib.collections import LineCollection
    from matplotlib.ticker import MultipleLocator

    for family in ("Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "PingFang SC", "sans-serif"):
        try:
            font_manager.findfont(family, fallback_to_default=False)
            plt.rcParams["font.sans-serif"] = [family]
            break
        except Exception:
            continue
    plt.rcParams["axes.unicode_minus"] = False

    # 明/暗主题只换背景层（底色、网格、文字、标注底衬），序列颜色不变。
    theme = resolve_theme(meta.get("theme"))
    palette = theme_palette(theme)
    color_mode = resolve_color_mode(meta.get("colorMode"))

    def halo(alpha: float = 0.5, width: float = 2.2) -> list:
        """数字底衬：贴合字形的半透明描边（v1.7），不再用整块矩形 bbox。"""
        raw = str(box_color).lstrip("#")
        rgba = tuple(int(raw[i : i + 2], 16) / 255.0 for i in (0, 2, 4)) + (alpha,)
        return [patheffects.withStroke(linewidth=width, foreground=rgba)]
    bg = palette["bg"]
    frame = palette["frame"]
    day_line = palette["day_line"]
    grid_color = palette["grid_major"]
    text_color = palette["text"]
    title_color = palette["title"]
    box_color = palette["label_box"]
    ds_mark_color = palette["ds_mark"]
    ds_text_color = palette["ds_text"]
    wb_mark_color = palette["wb_mark"]
    wb_text_color = palette["wb_text"]

    kind = meta.get("kind", "line")
    crowded = len(meta.get("dates") or []) > 12
    points = meta.get("pointsRaw") or []
    lo, hi = meta["ylim"]

    # 哪几条序列真的在画（drawn）：旧 meta 没有这些键时按老行为兜底。
    primary_name = meta.get("primary") or "ds"
    sources = meta.get("sources") or {
        "ds": primary_name == "ds",
        "wb": bool(meta.get("withWb")),
        "aliyun": False,
    }
    drawn = meta.get("drawn") or [name for name in ("ds", "wb", "aliyun", "ut") if sources.get(name)]
    primary_mark = palette.get(f"{primary_name}_mark", ds_mark_color)
    primary_text = palette.get(f"{primary_name}_text", ds_text_color)

    count = max(1, len(meta.get("dates") or []))
    # 横轴下面要放一行 ut 数字，画布相应加高，坐标区高度才不会被压扁（否则左上角
    # 图例会压到 WB 折线上）。
    has_ut = bool(meta.get("utDailyLast")) or bool((meta.get("sources") or {}).get(TOKEN_SERIES))
    fig, ax = plt.subplots(figsize=(max(9.0, 0.24 * count + 4.0), 6.15 if has_ut else 5.6), dpi=130)
    fig.patch.set_facecolor(bg)
    ax.set_facecolor(bg)
    # ut 的每日数字收集到这里，最后统一画到横轴下方（两种图共用）。
    ut_below: list[dict] = []

    if kind == "spend":
        for bar in meta["bars"]:
            # 先画 ut（zorder 1.4），再画余额柱（zorder 3），ut 永远在后面。
            ax.bar(
                bar["x"],
                bar.get("height", bar["value"]),
                width=bar["width"],
                color=bar.get("color", "#7c8fb3"),
                edgecolor=bar.get("edgeColor", "none"),
                hatch=bar.get("hatch", ""),
                linewidth=0.8 if bar.get("hatch") else 0.0,
                alpha=bar.get("alpha") if bar.get("alpha") is not None else 1.0,
                zorder=bar.get("zorder", 3),
            )
        for bar in meta["bars"]:
            if not bar["text"]:
                continue
            is_wb = bar.get("series") == "wb"
            is_ut = bar.get("series") == TOKEN_SERIES
            # 窄柱（WB / 阿里云 / ut）数字放右边，阿里云再抬高一点，几列数字不打架；
            # ut 是组里最后一根，右边是空白，所以不旋转、也不跟别人抢上方空间。
            right_shift = 0 if bar.get("series") != "aliyun" else 13
            if is_ut:
                # ut 的数字统一放到横轴下方（见 draw_ut_axis_labels），柱顶留白。
                ut_below.append({"x": float(bar["x"]), "text": bar["text"]})
                continue
            ax.annotate(
                bar["text"],
                xy=(bar["x"], bar.get("height", bar["value"])),
                xytext=(5, (7 if crowded else 9) + right_shift) if is_wb or bar.get("series") == "aliyun" else (-5, 7 if crowded else 9),
                textcoords="offset points",
                ha="left" if is_wb or bar.get("series") == "aliyun" else "right",
                va="bottom",
                rotation=45 if crowded else 0,
                rotation_mode="anchor",
                fontsize=7.5 if crowded else 8,
                color=bar.get("labelColor", text_color),
                annotation_clip=False,
                path_effects=halo(0.45),
            )

    if kind == "line":
        # 主序列的折线颜色：DS 用基准红/绿/灰，WB、阿里云用主题里的专属变体
        up_color, down_color, flat_color = series_line_colors(palette, primary_name, color_mode)
        segments, colors = [], []
        segment_colors: dict[int, str] = {}
        for index in range(1, len(points)):
            previous, current = points[index - 1], points[index]
            segments.append([(previous["x"], previous["y"]), (current["x"], current["y"])])
            if current["y"] > previous["y"]:
                color = up_color
            elif current["y"] < previous["y"]:
                color = down_color
            else:
                color = flat_color
            colors.append(color)
            segment_colors[index] = color
        if primary_name == TOKEN_SERIES:
            # 只剩 ut 时它当主序列：同样只画面积，不做折线/节点。
            draw_token_area(ax, points, palette)
        if segments and primary_name != TOKEN_SERIES:
            # zorder 3：DS 折线恒在 WB 折线（2）、阿里云（1.5）、ut（1.2）之上。
            ax.add_collection(
                LineCollection(segments, colors=colors, linewidths=1.6, capstyle="round", zorder=3)
            )

        # 节点颜色按序列固定：DS 一律蓝（不再跟随涨跌的红/绿/灰）。
        last_positions = set(meta.get("markIndices") or meta["lastIndices"])
        marker_x, marker_y = [], []
        for index, point in enumerate(points):
            if index not in last_positions:
                continue
            marker_x.append(point["x"])
            marker_y.append(point["y"])
        # zorder 5.4：与 WB 节点重叠时，主序列的圆点压在上面。
        # ut 例外：它一个节点都不画（只显示每日最后一个点的数值）。
        if primary_name != TOKEN_SERIES:
            ax.scatter(marker_x, marker_y, s=34, c=primary_mark, edgecolors="#ffffff", linewidths=1.2, zorder=5.4)

        # ---- WB：浅色折线 + 每日最终节点 ----
        wb_raw = meta.get("wbRaw") or [] if sources.get("wb") else []
        wb_line_up, wb_line_down, wb_line_flat = series_line_colors(palette, "wb", color_mode)
        wb_segments_list, wb_colors_list = [], []
        for previous, current in zip(wb_raw, wb_raw[1:]):
            wb_segments_list.append([(previous["x"], previous["y"]), (current["x"], current["y"])])
            if current["y"] > previous["y"]:
                wb_colors_list.append(wb_line_up)
            elif current["y"] < previous["y"]:
                wb_colors_list.append(wb_line_down)
            else:
                wb_colors_list.append(wb_line_flat)
        if wb_segments_list:
            ax.add_collection(
                LineCollection(wb_segments_list, colors=wb_colors_list, linewidths=1.3, capstyle="round", zorder=2)
            )
        wb_daily = meta.get("wbDailyLast") or []
        if wb_daily:
            ax.scatter(
                [item["x"] for item in wb_daily],
                [item["y"] for item in wb_daily],
                s=26,
                c=wb_mark_color,
                edgecolors="#ffffff",
                linewidths=1.0,
                zorder=4,
            )
            # WB 每天的数字都要标出来，一个都不省。DS 的数字在点上方、WB 的
            # 在点下方，所以同 x 不会打架；只有相邻两个 WB 标注横向贴得太近时，
            # 把后一个再往下错开一档（-12 → -26 → -40 循环），靠错位而不是省略
            # 来解决拥挤。贴近右边界时改用右对齐，避免数字被画布切掉。
            x_right = float(meta["xRange"][1])
            levels = (-12, -26, -40)
            level_index = 0
            last_wb_x = None
            for item in wb_daily:
                if last_wb_x is not None and item["x"] - last_wb_x < 0.42:
                    level_index = (level_index + 1) % len(levels)
                else:
                    level_index = 0
                last_wb_x = item["x"]
                near_right = x_right - item["x"] < 0.42
                ax.annotate(
                    item["text"],
                    xy=(item["x"], item["y"]),
                    xytext=(-4, levels[level_index]) if near_right else (0, levels[level_index]),
                    textcoords="offset points",
                    ha="right" if near_right else "center",
                    va="top",
                    rotation=45 if crowded else 0,
                    rotation_mode="anchor",
                    fontsize=7 if crowded else 7.5,
                    color=wb_text_color,
                    annotation_clip=False,
                    zorder=5,
                    path_effects=halo(0.45),
                )

        # ---- 其余序列（阿里云等）：第三条折线 + 每日最终节点 ----
        # 数字统一放在节点下方，比 WB 再低一档（-26/-40/-54），三条序列同一天
        # 都有末点时不会互相压住。
        for line in meta.get("seriesLines") or []:
            line_name = line.get("name")
            if not sources.get(line_name) or line_name in ("wb", primary_name):
                continue
            line_points = line.get("points") or []
            line_segments, line_colors = [], []
            line_up, line_down, line_flat = series_line_colors(palette, line_name, color_mode)
            for previous, current in zip(line_points, line_points[1:]):
                line_segments.append([(previous["x"], previous["y"]), (current["x"], current["y"])])
                if current["y"] > previous["y"]:
                    line_colors.append(line_up)
                elif current["y"] < previous["y"]:
                    line_colors.append(line_down)
                else:
                    line_colors.append(line_flat)
            is_ut = line_name == TOKEN_SERIES
            if is_ut:
                draw_token_area(ax, line_points, palette)
            if line_segments and not is_ut:
                # 图层覆盖优先级 ds > wb > al > ut：ut 永远在最底下（更粗但压不住别人）。
                ax.add_collection(
                    LineCollection(
                        line_segments,
                        colors=line_colors,
                        linewidths=1.9 if is_ut else 1.1,
                        capstyle="round",
                        zorder=1.2 if is_ut else 1.5,
                    )
                )
            line_mark = palette.get(f"{line_name}_mark", COLOR_ALIYUN_MARK)
            line_text = palette.get(f"{line_name}_text", line_mark)
            line_daily = line.get("dailyLast") or []
            if not line_daily:
                continue
            if not is_ut:
                # ut 不画节点：只需要它每日最后一个点的数值（下面的 annotate）。
                ax.scatter(
                    [item["x"] for item in line_daily],
                    [item["y"] for item in line_daily],
                    s=22,
                    c=line_mark,
                    edgecolors="#ffffff",
                    linewidths=1.0,
                    zorder=3.5,
                )
            if is_ut:
                # ut 贴着 0 轴走，数字画在图里会压住 DS 的标注；统一挪到横轴
                # 下方、每个日期正中间（draw_ut_axis_labels）。
                ut_below.extend(ut_axis_items(meta, line_daily))
                continue
            # 余额序列的数字放节点下方（-26/-40/-54 三档）。
            aliyun_levels = (22, 34, 46) if is_ut else (-26, -40, -54)
            aliyun_level = 0
            last_aliyun_x = None
            x_right_third = float(meta["xRange"][1])
            ut_index = 0
            for item in line_daily:
                if last_aliyun_x is not None and item["x"] - last_aliyun_x < 0.42:
                    aliyun_level = (aliyun_level + 1) % len(aliyun_levels)
                else:
                    aliyun_level = 0
                last_aliyun_x = item["x"]
                near_right_third = x_right_third - item["x"] < 0.42
                ax.annotate(
                    item["text"],
                    xy=(item["x"], item["y"]),
                    xytext=(-4, aliyun_levels[aliyun_level]) if near_right_third else (0, aliyun_levels[aliyun_level]),
                    textcoords="offset points",
                    ha="right" if near_right_third else "center",
                    va="top",
                    rotation=45 if crowded else 0,
                    rotation_mode="anchor",
                    fontsize=7 if crowded else 7.5,
                    color=line_text,
                    annotation_clip=False,
                    zorder=4.6,
                    path_effects=halo(0.45),
                )

        for item in meta.get("labels") or meta.get("dailyLast") or []:
            below = bool(item.get("below"))
            ax.annotate(
                item.get("text") or label_text(item["balance"]),
                xy=(item["x"], item["y"]),
                xytext=(
                    item.get("dx", 0),
                    -14 if below else ((7 if crowded else 9) + item.get("lift", 0)),
                ),
                textcoords="offset points",
                ha=item.get("ha", "center"),
                va="top" if below else "bottom",
                rotation=45 if crowded else 0,
                rotation_mode="anchor",
                fontsize=7.5 if crowded else 8,
                color=primary_text,
                # zorder 6：主序列的数字压住其它序列的数字；底衬改成不透明，
                # 重叠时不会透出下面那行 WB 文字（m04068）。
                zorder=6,
                path_effects=halo(0.6),
            )

    if kind == "total":
        # 消耗累计图（v1.23）：每条线是从窗口开头累计下来的消耗；ut 只画紫色面积。
        # 用户 m15384：每个节点都标出数值——三条余额型线各自错开一档，ut 的数字
        # 统一挪到横轴下方那一行，免得紫色大数压住别人。
        total_levels = {"ds": (9,), "wb": (-26, -40), "aliyun": (9, 22)}
        for line in meta.get("totalLines") or []:
            series_name = line["series"]
            series_points = line.get("points") or []
            if len(series_points) < 1:
                continue
            xs = [point["x"] for point in series_points]
            ys = [point["y"] for point in series_points]
            if series_name == TOKEN_SERIES:
                # ut 是面积图、累计到「亿」级，逐日标数字会糊成一片；它只在
                # 画布底部留一行紫色总量（见下面 fig.text），不参与逐点标注。
                draw_token_area(ax, series_points, palette, zorder=1.2, alpha=0.30)
                continue
            mark = palette.get(f"{series_name}_mark", ds_mark_color)
            ax.plot(
                xs,
                ys,
                color=mark,
                linewidth=1.9,
                zorder=3.0 if series_name == "ds" else 2.4,
                solid_capstyle="round",
            )
            ax.scatter(
                xs,
                ys,
                s=26,
                facecolor=palette["bg"],
                edgecolor=mark,
                linewidth=1.5,
                zorder=3.6,
            )
            mark_text = palette.get(f"{series_name}_text", mark)
            levels = total_levels.get(series_name, (-26, -40))
            level = 0
            last_x = None
            x_right_total = float(meta["xRange"][1])
            for item in series_points:
                if last_x is not None and item["x"] - last_x < 0.42:
                    level = (level + 1) % len(levels)
                else:
                    level = 0
                last_x = item["x"]
                near_right_total = x_right_total - item["x"] < 0.42
                ax.annotate(
                    item.get("text") or "",
                    xy=(item["x"], item["y"]),
                    xytext=(-4, levels[level]) if near_right_total else (0, levels[level]),
                    textcoords="offset points",
                    ha="right" if near_right_total else "center",
                    va="top" if levels[level] < 0 else "bottom",
                    rotation=45 if crowded else 0,
                    rotation_mode="anchor",
                    fontsize=7 if crowded else 7.5,
                    color=mark_text,
                    annotation_clip=False,
                    zorder=5,
                    path_effects=halo(0.45),
                )
    # 横轴范围就是 [0, 天数]，两端都不裁（m03986 删掉了 8 分片裁切），
    # 只留一点点边让首/末日期标签不被切掉。
    wb_xs = [point["x"] for point in (meta.get("wbRaw") or [])]
    wb_xs += [
        point["x"]
        for line in (meta.get("seriesLines") or [])
        for point in (line.get("points") or [])
    ]
    if points:
        max_x = max([point["x"] for point in points] + wb_xs)
        min_x = min([point["x"] for point in points] + wb_xs)
    else:
        max_x = max(bar["x"] for bar in meta["bars"])
        min_x = min(bar["x"] for bar in meta["bars"])
    ax.set_xlim(
        min(meta["xRange"][0] - 0.03, min_x - 0.03),
        max(meta["xRange"][1] + 0.03, max_x + 0.06),
    )
    if kind == "spend":
        # 花费图的图例是手绘在轴内的（见下面的 Rectangle），如果某天花费顶到轴上限，
        # 图例就会盖住那根柱子以及柱顶的数字。这里在轴顶留出一段空白带（数据的
        # 轴域 lo..hi 不变，只是可视 ylim 抬高），图例住在这条空带里，柱子最多长到
        # 1/1.22 ≈ 0.82，永远够不到图例。
        ax.set_ylim(lo, hi * SPEND_HEADROOM)
    else:
        ax.set_ylim(lo, hi)
    ax.set_xticks(meta["tickPositions"])
    ax.set_xticklabels(
        meta.get("tickLabels") or meta["dates"],
        rotation=45,
        ha="center",
        fontsize=7.5 if len(meta.get("dates") or []) > 12 else 8,
        color=text_color,
    )
    ax.yaxis.set_major_locator(MultipleLocator(AXIS_STEP))
    ax.grid(which="major", axis="y", color=grid_color, linewidth=1.0)
    # 每个日期的开头与结尾各一条竖分隔线，把同一天的记录框在一起。
    boundaries = list(meta["dayBoundaries"])
    for edge in meta["xRange"]:
        if edge not in boundaries:
            boundaries.append(edge)
    for boundary in boundaries:
        ax.axvline(boundary, color=day_line, linewidth=0.9, zorder=1)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(frame)
    ax.tick_params(axis="y", labelsize=9, colors=text_color, length=0)
    # ut 的数字住在横轴与日期标签之间，所以有 ut 时把日期再往下让一段。
    ax.tick_params(axis="x", length=0, pad=23 if ut_below else 6)
    if ut_below:
        draw_ut_axis_labels(ax, ut_below, palette.get("ut_text", COLOR_UT_MARK))
    if drawn:
        from matplotlib.lines import Line2D
        from matplotlib.patches import Rectangle

        percent = float(meta.get("wbPercent") or percent_of_scale(float(meta.get("wbScale") or WB_SCALE)))
        scale_map = meta.get("scales") or {}
        ds_percent = float(scale_map.get("ds", SCALE_DEFAULTS["ds"]))
        aliyun_percent = float(scale_map.get("aliyun", SCALE_DEFAULTS["aliyun"]))
        ut_divisor = float(scale_map.get("ut", SCALE_DEFAULTS["ut"]))
        if kind == "total":
            legend_words = {
                "ds": "DS 消耗",
                "wb": wb_spend_name(percent),
                "aliyun": aliyun_spend_name(aliyun_percent),
                "ut": ut_series_name(ut_divisor),
            }
        else:
            legend_words = {
                "ds": SERIES_LABELS["ds"],
                "wb": SERIES_LABELS["wb"],
                "aliyun": SERIES_LABELS["aliyun"],
                "ut": ut_series_name(ut_divisor),
            }
        if kind == "spend":
            # 图例：三根柱子现在等宽，靠颜色区分；Patch 不能指定宽高，
            # 所以直接在坐标轴里手工画矩形（轴坐标），再各跟一段文字。
            # 数据源模式下每个矩形用该数据源的固定色；增减模式保留统一的文字色。
            bar_h = 0.030
            bar_w = 0.030
            label_x = 0.012 + bar_w + 0.012
            legend_rows = [
                "DS 花费（元）",
                wb_spend_name(percent),
                aliyun_spend_name(aliyun_percent),
                ut_spend_name(ut_divisor),
            ]
            legend_names = ["ds", "wb", "aliyun", "ut"]
            legend_colors = {
                "ds": ds_mark_color if color_mode == COLOR_MODE_SOURCE else text_color,
                "wb": wb_mark_color if color_mode == COLOR_MODE_SOURCE else text_color,
                "aliyun": palette["aliyun_mark"] if color_mode == COLOR_MODE_SOURCE else text_color,
                # ut 的柱子两种模式都是紫色，图例跟着固定紫。
                "ut": palette["ut_mark"],
            }
            # 增减模式下图例也要显示三种花纹，和实际柱子一一对应。
            legend_hatch = {name: ("" if color_mode == COLOR_MODE_SOURCE else SERIES_HATCH.get(name, ""))
                            for name in legend_names}
            for row, (name, label) in enumerate(
                [pair for pair in zip(legend_names, legend_rows) if pair[0] in drawn]
            ):
                y = 0.975 - row * 0.05
                ax.add_patch(
                    Rectangle(
                        (0.012, y - bar_h / 2.0),
                        bar_w,
                        bar_h,
                        transform=ax.transAxes,
                        facecolor=legend_colors[name],
                        edgecolor=text_color if legend_hatch[name] else "none",
                        hatch=legend_hatch[name],
                        linewidth=0.6 if legend_hatch[name] else 0.0,
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
            handles = None
        elif color_mode == COLOR_MODE_SOURCE:
            # 按数据源着色：图例改成三段纯色线，蓝/绿/橙分别代表三个数据源。
            handles = []
            for name, color, label in (
                ("ds", ds_mark_color, legend_words["ds"]),
                ("wb", wb_mark_color, legend_words["wb"]),
                ("aliyun", palette["aliyun_mark"], legend_words["aliyun"]),
                ("ut", palette["ut_mark"], legend_words["ut"]),
            ):
                if name not in drawn:
                    continue
                if name == TOKEN_SERIES:
                    # ut 画的是「线下面积」+半透明柱，图例也跟着画成一块淡紫色块。
                    handles.append(
                        Rectangle((0, 0), 1, 1, facecolor=color, edgecolor="none", alpha=0.35, label=label)
                    )
                else:
                    handles.append(
                        Line2D([0], [0], color=color, linewidth=2.2, linestyle="-", label=label)
                    )
        else:
            # v1.7 图例：每序列一个小圆点，颜色与节点一致（DS 蓝 / WB 浅绿 / 阿里云橙红）。
            handles = []
            if "ds" in drawn:
                handles.append(
                    Line2D(
                        [0], [0], marker="o", linestyle="None", markersize=6.5,
                        markerfacecolor=ds_mark_color, markeredgecolor="none",
                        label=legend_words["ds"],
                    )
                )
            if "wb" in drawn:
                handles.append(
                    Line2D(
                        [0], [0], marker="o", linestyle="None", markersize=6.5,
                        markerfacecolor=palette["wb_mark"], markeredgecolor="none",
                        label=legend_words["wb"],
                    )
                )
            if "aliyun" in drawn:
                handles.append(
                    Line2D(
                        [0], [0], marker="o", linestyle="None", markersize=6.5,
                        markerfacecolor=palette["aliyun_mark"], markeredgecolor="none",
                        label=legend_words["aliyun"],
                    )
                )
            if TOKEN_SERIES in drawn:
                # ut 是紫色，不随涨跌变色；它已经不画线和节点，图例给一块淡紫色块。
                handles.append(
                    Rectangle(
                        (0, 0), 1, 1, facecolor=palette["ut_mark"], edgecolor="none",
                        alpha=0.35, label=legend_words["ut"],
                    )
                )
        if handles:
            legend = ax.legend(
                handles=handles,
                loc="upper left",
                frameon=False,
                fontsize=8.5,
                handlelength=1.6,
                borderaxespad=0.2,
            )
            for text_item in legend.get_texts():
                text_item.set_color(text_color)
    title = (
        "谷谷股 · 花费柱状图"
        if kind == "spend"
        else "谷谷股 · 消耗累计图"
        if kind == "total"
        else "谷谷股 · 余额折线图"
    )
    ax.set_title(title, loc="left", fontsize=14, color=title_color, pad=14)
    if kind == "spend":
        ylabel = "花费"
    elif kind == "total":
        ylabel = "累计消耗"
    elif meta.get("primary") == TOKEN_SERIES:
        # 只剩 ut 开着时纵轴画的是 token，别再写「余额」。
        ylabel = "Tokens 消耗"
    else:
        ylabel = "余额"
    ax.set_ylabel(ylabel, fontsize=9.5, color=text_color, labelpad=8)
    # 横轴下方多了一行 ut 数字、或者要放紫色总量行时，给底部留一条空白带。
    needs_bottom = bool(ut_below) or (kind == "total" and bool((meta.get("sources") or {}).get(TOKEN_SERIES)))
    fig.tight_layout(rect=(0.0, 0.10, 1.0, 1.0) if needs_bottom else (0.0, 0.0, 1.0, 1.0))
    # 画布最底下那行空白：右下角写明这张图是什么时候生成的（用户 m13928）。
    # ut 数据源开着时，在时间水印上方补一行紫字：Tokens 消耗总量（用户 m14004）。
    if (meta.get("sources") or {}).get(TOKEN_SERIES):
        total_text = "Tokens消耗总量 · " + coarse_label(meta.get("utTotal") or 0)
        fig.text(
            0.9,
            0.048,
            total_text,
            ha="right",
            va="bottom",
            fontsize=10,
            color=palette.get("ut_mark", COLOR_UT_MARK),
            alpha=0.9,
        )
    # 时间戳正常取当前时刻；测试要逐字节比对两张图，可以用环境变量固定成同一个值。
    stamp = os.environ.get("GUGU_GENERATED_AT") or datetime.now().strftime("%Y/%m/%d %H:%M")
    fig.text(
        0.9,
        0.012,
        "谷谷股图生成时间 · " + stamp,
        ha="right",
        va="bottom",
        fontsize=8,
        color=palette.get("text", "#666666"),
        alpha=0.62,
    )

    out_dir = os.path.dirname(os.path.abspath(out_path))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    fig.savefig(out_path, dpi=130, facecolor=bg)
    plt.close(fig)


# ---------------------------------------------------------------------------
# 面板设置（settings.json）自动应用
#
# 用户 m08966 / m09150：不管谁调用本脚本——插件宿主、skill 包装脚本，还是某个
# Agent 直接 `python gugu_chart.py` 裸调——只要没显式给视觉参数，就按设置面板
# 那一套出图。以前裸调会退回内置默认（light 主题 + 不画阿里云线），图跟面板不一致。
# 显式传了的参数永远优先（fixtures/单测靠这个保持确定性）。
# ---------------------------------------------------------------------------

SETTINGS_THEMES = ("light", "dark", "auto")


def panel_settings_path(csv_path: str, explicit: str | None = None) -> str | None:
    """settings.json 在哪：显式给就用它，否则取 CSV 同目录（插件正是这么放的）。"""
    if explicit:
        return os.path.abspath(explicit)
    folder = os.path.dirname(os.path.abspath(csv_path))
    candidate = os.path.join(folder, "settings.json")
    return candidate if os.path.exists(candidate) else None


CSV_META_PREFIX = b"#gugu "


def csv_meta_settings(csv_path: str) -> dict | None:
    """表头之上那一行 `#gugu {...}` 就是面板设置：搬走这张表也就搬走了设置。"""
    try:
        with open(csv_path, "rb") as fh:
            head = fh.read(64 * 1024)
    except Exception:  # noqa: BLE001
        return None
    for line in head.split(b"\n"):
        line = line.strip().lstrip(b"\xef\xbb\xbf")
        if not line.startswith(CSV_META_PREFIX):
            continue
        try:
            parsed = json.loads(line[len(CSV_META_PREFIX):].decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def load_panel_settings(csv_path, explicit=None, disabled: bool = False):
    """读面板设置，返回 (settings|None, path|None, note|None)；读不到返回 None 交给调用方回退。"""
    if disabled:
        return None, None, None
    inline = None if explicit else csv_meta_settings(csv_path)
    if inline is not None:
        return settings_from_dict(inline), f"{csv_path}#gugu", None
    path = panel_settings_path(csv_path, explicit)
    if path is None:
        return None, None, None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except Exception as err:  # noqa: BLE001 —— 设置坏了不该毁掉出图
        return None, path, f"settings.json 读不出来（{err}）"
    if not isinstance(raw, dict):
        return None, path, "settings.json 不是对象"
    return settings_from_dict(raw), path, None


def settings_from_dict(raw: dict):
    """把 settings.json / 表内联设置 折成 {theme,colorMode,sources,scales}。"""
    theme = raw.get("theme")
    theme = theme.strip().lower() if isinstance(theme, str) else None
    if theme not in SETTINGS_THEMES:
        theme = None
    color_mode = raw.get("colorMode")
    color_mode = color_mode.strip().lower() if isinstance(color_mode, str) else None
    if color_mode not in COLOR_MODES:
        color_mode = None
    sources = None
    sources_raw = raw.get("sources")
    if isinstance(sources_raw, dict):
        picked = [name for name in SERIES_ORDER if bool(sources_raw.get(name))]
        sources = ",".join(picked) if picked else None
    scales = {}
    scales_raw = raw.get("scales")
    if isinstance(scales_raw, dict):
        for name in SERIES_ORDER:
            if scales_raw.get(name) is not None:
                scales[name] = scales_raw[name]
    if scales.get("wb") is None and raw.get("wbPercent") is not None:
        scales["wb"] = raw.get("wbPercent")
    return {"theme": theme, "colorMode": color_mode, "sources": sources, "scales": scales}



def main(argv: list[str]) -> int:
    # Windows 控制台默认 cp936：JSON 里的中文数字（1千/7百万）会让父进程按 utf-8
    # 读 stdout 时直接 UnicodeDecodeError，所以这里显式把两条流钉成 utf-8。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
    parser = argparse.ArgumentParser(description="谷谷股折线图")
    parser.add_argument("--csv", required=True, help="balances.csv 路径")
    parser.add_argument("--out", required=True, help="输出 PNG 路径")
    parser.add_argument("--max-days", type=int, default=60, help="最多显示多少个有数据的日期")
    parser.add_argument(
        "--kind",
        choices=("line", "spend", "total"),
        default="line",
        help="line=余额折线图 / spend=花费柱状图 / total=消耗累计图",
    )
    parser.add_argument("--from", dest="date_from", default=None, help="起始日期 YYYY-MM-DD（含）")
    parser.add_argument("--to", dest="date_to", default=None, help="结束日期 YYYY-MM-DD（含）")
    parser.add_argument("--with-wb", dest="with_wb", choices=("0", "1"), default="1", help="是否把 WB 积分画成第二条线（默认 1）")
    parser.add_argument(
        "--sources",
        dest="sources",
        default=None,
        help="要画的序列，逗号分隔（ds,wb,aliyun），可只给子集；不传时按旧行为 ds + (--with-wb 决定 wb)",
    )
    parser.add_argument(
        "--scale-ds",
        dest="scale_ds",
        type=float,
        default=None,
        help=f"DS 余额的缩放百分比（不传时按 CSV 同目录 settings.json，再退回 {SCALE_DEFAULTS['ds']:g}）",
    )
    parser.add_argument(
        "--scale-wb",
        dest="scale_wb",
        type=float,
        default=None,
        help=f"WB 积分的缩放百分比（默认 {SCALE_DEFAULTS['wb']:g}；不给时沿用 --wb-percent）",
    )
    parser.add_argument(
        "--scale-aliyun",
        dest="scale_aliyun",
        type=float,
        default=None,
        help=f"阿里云卡券的缩放百分比（不传时按 CSV 同目录 settings.json，再退回 {SCALE_DEFAULTS['aliyun']:g}）",
    )
    parser.add_argument(
        "--scale-ut",
        dest="scale_ut",
        type=float,
        default=None,
        help=f"Tokens 消耗的每格 token 数（divisor）；不传时按 settings.json，再退回 {SCALE_DEFAULTS['ut']:g}",
    )
    parser.add_argument(
        "--wb-percent",
        dest="wb_percent",
        type=float,
        default=None,
        help=f"（旧参数）WB 积分缩放百分比，等价于 --scale-wb；默认 {WB_PERCENT_DEFAULT:g}，范围 {WB_PERCENT_MIN}~{WB_PERCENT_MAX}",
    )
    parser.add_argument(
        "--theme",
        choices=("light", "dark", "auto"),
        default=None,
        help="图表主题：light/dark/auto（不传时按 settings.json 的面板主题）",
    )
    parser.add_argument(
        "--color-mode",
        dest="color_mode",
        choices=COLOR_MODES,
        default=None,
        help="折线颜色：change=按涨跌 / source=按数据源（不传时按 settings.json 的面板设置）",
    )
    parser.add_argument(
        "--settings",
        default=None,
        help="面板设置路径；默认取 CSV 同目录的 settings.json（有就自动应用）",
    )
    parser.add_argument(
        "--no-settings",
        dest="no_settings",
        action="store_true",
        help="忽略 settings.json，只用命令行参数与内置默认（夹具/单测用）",
    )
    parser.add_argument("--json", action="store_true", help="stdout 输出 GUGU_RESULT <json>")
    parser.add_argument("--meta", default=None, help="把元数据 JSON 写到该文件")
    args = parser.parse_args(argv)

    try:
        panel, panel_path, panel_note = load_panel_settings(args.csv, args.settings, args.no_settings)
        if panel_note:
            print("GUGU_SETTINGS_WARN " + panel_note, file=sys.stderr)
        elif panel:
            print("GUGU_SETTINGS_AUTO " + str(panel_path), file=sys.stderr)
        panel = panel or {}
        panel_scales = panel.get("scales") or {}

        # 显式命令行 > settings.json > 内置默认
        theme = args.theme if args.theme is not None else (panel.get("theme") or THEME_DEFAULT)
        color_mode = args.color_mode if args.color_mode is not None else (panel.get("colorMode") or COLOR_MODE_DEFAULT)
        sources = args.sources if args.sources is not None else panel.get("sources")

        if args.scale_wb is not None:
            wb_percent = sanitize_scale(args.scale_wb, SCALE_DEFAULTS["wb"])
        elif args.wb_percent is not None:
            # 老参数 --wb-percent 继续可用（夹在 0.1~20 之间，非法值回默认）
            wb_percent = clampa_percent(args.wb_percent)
        elif panel_scales.get("wb") is not None:
            wb_percent = clampa_percent(panel_scales.get("wb"))
        else:
            wb_percent = SCALE_DEFAULTS["wb"]
        scale_ds = args.scale_ds if args.scale_ds is not None else panel_scales.get("ds")
        scale_aliyun = args.scale_aliyun if args.scale_aliyun is not None else panel_scales.get("aliyun")
        scale_ut = args.scale_ut if args.scale_ut is not None else panel_scales.get("ut")
        scales = {
            "ds": sanitize_scale(scale_ds, SCALE_DEFAULTS["ds"]),
            "wb": wb_percent,
            "aliyun": sanitize_scale(scale_aliyun, SCALE_DEFAULTS["aliyun"]),
            # ut 是 divisor（每格多少 token），不是百分比。
            "ut": sanitize_scale_for(TOKEN_SERIES, scale_ut, SCALE_DEFAULTS["ut"]),
        }
        meta = build(
            args.csv,
            args.max_days,
            args.kind,
            args.date_from,
            args.date_to,
            args.with_wb != "0",
            100.0 / wb_percent,
            theme,
            sources=sources,
            scales=scales,
            color_mode=color_mode,
        )
        meta["settingsApplied"] = bool(panel)
        meta["settingsPath"] = panel_path
        render(meta, args.out)
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        return 1

    meta["png"] = os.path.abspath(args.out)
    payload = {key: value for key, value in meta.items() if key != "pointsRaw"}
    if args.meta:
        with open(args.meta, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
    if args.json:
        print("GUGU_RESULT " + json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
