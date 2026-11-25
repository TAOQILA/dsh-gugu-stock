# -*- coding: utf-8 -*-
"""校验 wb 消耗折算：xlsx 的第二列是「那一次消费」，余额要靠最老一条 wb 余额倒推。

断言四件事：
1. 纯函数 `derive()` 的账算得对（锚点前后、余额守恒、同一时间多条合并）；
2. 对真机 xlsx + 真机锚点（600.00 @ 2026-11-11 19:56）倒推：最早 2800.00、最新 590.00；
3. 折算出的 wb 余额在消费窗口内单调不增（只消费、不充值）；
4. 结果确实写进了真机 CSV，且行是纯 ASCII、三列、无表头。
"""

import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TOOL = os.path.join(ROOT, "acceptance", "tools", "import-wb-usage.py")
# 个人数据不随仓库发布：默认路径只在本机存在，GitHub/CI 上自动 SKIP_LIVE。
XLSX = os.environ.get("GUGU_WB_XLSX") or os.path.join(os.path.expanduser("~"), "Downloads", "request-usage-2026-11-30.xlsx")
CSV = os.environ.get("GUGU_CSV_PATH") or os.path.join(os.path.expanduser("~"), ".dsh", "data", "gugu-stock", "balances-v2.csv")

# 真机事实（导入前 CSV 里最老的一条 wb 余额）
ANCHOR_TIME = "2026-11-11 19:56:00"
ANCHOR_VALUE = 600.00

fails = []
checks = 0


def ok(condition, message):
    global checks
    checks += 1
    if not condition:
        fails.append(message)


def load_tool():
    spec = importlib.util.spec_from_file_location("wb_usage", TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    tool = load_tool()

    # ---- 1. 纯函数：锚点 100，锚点前消费 1/2/3，锚点后消费 4 ----------------
    per_time = {
        "2026-11-01 00:00:00": 1.0,
        "2026-11-02 00:00:00": 2.0,
        "2026-11-03 00:00:00": 3.0,
        "2026-11-05 00:00:00": 4.0,
    }
    derived, before, after = tool.derive(per_time, "2026-11-04 00:00:00", 100.0)
    # 每个值 = 那一笔消费扣完之后的余额；越早余额越高
    ok(derived["2026-11-03 00:00:00"] == 100.0, "the event right before the anchor keeps the anchor balance")
    ok(derived["2026-11-02 00:00:00"] == 103.0, "walking back adds the later spend")
    ok(derived["2026-11-01 00:00:00"] == 105.0, "the earliest value is the anchor plus every later spend")
    ok(derived["2026-11-05 00:00:00"] == 96.0, "events after the anchor subtract forward")
    ok(len(before) == 3 and len(after) == 1, "events are split around the anchor")
    # 守恒：窗口起点余额（= 最早那笔扣完 + 那笔自己）= 锚点 + 锚点前所有消费
    window_start = derived["2026-11-01 00:00:00"] + per_time["2026-11-01 00:00:00"]
    ok(abs(window_start - (100.0 + sum(before.values()))) < 1e-9,
       "balance is conserved: window start == anchor + every spend before it")
    # 锚点之后的余额只减不增
    after_sorted = sorted(stamp for stamp in derived if stamp > "2026-11-04 00:00:00")
    ok(all(derived[after_sorted[i + 1]] <= derived[after_sorted[i]] for i in range(len(after_sorted) - 1)),
       "the derived balance never goes up after the anchor")

    # ---- 2. 真机 xlsx：用真机锚点倒推，得出已知的两个端点 --------------------
    if not (os.path.exists(XLSX) and os.path.exists(CSV)):
        print("SKIP_LIVE (personal xlsx/csv not shipped with the repo)")
        return 0

    per_time_real, raw_rows = tool.read_usage(XLSX)
    ok(raw_rows == 277, "the real workbook still has 277 usage rows (got %d)" % raw_rows)
    ok(len(per_time_real) == 228, "277 rows collapse into 228 unique timestamps (got %d)" % len(per_time_real))
    ok(abs(sum(per_time_real.values()) - 2210.0) < 1e-6, "total recorded spend is 2210.0")

    derived_real, before_real, after_real = tool.derive(per_time_real, ANCHOR_TIME, ANCHOR_VALUE)
    ok(abs(sum(before_real.values()) - 2200.0) < 1e-6, "spend before the anchor is 2200.0")
    ok(abs(sum(after_real.values()) - 10.0) < 1e-6, "spend after the anchor is 10.0")
    ok(
        abs(sum(before_real.values()) + sum(after_real.values()) - sum(per_time_real.values())) < 1e-6,
        "no spend is dropped when splitting around the anchor",
    )
    earliest_time = min(derived_real)
    latest_time = max(derived_real)
    ok(earliest_time == "2026-11-01 00:00:00", "the earliest event is 2026-11-01 00:00:00 (got %s)" % earliest_time)
    ok(abs(derived_real[earliest_time] - 2800.00) < 1e-6,
       "the earliest balance is 2800.00 (anchor + 2200.0), got %s" % derived_real[earliest_time])
    ok(abs(derived_real[latest_time] - 590.00) < 1e-6,
       "the newest balance is 590.00 (anchor - 10.0), got %s" % derived_real[latest_time])
    window = sorted(derived_real.items())
    increases = [window[i + 1][0] for i in range(len(window) - 1) if window[i + 1][1] > window[i][1] + 1e-6]
    ok(not increases, "the derived wb balance never goes up inside the usage window")

    # ---- 3. 真的写进了真机 CSV ----------------------------------------------
    table = tool.read_csv(CSV)
    live = [(row[0], row[1], row[2]) for row in table["rows"]]
    ok(any(kind == "wb" and stamp == "2026-11-01 00:00:00" and abs(float(value) - 2800.00) < 1e-6
           for stamp, kind, value in live), "the live CSV contains the earliest derived row")
    ok(any(kind == "wb" and stamp == "2026-11-11 23:08:00" and abs(float(value) - 590.00) < 1e-6
           for stamp, kind, value in live), "the live CSV contains the newest derived row")
    ok(any(kind == "wb" and stamp == ANCHOR_TIME and abs(float(value) - ANCHOR_VALUE) < 1e-6
           for stamp, kind, value in live), "the original anchor row was not touched")
    live_wb = sorted((stamp, float(value)) for stamp, kind, value in live if kind == "wb")
    window_live = [item for item in live_wb if "2026-11-01" <= item[0] <= "2026-11-11 23:08:00"]
    ok(len(window_live) >= 228, "at least 228 wb rows live in the usage window (got %d)" % len(window_live))
    live_increases = [window_live[i + 1][0] for i in range(len(window_live) - 1)
                      if window_live[i + 1][1] > window_live[i][1] + 1e-6]
    ok(not live_increases, "the live wb series has no increase inside the usage window")
    ok(any(kind == "al" and abs(float(value) - 300.0) < 1e-9 for _, kind, value in live),
       "the hand-added al 300 row is still there")

    # ---- 4. 写进行是纯 ASCII、三列、无表头 ----------------------------------
    for stamp, value in (("2026-11-01 00:00:00", 2800.00), ("2026-11-11 23:08:00", 590.00)):
        line = "%s,%s,%s" % (stamp, "wb", tool.fmt_number(value))
        line.encode("ascii")
        ok(re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},wb,-?\d+(\.\d+)?$", line) is not None,
           "row matches the CSV shape: " + line)
    ok(tool.fmt_number(2800.0000000000035) == "2800.00", "formatting trims float noise")
    ok(tool.fmt_number(590.0000000000001) == "590.00", "formatting trims float noise (2)")
    ok(tool.fmt_number(0.0) == "0", "zero formats as 0")

    if fails:
        for item in fails:
            print("FAIL " + item)
        return 1
    print("WB_USAGE_OK %d assertions" % checks)
    return 0


if __name__ == "__main__":
    sys.exit(main())