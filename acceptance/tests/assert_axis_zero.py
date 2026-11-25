#!/usr/bin/env python3
"""Assert the balance line chart never wastes a whole 10-point band under zero (P0 C47).

User m15687: 「余额折线图 纵轴底部有一个 -10~0 的空白区间，请修复。」

DS balance often sits at a hair below zero (-0.011989, float noise from
topped_up_balance arithmetic). `axis_bounds()` used to floor that to -10, leaving
an empty band at the bottom while every line hugged the top of it.

Rule: if the lowest value is negative but within AXIS_STEP/10 of zero, the axis
starts at 0. A genuinely negative balance (say -5) still gets floored so the
data stays visible.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
from _plugin_path import CHART_PY as SCRIPT

failures: list[str] = []
checks = 0


def check(condition: bool, label: str, detail: str = "") -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(f"{label}{(' — ' + detail) if detail else ''}")


def write_csv(path: pathlib.Path, rows: list[tuple[str, str, str]]) -> None:
    lines = ["\ufeff时间,来源,数值"]
    lines += [f"{when},{kind},{value}" for when, kind, value in rows]
    path.write_text("\r\n".join(lines) + "\r\n", encoding="utf-8")


def render(name: str, rows: list[tuple[str, str, str]]) -> dict:
    csv_path = pathlib.Path(tempfile.gettempdir()) / f"gugu-axis-{name}.csv"
    out = pathlib.Path(tempfile.gettempdir()) / f"gugu-axis-{name}.png"
    write_csv(csv_path, rows)
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--csv",
            str(csv_path),
            "--out",
            str(out),
            "--kind",
            "line",
            "--sources",
            "ds",
            "--json",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=180,
    )
    check(proc.returncode == 0, f"{name}: python exit 0", proc.stderr[-500:])
    line = next((item for item in reversed(proc.stdout.splitlines()) if item.startswith("GUGU_RESULT ")), None)
    check(line is not None, f"{name}: prints GUGU_RESULT", proc.stdout[-300:])
    return json.loads(line[len("GUGU_RESULT ") :]) if line else {}


def main() -> int:
    # 1) 负的浮点噪声：-0.011989 必须从 0 起，不留 -10 空格
    noise = render(
        "noise",
        [
            ("2026-11-23 10:00", "ds", "15.40"),
            ("2026-11-24 10:00", "ds", "0.02"),
            ("2026-11-25 10:00", "ds", "-0.011989"),
        ],
    )
    lo, hi = noise.get("ylim") or [None, None]
    check(lo == 0, "float noise: axis starts exactly at 0", str(noise.get("ylim")))
    check(hi % 10 == 0, "float noise: top still snaps to 10", str(hi))
    # 最低点会比轴低一丁点（<1 个单位，一个像素都不到），这是刻意的：
    # 为了不为一格浮点噪声留出整整 10 的空白带。
    check(
        float(noise.get("min")) > -1.0 and float(noise.get("max")) <= hi,
        "float noise: any overshoot below the axis is sub-pixel",
        f"{noise.get('ylim')} vs {noise.get('min')}/{noise.get('max')}",
    )

    # 2) 真的负余额：-5.2 必须向下取整到 -10，模型不能把负值藏掉
    real_negative = render(
        "negative",
        [
            ("2026-11-24 10:00", "ds", "4.00"),
            ("2026-11-25 10:00", "ds", "-5.2"),
        ],
    )
    lo, hi = real_negative.get("ylim") or [None, None]
    check(lo == -10, "real negative: axis floor stays at -10", str(real_negative.get("ylim")))
    check(lo <= -5.2 <= hi, "real negative: the negative point is inside the axis", str(real_negative.get("ylim")))

    # 3) 纯正数照旧
    positive = render(
        "positive",
        [
            ("2026-11-24 10:00", "ds", "12.00"),
            ("2026-11-25 10:00", "ds", "37.50"),
        ],
    )
    lo, hi = positive.get("ylim") or [None, None]
    check(lo == 10, "positive: floor is the usual 10 multiple", str(positive.get("ylim")))
    check(hi == 40, "positive: ceil is the usual 10 multiple", str(positive.get("ylim")))

    # 4) 全零：0..10，不再出现 -10..10
    zeroed = render(
        "zero",
        [
            ("2026-11-25 09:00", "ds", "0"),
            ("2026-11-25 10:00", "ds", "0"),
        ],
    )
    lo, hi = zeroed.get("ylim") or [None, None]
    check(lo == 0, "all zero: axis starts at 0", str(zeroed.get("ylim")))
    check(hi >= 10, "all zero: axis still has height", str(zeroed.get("ylim")))

    if failures:
        print("FAIL " + " | ".join(failures[:10]))
        return 1
    print(f"AXIS_ZERO_OK {checks} assertions (no empty band under zero)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
