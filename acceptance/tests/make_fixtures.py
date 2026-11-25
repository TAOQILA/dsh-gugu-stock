#!/usr/bin/env python3
"""Generate deterministic CSV fixtures for the 谷谷股 acceptance tests.

Rows are written oldest-first (the order the plugin appends them), UTF-8
with BOM and CRLF line endings, header `时间,来源,数值`.
"""
from __future__ import annotations

import csv
import datetime as dt
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT_DIR = HERE.parent / "fixtures"


def write_csv(name: str, rows: list[tuple[dt.datetime, float]]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    target = OUT_DIR / name
    with target.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\r\n")
        writer.writerow(["时间", "余额"])
        for stamp, balance in rows:
            writer.writerow([stamp.strftime("%Y-%m-%d %H:%M"), f"{balance:.6f}".rstrip("0").rstrip(".")])
    print(f"{target.name}: {len(rows)} rows")


def daily(rows: list[tuple[dt.datetime, float]]) -> list[tuple[dt.datetime, float]]:
    """Newest-first is what the file wants; fixtures are built oldest-first."""
    return list(reversed(rows))


def wavy(days: int, start: dt.datetime, base: float) -> list[tuple[dt.datetime, float]]:
    rows: list[tuple[dt.datetime, float]] = []
    for day in range(days):
        date = start + dt.timedelta(days=day)
        for slot, hour in enumerate((9, 15, 21)):
            value = base + 14.0 * math.sin(day / 4.0) + 5.0 * math.cos(slot * 1.7) - 0.35 * day
            rows.append((date.replace(hour=hour, minute=0), round(value, 6)))
    return rows


def main() -> int:
    write_csv("sample60.csv", daily(wavy(60, dt.datetime(2026, 9, 1), 140.0)))
    write_csv("sample70.csv", daily(wavy(70, dt.datetime(2026, 8, 10), 160.0)))

    rising: list[tuple[dt.datetime, float]] = []
    for day in range(4):
        date = dt.datetime(2026, 10, 1) + dt.timedelta(days=day)
        for slot, hour in enumerate((9, 18)):
            rising.append((date.replace(hour=hour), 10.0 + day * 4 + slot * 2))
    write_csv("sample-up.csv", daily(rising))

    flat: list[tuple[dt.datetime, float]] = []
    for day in range(6):
        date = dt.datetime(2026, 10, 5) + dt.timedelta(days=day)
        for hour in (9, 21):
            flat.append((date.replace(hour=hour), 100.0))
    write_csv("sample-flat.csv", daily(flat))

    # One day, two rows in the same minute: the plugin must replace, not append.
    write_csv(
        "sample-same-minute.csv",
        [
            (dt.datetime(2026, 10, 9, 12, 30), 8.11),
            (dt.datetime(2026, 10, 9, 12, 30), 8.22),
        ],
    )

    # Single day with 6 rows: the chart must mark BOTH the first and the last
    # node (a one-day window otherwise shows only one labelled point).
    single: list[tuple[dt.datetime, float]] = []
    for slot, hour in enumerate((9, 10, 12, 14, 16, 18)):
        single.append((dt.datetime(2026, 11, 21, hour, 7), 26.78 - slot * 0.63))
    write_csv("sample-single-day.csv", daily(single))

    # Edge days that only cover half of their 24h: first day in the evening,
    # last day in the early morning. The chart should drop the empty halves.
    write_csv(
        "sample-edge.csv",
        daily(
            [
                (dt.datetime(2026, 10, 1, 21, 0), 30.0),
                (dt.datetime(2026, 10, 1, 23, 0), 28.0),
                (dt.datetime(2026, 10, 2, 2, 0), 26.0),
                (dt.datetime(2026, 10, 2, 4, 0), 27.0),
            ]
        ),
    )

    # Same span but data reaching into both halves -> nothing may be trimmed.
    write_csv(
        "sample-full-day.csv",
        daily(
            [
                (dt.datetime(2026, 10, 3, 6, 0), 30.0),
                (dt.datetime(2026, 10, 3, 20, 0), 29.0),
                (dt.datetime(2026, 10, 4, 7, 0), 31.0),
                (dt.datetime(2026, 10, 4, 19, 0), 32.0),
            ]
        ),
    )
    # 日内有明确峰谷、且峰谷都不在当天首末两点上：用于验证「每天峰谷标数字」。
    write_csv(
        "sample-daily-peak.csv",
        daily(
            [
                (dt.datetime(2026, 10, 5, 8, 0), 40.0),
                (dt.datetime(2026, 10, 5, 12, 0), 47.5),
                (dt.datetime(2026, 10, 5, 18, 0), 41.0),
                (dt.datetime(2026, 10, 6, 9, 0), 43.0),
                (dt.datetime(2026, 10, 6, 13, 0), 38.5),
                (dt.datetime(2026, 10, 6, 22, 0), 44.0),
            ]
        ),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
