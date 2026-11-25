"""Assert the 60-day window: only the last 60 dated days are drawn.

Usage: py -3.12 assert_window.py <chart-70.json> <fixture.csv> [max_days]
The fixture CSV's distinct dates decide the expected window, so the check does
not hard-code calendar values.
"""
from __future__ import annotations

import csv
import json
import sys
from datetime import datetime
from pathlib import Path


def dates_of(path: Path) -> list[str]:
    seen: set[str] = set()
    raw = path.read_text(encoding="utf-8-sig").splitlines()[1:]
    for line in raw:
        if not line.strip():
            continue
        stamp = next(csv.reader([line]))[0].strip()
        seen.add(datetime.strptime(stamp[:10].replace("/", "-"), "%Y-%m-%d").strftime("%Y-%m-%d"))
    return sorted(seen)


def main() -> int:
    meta_path = Path(sys.argv[1])
    fixture = Path(sys.argv[2])
    max_days = int(sys.argv[3]) if len(sys.argv) > 3 else 60
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    all_days = dates_of(fixture)
    expected = all_days[-max_days:]
    failures: list[str] = []

    if meta.get("days") != len(expected):
        failures.append(f"days {meta.get('days')} != {len(expected)}")
    if meta.get("firstDate") != expected[0]:
        failures.append(f"firstDate {meta.get('firstDate')} != {expected[0]}")
    if meta.get("lastDate") != expected[-1]:
        failures.append(f"lastDate {meta.get('lastDate')} != {expected[-1]}")
    if len(meta.get("dates") or []) != len(expected):
        failures.append(f"dates[] length {len(meta.get('dates') or [])} != {len(expected)}")
    if len(all_days) <= max_days:
        failures.append("fixture has no extra days to trim")
    elif expected[0] == all_days[0]:
        failures.append("window did not trim the oldest days")

    for failure in failures:
        print("FAIL", failure)
    if failures:
        return 1
    dropped = len(all_days) - len(expected)
    print(f"WINDOW_OK days={meta['days']} first={meta['firstDate']} last={meta['lastDate']} dropped={dropped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
