#!/usr/bin/env python3
"""Assert the 谷谷股 chart contract against the generated metadata (P0 checks).

Runs scripts/gugu_chart.py on each fixture, parses the `GUGU_RESULT <json>`
line, and validates: window selection, slot layout (one slot per day, never
condensed), equal tick spacing, MM-DD labels,
10-step axis and gridlines, one node per CSV row, one marker per slot (its last
node), segment colour buckets, and the PNG payload.
"""
from __future__ import annotations

import json
import math
import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
from _plugin_path import PLUGIN, CHART_PY as SCRIPT
FIXTURES = HERE.parent / "fixtures"
TIME_RE = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})")
LABEL_RE = re.compile(r"^\d{2}-\d{2}$")
SLICES = 8

failures: list[str] = []
checks = 0


def check(condition: bool, label: str, detail: str = "") -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(f"{label}{(' — ' + detail) if detail else ''}")


def parse_fixture(name: str) -> list[tuple[str, str, str]]:
    text = (FIXTURES / name).read_text(encoding="utf-8-sig")
    rows: list[tuple[str, str, str]] = []
    for line in text.splitlines()[1:]:
        line = line.strip()
        if not line:
            continue
        parts = line.split(",")
        if len(parts) < 2:
            continue
        stamp = parts[0].strip()
        match = TIME_RE.match(stamp)
        if not match:
            continue
        rows.append((stamp[:10], stamp[11:16], parts[1].strip()))
    rows.sort(key=lambda row: (row[0], row[1]))
    return rows


def run_chart(fixture: str, max_days: int = 60) -> dict:
    out = pathlib.Path(tempfile.gettempdir()) / f"gugu-check-{fixture}.png"
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--csv",
            str(FIXTURES / fixture),
            "--out",
            str(out),
            "--max-days",
            str(max_days),
            "--json",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=180,
    )
    check(proc.returncode == 0, f"{fixture}: python exit 0", f"exit {proc.returncode} stderr={proc.stderr[-600:]}")
    result_line = next(
        (line for line in reversed(proc.stdout.splitlines()) if line.startswith("GUGU_RESULT ")),
        None,
    )
    check(result_line is not None, f"{fixture}: prints GUGU_RESULT", proc.stdout[-400:])
    meta = json.loads(result_line[len("GUGU_RESULT ") :]) if result_line else {}
    check(out.exists(), f"{fixture}: writes PNG")
    if out.exists():
        check(out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n", f"{fixture}: PNG signature")
    return meta


FIXTURES_RUN: set[str] = set()


def clock_frac(stamp: str) -> float:
    hour, minute = (int(part) for part in stamp.split(":")[:2])
    return (hour * 60 + minute) / (24 * 60)


def expected_slots(days: list[str], window: list[tuple[str, str, str]]) -> list[list[str]]:
    """Mirror build_slots(): one slot per day — no condensing, ever."""
    return [[date] for date in days]


def verify(name: str, meta: dict, max_days: int = 60) -> None:
    FIXTURES_RUN.add(name)
    rows = parse_fixture(name)
    days_seen: list[str] = []
    for date, _time, _bal in rows:
        if not days_seen or days_seen[-1] != date:
            days_seen.append(date)
    expect_days = days_seen[-max_days:]
    window = [row for row in rows if row[0] in expect_days]
    expect_points = len(window)
    slots = expected_slots(expect_days, window)
    slot_labels = [days[0][5:] for days in slots]

    check(meta.get("ok") is True, f"{name}: meta ok")
    check(meta.get("days") == len(expect_days), f"{name}: days == {len(expect_days)}", str(meta.get("days")))
    check(meta.get("points") == expect_points, f"{name}: points == {expect_points}", str(meta.get("points")))
    check(meta.get("slots") == len(slots), f"{name}: slots == {len(slots)}", str(meta.get("slots")))

    dates = meta.get("dates") or []
    check(dates == slot_labels, f"{name}: one MM-DD label per day", str(dates[:3]) + "…")
    check(all(LABEL_RE.fullmatch(d or "") for d in dates), f"{name}: every label is MM-DD (no ranges)")
    check(len(dates) == len(expect_days), f"{name}: axis shows every day", f"{len(dates)} vs {len(expect_days)}")

    check(
        meta.get("dayBoundaries") == list(range(len(slots) + 1)),
        f"{name}: vertical separators at every slot start/end",
        str(meta.get("dayBoundaries")),
    )

    # ---- 每个节点在横轴上的 x：一天一格，节点按真实时钟落在格内
    entries: list[list[tuple[str, str, str]]] = [
        [row for row in window if row[0] in days] for days in slots
    ]
    expect_point_xs: list[float] = []
    for slot_index, slot_rows in enumerate(entries):
        total = max(1, len(slot_rows))
        for order, (_date, stamp, _bal) in enumerate(slot_rows):
            if len(slots[slot_index]) == 1:
                expect_point_xs.append(slot_index + clock_frac(stamp))
            else:
                expect_point_xs.append(slot_index + (order + 0.5) / total)

    # 一天一整格，两端都不裁（m03986 删掉了「切成 8 份、丢掉空分片」的机制）
    want_range = [0.0, float(len(slots))]
    check(meta.get("trimLeft") is False, f"{name}: trimLeft is always False", str(meta.get("trimLeft")))
    check(meta.get("trimRight") is False, f"{name}: trimRight is always False", str(meta.get("trimRight")))
    check(
        all(abs((meta.get("xRange") or [None, None])[i] - want_range[i]) < 1e-9 for i in range(2)),
        f"{name}: xRange covers whole days [0, {len(slots)}]",
        str(meta.get("xRange")),
    )

    ticks = meta.get("tickPositions") or []
    expect_ticks = [slot_index + 0.5 for slot_index in range(len(slots))]
    check(
        len(ticks) == len(expect_ticks) and all(abs(ticks[i] - expect_ticks[i]) < 1e-9 for i in range(len(ticks))),
        f"{name}: slot labels centred at i+0.5",
        str(ticks[:3]) + " vs " + str(expect_ticks[:3]),
    )

    # 横轴刻度文字（m04967）：每个月只在它出现的第一天写 MM-DD，同月其余只写 DD。
    tick_labels = meta.get("tickLabels") or []
    check(len(tick_labels) == len(dates), f"{name}: one tick label per day", f"{len(tick_labels)} vs {len(dates)}")
    want_tick_labels = []
    last_month = None
    for date in expect_days:
        month = date[:7]
        want_tick_labels.append(date[5:] if month != last_month else date[8:])
        last_month = month
    check(tick_labels == want_tick_labels, f"{name}: month shown once, then day only", str(tick_labels[:4]))
    firsts_ok = True
    others_ok = True
    for index, label in enumerate(tick_labels):
        date = expect_days[index]
        previous_month = expect_days[index - 1][:7] if index else None
        if date[:7] != previous_month:
            firsts_ok = firsts_ok and label == date[5:]
        else:
            others_ok = others_ok and label == date[8:]
    check(firsts_ok, f"{name}: first day of the month carries MM-DD", str(tick_labels[:1]))
    check(others_ok, f"{name}: same month shows DD only", str(tick_labels[1:4]))

    daily = meta.get("dailyLast") or []
    check(len(daily) == len(slots), f"{name}: one final node per slot", f"{len(daily)} vs {len(slots)}")
    expect_last_xs = [expect_point_xs[-len(entries[i]) + len(entries[i]) - 1] for i in range(len(slots))]
    expect_last_xs = []
    cursor = 0
    for slot_rows in entries:
        cursor += len(slot_rows)
        expect_last_xs.append(expect_point_xs[cursor - 1])
    xs = [item.get("x") for item in daily]
    check(
        all(abs((xs[i] or 0) - expect_last_xs[i]) < 1e-9 for i in range(len(xs))),
        f"{name}: slot-final nodes sit at the last row of the slot",
        str(xs[:3]) + " vs " + str(expect_last_xs[:3]),
    )

    node_xs = meta.get("nodeXs") or []
    check(len(node_xs) == expect_points, f"{name}: every row is still a node", f"{len(node_xs)} vs {expect_points}")
    check(
        len(node_xs) == len(expect_point_xs)
        and all(abs(node_xs[i] - expect_point_xs[i]) < 1e-9 for i in range(len(node_xs))),
        f"{name}: node x == slot position (clock for single-day slots)",
        str(node_xs[:3]) + " vs " + str(expect_point_xs[:3]),
    )
    check([item.get("label") for item in daily] == dates, f"{name}: daily node labels == ticks")

    last_idx = meta.get("lastIndices") or []
    expected_last: list[int] = []
    cursor = 0
    for slot_rows in entries:
        cursor += len(slot_rows)
        expected_last.append(cursor - 1)
    check(last_idx == expected_last, f"{name}: slot-final rows identified", f"{last_idx[:5]} vs {expected_last[:5]}")

    labels = meta.get("labels") or []
    balances = [row[2] for row in window]
    peak_high = balances.index(max(balances))
    peak_low = balances.index(min(balances))
    slot_peaks: set[int] = set()
    cursor = 0
    for slot_rows in entries:
        first, last = cursor, cursor + len(slot_rows) - 1
        span = range(first, last + 1)
        for candidate in (
            max(span, key=lambda i: balances[i]),
            min(span, key=lambda i: balances[i]),
        ):
            if candidate != first and candidate != last:
                slot_peaks.add(candidate)
        cursor += len(slot_rows)
    expect_marks = sorted({0, expect_points - 1, peak_high, peak_low, *expected_last, *slot_peaks})
    check(
        meta.get("markIndices") == expect_marks,
        f"{name}: markers = slot finals + first/last + peaks + each slot's peak/trough",
        f"{meta.get('markIndices')[:5]} vs {expect_marks[:5]}",
    )
    check(len(labels) == len(expect_marks), f"{name}: {len(expect_marks)} annotated node(s)", f"{len(labels)} vs {len(expect_marks)}")
    # v1.20.5 起图上数字统一用粗粒度中文单位（1千 / 7百万 / 1亿1千万 / 67），
    # 所以这里只校验「和插件规则一致」而不要求纯数字。
    check(
        all(str(item.get("text")) == label_text_of(float(item.get("balance"))) for item in labels),
        f"{name}: node values follow the coarse Chinese rule",
        str([item.get("text") for item in labels[:3]]),
    )
    check(
        all(str(item.get("text")) == label_text_of(float(item.get("balance"))) for item in labels),
        f"{name}: node text matches the coarse label of its value",
        str([(item.get("text"), item.get("balance")) for item in labels[:2]]),
    )

    ylim = meta.get("ylim") or [None, None]
    low, high = ylim[0], ylim[1]
    check(isinstance(low, (int, float)) and isinstance(high, (int, float)), f"{name}: numeric ylim")
    if isinstance(low, (int, float)) and isinstance(high, (int, float)):
        check(low % 10 == 0, f"{name}: ylim floor is a multiple of 10", str(low))
        check(high % 10 == 0, f"{name}: ylim ceil is a multiple of 10", str(high))
        check(high > low, f"{name}: axis has height", f"{ylim}")
        check(low <= float(meta.get("min")) <= float(meta.get("max")) <= high, f"{name}: axis covers data", f"{ylim} vs {meta.get('min')}/{meta.get('max')}")
    check(meta.get("gridStep") == 10, f"{name}: gridline step is 10", str(meta.get("gridStep")))

    segments = meta.get("segments") or {}
    total = sum(int(segments.get(key) or 0) for key in ("up", "down", "flat"))
    check(total == expect_points - 1, f"{name}: every consecutive pair is a coloured segment", f"{segments}")
    check(
        "up" in segments and "down" in segments and "flat" in segments,
        f"{name}: three direction buckets reported",
    )


def label_text_of(value: float) -> str:
    """图表标注规则：直接用插件里的 coarse_label（粗粒度中文单位），测试不另抄一份。"""
    scripts = str(PLUGIN / "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    import gugu_chart

    return gugu_chart.label_text(value)


def main() -> int:
    verify("sample60.csv", run_chart("sample60.csv"))
    verify("sample70.csv", run_chart("sample70.csv"))
    verify("sample-up.csv", run_chart("sample-up.csv"))
    verify("sample-flat.csv", run_chart("sample-flat.csv"))
    verify("sample-edge.csv", run_chart("sample-edge.csv"))
    verify("sample-full-day.csv", run_chart("sample-full-day.csv"))
    verify("sample-daily-peak.csv", run_chart("sample-daily-peak.csv"))

    rising = run_chart("sample-up.csv")
    points = rising.get("points") or 0
    check((rising.get("segments") or {}).get("up") == points - 1, "sample-up.csv: every segment is rising (red)")

    flat = run_chart("sample-flat.csv")
    check((flat.get("segments") or {}).get("flat") == (flat.get("points") or 0) - 1, "sample-flat.csv: every segment is flat (grey)")
    check((flat.get("segments") or {}).get("up") == 0, "sample-flat.csv: no rising segments")
    check((flat.get("segments") or {}).get("down") == 0, "sample-flat.csv: no falling segments")
    check(flat.get("ylim") == [90, 110], "sample-flat.csv: constant 100 gets a 90..110 axis with air", str(flat.get("ylim")))
    check(flat.get("slots") == 6, "sample-flat.csv: six identical days still take six slots", str(flat.get("slots")))
    check(
        flat.get("dates") == ["10-05", "10-06", "10-07", "10-08", "10-09", "10-10"],
        "sample-flat.csv: every day keeps its own MM-DD label",
        str(flat.get("dates")),
    )
    check(flat.get("points") == 12, "sample-flat.csv: all 12 rows are still nodes", str(flat.get("points")))

    single = run_chart("sample-single-day.csv")
    single_rows = parse_fixture("sample-single-day.csv")
    verify("sample-single-day.csv", single)
    check(single.get("singleDay") is True, "sample-single-day.csv: flagged as a one-day window")
    check(single.get("days") == 1, "sample-single-day.csv: exactly one day", str(single.get("days")))
    points = single.get("points") or 0
    check(single.get("markIndices") == [0, points - 1], "sample-single-day.csv: first and last nodes are marked", str(single.get("markIndices")))
    labels = single.get("labels") or []
    check(len(labels) == 2, "sample-single-day.csv: exactly two numbered nodes", str(len(labels)))
    if len(labels) == 2:
        check(abs(float(labels[0].get("balance") or 0) - float(single_rows[0][2])) < 1e-6, "sample-single-day.csv: first label is the earliest row", str(labels[0].get("balance")))
        check(abs(float(labels[1].get("balance") or 0) - float(single_rows[-1][2])) < 1e-6, "sample-single-day.csv: last label is the latest row", str(labels[1].get("balance")))
        check(
            all(str(item.get("text")) == label_text_of(float(item.get("balance"))) for item in labels),
            "sample-single-day.csv: both labels follow the coarse Chinese rule",
            str([item.get("text") for item in labels]),
        )

    if failures:
        print(f"FAIL {len(failures)}/{checks}")
        for item in failures:
            print("  - " + item)
        return 1
    print(f"PASS {checks} assertions across {len(FIXTURES_RUN)} fixtures")
    return 0


if __name__ == "__main__":
    sys.exit(main())
