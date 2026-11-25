# -*- coding: utf-8 -*-
"""一次性补丁：给 gugu_chart.py 增加花费柱状图、日期区间与标题变更。"""
from pathlib import Path

path = Path(__file__).resolve().parents[2] / "dsh-gugu-stock" / "scripts" / "gugu_chart.py"
src = path.read_text(encoding="utf-8")


def swap(old: str, new: str) -> None:
    global src
    assert old in src, old[:60]
    src = src.replace(old, new, 1)


swap(
    'TITLE = "#222222"\n',
    'TITLE = "#222222"\nCOLOR_SPEND = "#7c8fb3"  # 花费柱状图：灰蓝，和折线的红/绿区分开\n',
)

# 1) 在 pick_window 之后补 select_window / daily_finals / compute_time_layout
swap(
    """    return days[-max_days:] if max_days > 0 else days
""",
    '''    return days[-max_days:] if max_days > 0 else days


def all_days(rows: list[tuple[str, str, float]]) -> list[str]:
    days: list[str] = []
    for date, _time, _value in rows:
        if not days or days[-1] != date:
            days.append(date)
    return days


def select_window(
    rows: list[tuple[str, str, float]],
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


def daily_finals(rows: list[tuple[str, str, float]]) -> dict[str, float]:
    """每一天的最后一条余额（rows 升序，后写覆盖前写）。"""
    finals: dict[str, float] = {}
    for date, _time, value in rows:
        finals[date] = value
    return finals


def compute_time_layout(
    window: list[str], by_day: dict[str, list[tuple[str, float]]]
) -> dict:
    """按真实时钟排布横轴，并裁掉首/末日没有数据的 1/8 分片。

    一天切成 SLICES 等份（默认 8 份 = 每份 3 小时）。首日从「第一份有数据的
    分片」开头画起，末日画到「最后一份有数据的分片」结尾；中间日期一律整格。
    """

    def occupied_slices(stamps: list[str]) -> list[int]:
        return sorted({min(SLICES - 1, int(day_fraction(stamp) * SLICES)) for stamp in stamps})

    first_slices = occupied_slices([stamp for stamp, _value in by_day[window[0]]])
    last_slices = occupied_slices([stamp for stamp, _value in by_day[window[-1]]])
    x_min = first_slices[0] / SLICES
    x_max = (len(window) - 1) + (last_slices[-1] + 1) / SLICES
    if len(window) == 1:
        # 只有一天时两端都作用在同一天上，别把自己裁没了
        x_min = min(x_min, x_max - 1.0 / SLICES)
    ticks = []
    for index in range(len(window)):
        left_edge = x_min if index == 0 else float(index)
        right_edge = x_max if index == len(window) - 1 else float(index + 1)
        ticks.append((left_edge + right_edge) / 2)
    return {
        "xMin": x_min,
        "xMax": x_max,
        "trimLeft": x_min > 0.0,
        "trimRight": x_max < float(len(window)),
        "ticks": ticks,
    }
''',
)

# 2) build 签名与区间选择
swap(
    """def build(csv_path: str, max_days: int) -> dict:
    rows = parse_rows(csv_path)
    if not rows:
        die(2, "GUGU_EMPTY 没有可画的数据")
    window = pick_window(rows, max_days)
""",
    """def build(
    csv_path: str,
    max_days: int,
    kind: str = "line",
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict:
    rows = parse_rows(csv_path)
    if not rows:
        die(2, "GUGU_EMPTY 没有可画的数据")
    window = select_window(rows, date_from, date_to, max_days)
    if not window:
        die(2, "GUGU_RANGE 所选日期区间内没有数据")
""",
)

# 3) 用 compute_time_layout 取代内联的 tick_center / 分片裁切
swap(
    '''    def tick_center(index: int) -> float:
        """日期标签落在「可见那段」的正中；整格时就是 i+0.5。"""
        left_edge = x_min if index == 0 else float(index)
        right_edge = x_max if index == len(window) - 1 else float(index + 1)
        return (left_edge + right_edge) / 2

''',
    '''    layout = compute_time_layout(window, by_day)

''',
)

swap(
    """    # 首日只在下午/晚上有数据时，它上午那一半是空的，横轴就不必从 0 点画起；
    # 末日只采到上午时同理，后面那半格也省掉。只收最外侧两个日期的空半格。
    # 把一天切成 SLICES 等份（默认 8 份 = 每份 3 小时）。首日从「第一份有数据的
    # 分片」开头画起，末日画到「最后一份有数据的分片」结尾；中间的日期一律整格。
    def occupied_slices(stamps: list[str]) -> list[int]:
        return sorted({min(SLICES - 1, int(day_fraction(stamp) * SLICES)) for stamp in stamps})

    first_slices = occupied_slices([stamp for stamp, _value in by_day[window[0]]])
    last_slices = occupied_slices([stamp for stamp, _value in by_day[window[-1]]])
    x_min = first_slices[0] / SLICES
    x_max = (len(window) - 1) + (last_slices[-1] + 1) / SLICES
    if len(window) == 1:
        # 只有一天时两端都作用在同一天上，别把自己裁没了
        x_min = min(x_min, x_max - 1.0 / SLICES)
    trim_left = x_min > 0.0
    trim_right = x_max < float(len(window))
""",
    """    x_min = layout["xMin"]
    x_max = layout["xMax"]
    trim_left = layout["trimLeft"]
    trim_right = layout["trimRight"]

    if kind == "spend":
        return build_spend(rows, window, layout)
""",
)

# 4) tickPositions 改从 layout 取
swap(
    '"tickPositions": [tick_center(index) for index in range(len(window))],',
    '"tickPositions": layout["ticks"],',
)

# 5) 返回体标记 kind
swap(
    '''    return {
        "ok": True,
        "days": len(window),''',
    '''    return {
        "ok": True,
        "kind": "line",
        "days": len(window),''',
)

# 6) 追加 build_spend：放在 render 之前
swap(
    """def render(meta: dict, out_path: str) -> None:""",
    '''def build_spend(rows: list[tuple[str, str, float]], window: list[str], layout: dict) -> dict:
    """每天的花费 = 前一天日终余额 − 当天日终余额（充值/上涨当天记 0）。"""
    finals = daily_finals(rows)
    ordered = all_days(rows)
    previous_of = {date: (ordered[index - 1] if index > 0 else None) for index, date in enumerate(ordered)}

    bars = []
    for index, date in enumerate(window):
        prior_date = previous_of.get(date)
        prior = finals.get(prior_date) if prior_date else None
        today = finals[date]
        spend = max(0.0, round(prior - today, 6)) if prior is not None else 0.0
        left_edge = layout["xMin"] if index == 0 else float(index)
        right_edge = layout["xMax"] if index == len(window) - 1 else float(index + 1)
        bars.append(
            {
                "date": date,
                "label": date[5:],
                "value": spend,
                "text": label_text(spend) if spend > 0 else "",
                "x": (left_edge + right_edge) / 2,
                "width": (right_edge - left_edge) * 0.62,
            }
        )

    max_spend = max((bar["value"] for bar in bars), default=0.0)
    hi = max(float(AXIS_STEP), float(math.ceil(max_spend / AXIS_STEP) * AXIS_STEP))
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
        "tickPositions": layout["ticks"],
        "dayBoundaries": list(range(len(window) + 1)),
        "trimLeft": layout["trimLeft"],
        "trimRight": layout["trimRight"],
        "xRange": [layout["xMin"], layout["xMax"]],
        "bars": bars,
        "total": round(sum(bar["value"] for bar in bars), 6),
        "min": min((bar["value"] for bar in bars), default=0.0),
        "max": max_spend,
    }


def render(meta: dict, out_path: str) -> None:''',
)

# 7) render：按 kind 分支画柱状图
swap(
    '''    points = meta["pointsRaw"]
    xs = [point["x"] for point in points]
    ys = [point["y"] for point in points]
    lo, hi = meta["ylim"]

    count = max(1, meta["days"])
    fig, ax = plt.subplots(figsize=(max(9.0, 0.24 * count + 4.0), 5.6), dpi=130)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
''',
    '''    kind = meta.get("kind", "line")
    crowded = meta["days"] > 12
    points = meta.get("pointsRaw") or []
    lo, hi = meta["ylim"]

    count = max(1, meta["days"])
    fig, ax = plt.subplots(figsize=(max(9.0, 0.24 * count + 4.0), 5.6), dpi=130)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)

    if kind == "spend":
        for bar in meta["bars"]:
            ax.bar(
                bar["x"],
                bar["value"],
                width=bar["width"],
                color=COLOR_SPEND,
                edgecolor="none",
                zorder=3,
            )
        for bar in meta["bars"]:
            if not bar["text"]:
                continue
            ax.annotate(
                bar["text"],
                xy=(bar["x"], bar["value"]),
                xytext=(0, 7 if crowded else 9),
                textcoords="offset points",
                ha="center",
                va="bottom",
                rotation=45 if crowded else 0,
                rotation_mode="anchor",
                fontsize=7.5 if crowded else 8,
                color=TEXT,
                bbox={"boxstyle": "round,pad=0.18", "facecolor": "#ffffff", "edgecolor": "none", "alpha": 0.92},
            )
''',
)

# 8) render：折线/柱图共用部分的 crowded 变量不再重复定义
swap(
    '''    for item in meta.get("labels") or meta["dailyLast"]:
        crowded = meta["days"] > 12
        below = bool(item.get("below"))''',
    '''    for item in meta.get("labels") or meta.get("dailyLast") or []:
        below = bool(item.get("below"))''',
)

# 9) xlim / ylim 对柱图同样适用：min_x/max_x 来自点；柱图用 xRange
swap(
    '''    # 左右只留一点点边；首/末日只有半天数据时按 xRange 收掉空的那半格。
    max_x = max(point["x"] for point in points)
    min_x = min(point["x"] for point in points)''',
    '''    # 左右只留一点点边；首/末日只有半天数据时按 xRange 收掉空的那半格。
    if points:
        max_x = max(point["x"] for point in points)
        min_x = min(point["x"] for point in points)
    else:
        max_x = max(bar["x"] for bar in meta["bars"])
        min_x = min(bar["x"] for bar in meta["bars"])''',
)

# 10) 标题与纵轴名按 kind 切换
swap(
    '''    ax.set_title("谷谷股 · 每日最终余额", loc="left", fontsize=14, color=TITLE, pad=14)
    ax.set_ylabel("余额", fontsize=9.5, color=TEXT, labelpad=8)''',
    '''    title = "谷谷股 · 花费柱状图" if kind == "spend" else "谷谷股 · 余额折线图"
    ax.set_title(title, loc="left", fontsize=14, color=TITLE, pad=14)
    ax.set_ylabel("花费" if kind == "spend" else "余额", fontsize=9.5, color=TEXT, labelpad=8)''',
)

# 11) main：新增 --kind / --from / --to
swap(
    '''    parser.add_argument("--max-days", type=int, default=60, help="最多显示多少个有数据的日期")''',
    '''    parser.add_argument("--max-days", type=int, default=60, help="最多显示多少个有数据的日期")
    parser.add_argument("--kind", choices=("line", "spend"), default="line", help="line=余额折线图 / spend=花费柱状图")
    parser.add_argument("--from", dest="date_from", default=None, help="起始日期 YYYY-MM-DD（含）")
    parser.add_argument("--to", dest="date_to", default=None, help="结束日期 YYYY-MM-DD（含）")''',
)

swap(
    "        meta = build(args.csv, args.max_days)",
    "        meta = build(args.csv, args.max_days, args.kind, args.date_from, args.date_to)",
)

path.write_text(src, encoding="utf-8")
print("patched", path)
