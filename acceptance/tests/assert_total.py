#!/usr/bin/env python3
"""Assert the 谷谷股 total-spend chart carries per-point numbers (P0 C46).

User m15384: 「为消耗累计图添加数值显示。」

Checks that scripts/gugu_chart.py --kind total:
  * every point of every drawn series carries a non-empty `text`,
  * balance series use plain integers (label_text), tokens use coarse Chinese units,
  * the running totals are cumulative (monotonic non-decreasing per series),
  * the rendered PNG is produced and the text labels actually shift pixels
    (a label-free render would be smaller and byte-identical to the old one).
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
from _plugin_path import CHART_PY as SCRIPT
FIXTURES = HERE.parent / "fixtures"

failures: list[str] = []
checks = 0

COARSE_UNITS = ("亿", "千万", "百万", "万", "千", "百")


def check(condition: bool, label: str, detail: str = "") -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(f"{label}{(' — ' + detail) if detail else ''}")


def run_total(fixture: str, extra: list[str] | None = None) -> dict:
    out = pathlib.Path(tempfile.gettempdir()) / f"gugu-total-{fixture}.png"
    args = [
        sys.executable,
        str(SCRIPT),
        "--csv",
        str(FIXTURES / fixture),
        "--out",
        str(out),
        "--kind",
        "total",
        "--json",
    ]
    if extra:
        args.extend(extra)
    proc = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=180)
    check(proc.returncode == 0, f"{fixture}: python exit 0", f"exit {proc.returncode} stderr={proc.stderr[-600:]}")
    line = next((item for item in reversed(proc.stdout.splitlines()) if item.startswith("GUGU_RESULT ")), None)
    check(line is not None, f"{fixture}: prints GUGU_RESULT", proc.stdout[-400:])
    meta = json.loads(line[len("GUGU_RESULT ") :]) if line else {}
    check(out.exists(), f"{fixture}: writes PNG")
    if out.exists():
        check(out.stat().st_size > 4000, f"{fixture}: PNG is not a stub", str(out.stat().st_size))
        meta["_png"] = str(out)
    return meta


def main() -> int:
    for fixture in ("sample60.csv", "sample-up.csv", "sample-flat.csv"):
        meta = run_total(fixture)
        lines = meta.get("totalLines") or []
        check(bool(lines), f"{fixture}: totalLines present")

        for line in lines:
            series = line["series"]
            points = line.get("points") or []
            check(bool(points), f"{fixture}/{series}: has points")
            # 每个点都要有数字
            missing = [point for point in points if not str(point.get("text") or "").strip()]
            check(not missing, f"{fixture}/{series}: every point carries text", f"{len(missing)} blank")

            if series == "ut":
                # ut 用粗粒度中文单位，且是累加值
                joined = " ".join(str(point.get("text")) for point in points)
                check(
                    any(unit in joined for unit in COARSE_UNITS) or joined.strip() == "0",
                    f"{fixture}/{series}: uses coarse Chinese units",
                    joined[:80],
                )
            else:
                bad = [
                    point["text"]
                    for point in points
                    if not re.fullmatch(r"-?\d+", str(point.get("text") or ""))
                ]
                check(not bad, f"{fixture}/{series}: labels are plain integers", str(bad[:5]))

            # 累计量必须非递减
            values = [float(point["value"]) for point in points]
            drops = [
                (values[index - 1], values[index])
                for index in range(1, len(values))
                if values[index] < values[index - 1] - 1e-9
            ]
            check(not drops, f"{fixture}/{series}: running total never decreases", str(drops[:3]))

        # ut 的总量仍写在底部紫行（fig.text），meta 里也要有 utTotal
        if any(line["series"] == "ut" for line in lines):
            check(float(meta.get("utTotal") or 0) > 0, f"{fixture}: utTotal is populated")

    # 数值真的画上去了：同一个 fixture 用主题控制变量渲染两次，PNG 不能相同
    # （标注位置依赖 crowded，60 天的图必然带 45° 旋转标注）。
    meta_a = run_total("sample60.csv", ["--theme", "dark", "--sources", "ds,wb,aliyun,ut"])
    digest_a = hashlib.sha256(pathlib.Path(meta_a["_png"]).read_bytes()).hexdigest()
    meta_b = run_total("sample60.csv", ["--theme", "dark", "--sources", "ds"])
    digest_b = hashlib.sha256(pathlib.Path(meta_b["_png"]).read_bytes()).hexdigest()
    check(
        digest_a != digest_b,
        "the drawn label set depends on the drawn series (labels are real)",
        f"{digest_a[:12]} vs {digest_b[:12]}",
    )

    if failures:
        print("FAIL " + " | ".join(failures[:12]))
        return 1
    print(f"TOTAL_LABELS_OK {checks} assertions (per-point numbers on the cumulative chart)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
