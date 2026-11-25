#!/usr/bin/env python3
"""Assert the 谷谷股 date-range contract (P0 C18).

Covers the CLI side of the date picker: an explicit --from/--to selects exactly
those days, a reversed or empty range exits 2 with GUGU_RANGE instead of drawing
a misleading chart, and the 60-day default still holds when no range is given.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
from _plugin_path import CHART_PY as SCRIPT
FIXTURES = HERE.parent / "fixtures"

failures: list[str] = []
checks = 0


def check(condition: bool, label: str, detail: str = "") -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(f"{label}{(' — ' + detail) if detail else ''}")


def run(extra: list[str], fixture: str = "sample60.csv") -> tuple[int, str, str]:
    out = pathlib.Path(tempfile.gettempdir()) / f"gugu-range-{abs(hash(tuple(extra)))}.png"
    args = [sys.executable, str(SCRIPT), "--csv", str(FIXTURES / fixture), "--out", str(out), "--json"]
    args.extend(extra)
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    proc = subprocess.run(
        args,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=180,
    )
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def meta_of(stdout: str) -> dict:
    line = next((item for item in reversed(stdout.splitlines()) if item.startswith("GUGU_RESULT ")), None)
    return json.loads(line[len("GUGU_RESULT ") :]) if line else {}


def main() -> int:
    code, stdout, stderr = run(["--from", "2026-09-01", "--to", "2026-09-10"])
    check(code == 0, "range: ten-day window exits 0", f"exit {code} {stderr[-300:]}")
    meta = meta_of(stdout)
    check(meta.get("days") == 10, "range: exactly ten days are drawn", str(meta.get("days")))
    check(meta.get("points") == 30, "range: every row inside the window is drawn", str(meta.get("points")))
    check(meta.get("firstDate") == "2026-09-01", "range: first date honoured", str(meta.get("firstDate")))
    check(meta.get("lastDate") == "2026-09-10", "range: last date honoured", str(meta.get("lastDate")))
    check(len(meta.get("dates") or []) == 10, "range: one x label per day", str(len(meta.get("dates") or [])))
    check(meta.get("dates", [None])[0] == "09-01", "range: labels stay MM-DD", str(meta.get("dates", [])[:1]))

    code, stdout, stderr = run([])
    check(code == 0, "default: no range exits 0", f"exit {code} {stderr[-300:]}")
    meta = meta_of(stdout)
    check(meta.get("days") == 60, "default: falls back to the last 60 days", str(meta.get("days")))

    code, stdout, stderr = run(["--from", "2026-09-10", "--to", "2026-09-01"])
    check(code == 2, "range: reversed dates exit 2", f"exit {code}")
    check("GUGU_RANGE" in stderr, "range: reversed dates print GUGU_RANGE", stderr[-200:])

    code, stdout, stderr = run(["--from", "2020-01-01", "--to", "2020-02-01"])
    check(code == 2, "range: empty window exits 2", f"exit {code}")
    check("GUGU_RANGE" in stderr, "range: empty window prints GUGU_RANGE", stderr[-200:])

    code, stdout, stderr = run(["--kind", "spend", "--from", "2026-09-01", "--to", "2026-09-05"])
    check(code == 0, "range: spend chart accepts the same window", f"exit {code} {stderr[-300:]}")
    meta = meta_of(stdout)
    check(meta.get("kind") == "spend" and meta.get("days") == 5, "range: spend meta keeps kind and window", str((meta.get("kind"), meta.get("days"))))

    if failures:
        print(f"FAIL {len(failures)}/{checks}")
        for item in failures:
            print("  - " + item)
        return 1
    print(f"RANGE_OK {checks} assertions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
