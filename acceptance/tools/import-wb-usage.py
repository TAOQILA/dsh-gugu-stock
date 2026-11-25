# -*- coding: utf-8 -*-
"""把 WorkBuddy 的「积分消耗明细」xlsx 折算成 wb 余额行，纯追加进同一个 CSV。

背景（用户 m08422）：`request-usage-2026-11-22.xlsx` 里全是 wb 记录，但
第二列是**那一次消费的积分**，不是余额。要得到当时的余额，用现在 CSV 里
**最老的一条 wb 余额**当锚点往回推：

    余额(某次消费之后) = 锚点余额 + 该时刻之后（含锚点之前）发生的所有消费之和

锚点之后的消费就顺着往前减。同一时间戳的多条消费先求和（同一行只留一条，
记「这些消费都扣完之后」的余额）。

用法：
    py -3.12 acceptance/tools/import-wb-usage.py [--dry-run]

写完行后由 `lib/csv.js` 的 `normalizeCsvFile()` 负责把文件排回升序
（只重排、不删行、不改编码）。
"""

import argparse
import io
import json
import os
import re
import sys
from collections import defaultdict

XLSX = os.environ.get("GUGU_WB_XLSX", "request-usage.xlsx")
CSV = os.environ.get("GUGU_CSV_PATH", os.path.join(os.path.expanduser("~"), ".dsh", "data", "gugu-stock", "balances-v2.csv"))
KIND = "wb"

TIME_RE = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$")


def norm_time(text):
    m = TIME_RE.match(str(text).strip())
    if not m:
        return None
    y, mo, d, h, mi, s = m.groups()
    return "%s-%02d-%02d %02d:%s:%s" % (y, int(mo), int(d), int(h), mi, s or "00")


def fmt_number(value):
    text = ("%.6f" % value).rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


def read_csv(path):
    raw = io.open(path, "rb").read()
    enc = "gbk" if raw[:1] == b"\xca" else "utf-8-sig"
    nl = b"\r\n" if b"\r\n" in raw else b"\n"
    lines = [line for line in raw.split(nl) if line.strip()]
    header, body = lines[0], lines[1:]
    rows = []
    for line in body:
        cells = line.decode(enc, "replace").split(",")
        if len(cells) < 3:
            continue
        try:
            value = float(cells[2])
        except ValueError:
            continue
        rows.append((norm_time(cells[0]) or cells[0], cells[1].strip(), value))
    return {"path": path, "encoding": enc, "newline": nl, "header": header, "body": body, "rows": rows}


def read_usage(path):
    from openpyxl import load_workbook

    book = load_workbook(path, read_only=True, data_only=True)
    sheet = book[book.sheetnames[0]]
    per_time = defaultdict(float)
    count = 0
    for record in sheet.iter_rows(values_only=True):
        if record[0] is None:
            continue
        stamp = norm_time(record[0])
        if stamp is None:
            continue
        spend = float(str(record[1] if record[1] is not None else 0).replace(",", "") or 0)
        per_time[stamp] += spend
        count += 1
    book.close()
    return dict(per_time), count


def derive(per_time, anchor_time, anchor_value):
    """返回 {时间: 折算余额}，值为「该时刻的消费扣完之后」的余额。"""
    before = {t: s for t, s in per_time.items() if t < anchor_time}
    after = {t: s for t, s in per_time.items() if t > anchor_time}
    out = {}
    running = anchor_value
    for stamp in sorted(before, reverse=True):
        out[stamp] = running
        running += before[stamp]
    running = anchor_value
    for stamp in sorted(after):
        running -= after[stamp]
        out[stamp] = running
    return out, before, after


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", default=XLSX)
    parser.add_argument("--csv", default=CSV)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    per_time, raw_count = read_usage(args.xlsx)
    table = read_csv(args.csv)

    wb_rows = [row for row in table["rows"] if row[1] == KIND]
    if not wb_rows:
        print("NO_WB_ANCHOR: CSV 里没有 wb 记录，无从推算", file=sys.stderr)
        return 2
    anchor_time, _, anchor_value = min(wb_rows, key=lambda row: row[0])

    derived, before, after = derive(per_time, anchor_time, anchor_value)

    existing = {(row[0], row[1]) for row in table["rows"]}
    fresh = [(stamp, value) for stamp, value in sorted(derived.items()) if (stamp, KIND) not in existing]
    skipped = len(derived) - len(fresh)

    lines = [("%s,%s,%s" % (stamp, KIND, fmt_number(value))).encode("ascii") for stamp, value in fresh]
    if not args.dry_run and lines:
        with io.open(args.csv, "ab") as handle:
            for line in lines:
                handle.write(line + table["newline"])

    report = {
        "xlsxRows": raw_count,
        "uniqueTimes": len(per_time),
        "anchorTime": anchor_time,
        "anchorBalance": anchor_value,
        "eventsBeforeAnchor": len(before),
        "eventsAfterAnchor": len(after),
        "spendBeforeAnchor": round(sum(before.values()), 6),
        "spendAfterAnchor": round(sum(after.values()), 6),
        "rowsToAdd": len(fresh),
        "skippedExisting": skipped,
        "earliest": (min(derived) if derived else None),
        "earliestBalance": (derived[min(derived)] if derived else None),
        "latest": (max(derived) if derived else None),
        "latestBalance": (derived[max(derived)] if derived else None),
        "balanceAtAnchorMinusNothing": round(anchor_value, 6),
        "dryRun": bool(args.dry_run),
        "csvBefore": len(table["rows"]),
    }
    print("WB_USAGE_IMPORT " + json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())