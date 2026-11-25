"""Assert flat/up chart metadata: a constant series stays light grey and the
y axis pads out instead of collapsing onto the data (bounds snap to 10).

Usage: py -3.12 assert_flat.py <chart-flat.json> [chart-up.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def load(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def check_flat(meta: dict) -> list[str]:
    problems: list[str] = []
    lo, hi = meta["ylim"]
    if lo % 10 or hi % 10:
        problems.append(f"ylim {meta['ylim']} is not on 10 multiples")
    if hi - lo < 10:
        problems.append(f"flat span {hi - lo} < 10")
    if meta["min"] != meta["max"]:
        problems.append("fixture is not flat")
    else:
        if not (lo < meta["min"] < hi):
            problems.append(f"flat value {meta['min']} sits on an axis bound {meta['ylim']}")
    segments = meta["segments"]
    if segments["up"] or segments["down"]:
        problems.append(f"flat series produced coloured segments: {segments}")
    if segments["flat"] != meta["points"] - 1:
        problems.append(f"flat segments {segments['flat']} != points-1 {meta['points'] - 1}")
    return problems


def check_up(meta: dict) -> list[str]:
    problems: list[str] = []
    if meta["segments"]["down"] or meta["segments"]["flat"]:
        problems.append(f"rising series produced non-red segments: {meta['segments']}")
    if meta["segments"]["up"] != meta["points"] - 1:
        problems.append(f"up segments {meta['segments']['up']} != points-1 {meta['points'] - 1}")
    return problems


def main() -> int:
    flat = load(sys.argv[1])
    problems = check_flat(flat)
    if len(sys.argv) > 2:
        problems += check_up(load(sys.argv[2]))
    for problem in problems:
        print("FAIL", problem)
    if problems:
        return 1
    span = flat["ylim"][1] - flat["ylim"][0]
    print(f"FLAT_OK flat-span={span:g} ylim={flat['ylim']} all-segments-grey" + (" up-all-red" if len(sys.argv) > 2 else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
