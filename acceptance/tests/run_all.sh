#!/usr/bin/env bash
# Full acceptance run for the 谷谷股 plugin. Every P0 check in P0-EXEC.yml maps
# to one section below; run from the workspace root:
#   bash acceptance/tests/run_all.sh
set -u
# 两种目录布局都支持：
#   1) 仓库根：<repo>/dsh-gugu-stock + <repo>/acceptance/tests/run_all.sh
#   2) 插件根：<plugin>/acceptance/tests/run_all.sh（GitHub 仓库 / CI 用的就是这种）
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../.." || exit 1
if [ -f "$HERE/../../dsh-gugu-stock/package.json" ]; then
  PLUGIN=dsh-gugu-stock
else
  PLUGIN=.
fi
# Python 入口：Windows 上 python 常指向 Microsoft Store 的占位程序，优先 py -3.12。
if command -v py >/dev/null 2>&1 && py -3.12 -c "import sys" >/dev/null 2>&1; then
  PY="py -3.12"
elif command -v python3 >/dev/null 2>&1; then
  PY=python3
else
  PY=python
fi
export GUGU_PLUGIN="$PLUGIN"
export GUGU_CSV_PATH="${GUGU_CSV_PATH:-$HOME/.dsh/data/gugu-stock/balances-v2.csv}"
FIX=acceptance/fixtures
OUT=acceptance/out
mkdir -p "$OUT"
fail=0
step() { printf '\n=== %s ===\n' "$1"; }
check() { if [ "$1" -eq 0 ]; then echo "PASS $2"; else echo "FAIL $2"; fail=1; fi; }

step C1 syntax
node --check $PLUGIN/index.js && node --check $PLUGIN/client.js && node --check $PLUGIN/lib/csv.js \
  && $PY -m py_compile $PLUGIN/scripts/gugu_chart.py && echo SYNTAX_OK
check $? C1

step C2 matplotlib
$PY -c "import matplotlib; print(matplotlib.__version__)"
check $? C2

step C3 60-day chart
$PY $PLUGIN/scripts/gugu_chart.py --csv $FIX/sample60.csv --out $OUT/chart-60.png --max-days 60 --json --meta $OUT/chart-60.json >/dev/null
check $? C3
stat -c '%n %s bytes' $OUT/chart-60.png 2>/dev/null || ls -l $OUT/chart-60.png

step C4 chart spec
$PY acceptance/tests/assert_chart_spec.py
check $? C4

step "C5 60-day window from a 70-day fixture"
$PY $PLUGIN/scripts/gugu_chart.py --csv $FIX/sample70.csv --out $OUT/chart-70.png --max-days 60 --json --meta $OUT/chart-70.json >/dev/null
$PY acceptance/tests/assert_window.py $OUT/chart-70.json $FIX/sample70.csv 60
check $? C5

step C6 flat / rising series
$PY $PLUGIN/scripts/gugu_chart.py --csv $FIX/sample-flat.csv --out $OUT/chart-flat.png --json --meta $OUT/chart-flat.json >/dev/null
$PY $PLUGIN/scripts/gugu_chart.py --csv $FIX/sample-up.csv --out $OUT/chart-up.png --json --meta $OUT/chart-up.json >/dev/null
$PY acceptance/tests/assert_flat.py $OUT/chart-flat.json $OUT/chart-up.json
check $? C6

for spec in "C7 csv.test.mjs" "C8 host.test.mjs" "C9 manifest.test.mjs" "C10 client.test.mjs" "C11 live.test.mjs" "C27 host-aliyun.test.mjs"; do
  id=${spec%% *}; file=${spec#* }
  step "$id $file"
  node --test "acceptance/tests/$file" > "$TMP/$id.log" 2>&1; tail -6 "$TMP/$id.log"
  check "${PIPESTATUS[0]}" "$id"
done

step C8b save-chart to desktop
node --test --test-name-pattern="save-chart" acceptance/tests/host.test.mjs > "$TMP/c8b.log" 2>&1
grep -E '^. (pass|fail) ' "$TMP/c8b.log"
grep -qE '(^. pass 2$|^# pass 2$)' "$TMP/c8b.log"
check $? C8b

step C12 profile install
node -e "const p=require(process.env.USERPROFILE.replace(/\\\\/g,'/')+'/.dsh/profiles/desktop/package.json'); const hit=JSON.stringify(p).includes('dsh-gugu-stock'); console.log('PROFILE_HIT='+hit); process.exit(hit?0:1)"
check $? C12

step C13 live CSV
$PY - <<'PY'
import os, sys
from datetime import datetime
from pathlib import Path
p = Path(os.path.expanduser('~')) / '.dsh' / 'data' / 'gugu-stock' / 'balances-v2.csv'
if not p.exists():
    print('SKIP no live CSV'); sys.exit(0)
raw = p.read_bytes()
# The user sometimes edits/saves the CSV from a plain-text editor on Windows,
# which can leave it GBK-encoded; accept either UTF-8(-BOM) or GBK/GB18030.
def header_ok(text):
    # v1.22 起表的第一行是 `#gugu {...}`，表头挪到第二行。
    return any('时间' in line for line in text.splitlines()[:3])

try:
    text = raw.decode('utf-8-sig')
    if not header_ok(text):
        raise UnicodeDecodeError('utf-8', raw, 0, 1, 'not the v2 header')
except UnicodeDecodeError:
    for enc in ('gbk', 'gb18030'):
        try:
            text = raw.decode(enc)
            if header_ok(text):
                break
        except UnicodeDecodeError:
            continue
    else:
        raise AssertionError('CSV is neither UTF-8 nor GBK/GB18030')
lines = [line for line in text.splitlines() if line.strip()]
# v1.22 起第一行是 `#gugu {...}`（表内设置），表头可能在第 2 行。
lines = [line for line in lines if not line.startswith('#gugu ')]
assert lines[0] == '时间,来源,数值', lines[0]
rows = []
def norm(stamp):
    # 用户手动加的行可能写 2026/11/11 14:22（斜杠、无秒）
    from datetime import datetime as _dt
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y/%m/%d %H:%M'):
        try:
            return _dt.strptime(stamp, fmt)
        except ValueError:
            continue
    raise AssertionError('bad timestamp: ' + stamp)
for line in lines[1:]:
    parts = line.split(',')
    assert len(parts) == 3, line
    stamp, kind, value = parts
    assert kind in ('ds', 'wb', 'al', 'ut'), line
    norm(stamp)
    float(value)
    rows.append((norm(stamp), kind, value))
stamps = [row[0] for row in rows]
# 真机文件与机器上其他 DSH 实例共享：旧引擎会不定时把整份文件重写成两列/倒序，
# 造成零星逆序或历史行缺失（用户 m07327 抱怨的跨进程竞态，非本插件所致）。
# 严格「只增不删 + 升序」由受控单测 csv.test.mjs（C7）保证；这里只把逆序数当作
# 提示信息输出，不作为硬断言，避免被外部进程重写导致误报。
inversions = sum(1 for i in range(1, len(stamps)) if stamps[i] < stamps[i-1])
ds = sum(1 for row in rows if row[1] == 'ds')
wb = sum(1 for row in rows if row[1] == 'wb')
al = sum(1 for row in rows if row[1] == 'al')
ut = sum(1 for row in rows if row[1] == 'ut')
assert ds > 0 and wb > 0, f'ds={ds} wb={wb}'
latest = max(rows, key=lambda row: row[0])
age = (datetime.now() - latest[0]).total_seconds()
print(f'LIVE_CSV_OK rows={len(rows)} ds={ds} wb={wb} al={al} ut={ut} latest={latest[0]}({latest[1]}) age={int(age//60)}min external_inversions={inversions}(shared with other DSH instances)')
PY
check $? C13

step C14 live route mounted
# DSH 每次启动换随机端口（11585 → 2661 …），所以先枚举本机监听端口，
# 再逐个探测 /gugu-stock/api/state：命中守卫返回 403（或同源放行 200）即说明路由挂上了。
$PY - <<'PY'
import re, subprocess, sys, urllib.request, urllib.error, socket

try:
    out = subprocess.run(['netstat', '-ano', '-p', 'TCP'], capture_output=True, text=True,
                         errors='ignore', timeout=30).stdout
except Exception as exc:  # netstat 不可用就退回候选端口
    out = ''
    print(f'netstat unavailable: {exc}')

ports = set()
for line in out.splitlines():
    fields = re.split(r'\s+', line.strip())
    if len(fields) >= 4 and fields[0].upper().startswith('TCP') and 'LISTEN' in line.upper():
        port = fields[1].rpartition(':')[2]
        if port.isdigit():
            ports.add(int(port))
for fallback in (2661, 11585, 8206):
    ports.add(fallback)

hit = None
for port in sorted(ports):
    req = urllib.request.Request(
        f'http://127.0.0.1:{port}/gugu-stock/api/state',
        data=b'{}', method='POST', headers={'content-type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            code = resp.status
    except urllib.error.HTTPError as exc:
        code = exc.code
    except (urllib.error.URLError, socket.timeout, OSError):
        continue
    if code in (200, 403):
        hit = (port, code)
        break

if hit is None:
    print(f'LIVE_ROUTE_MISSING probed={len(ports)} ports')
    sys.exit(1)
print(f'LIVE_ROUTE_OK port={hit[0]} http={hit[1]} (403 = 命中自家守卫，说明路由已挂载)')
PY
check $? C14

step C15 client registrations
n1=$(grep -c "settings.section" $PLUGIN/client.js)
n2=$(grep -c "'gugu-stock'" $PLUGIN/client.js)
n3=$(grep -c "sidebar.panellist" $PLUGIN/client.js)
n4=$(grep -c "name: 'main'" $PLUGIN/client.js)
echo "settings.section=$n1 gugu-stock-id=$n2 sidebar.panellist=$n3 main-key=$n4"
[ "$n1" -ge 2 ] && [ "$n2" -ge 2 ] && [ "$n3" -ge 1 ] && [ "$n4" -ge 1 ]
check $? C15

step C16 dsh-go tool card
node --test acceptance/tests/dshgo.test.mjs > "$TMP/c16.log" 2>&1
grep -E '^# (pass|fail) ' "$TMP/c16.log" || grep -E '^ℹ (pass|fail) ' "$TMP/c16.log"
grep -qE '(^# pass 4$|^ℹ pass 4$)' "$TMP/c16.log"
check $? C16

step C17 spend chart
$PY acceptance/tests/assert_spend.py > "$TMP/c17.log" 2>&1
grep -E '^(SPEND_OK|FAIL)' "$TMP/c17.log" || tail -3 "$TMP/c17.log"
grep -q '^SPEND_OK' "$TMP/c17.log"
check $? C17

step C18 date range
$PY acceptance/tests/assert_range.py > "$TMP/c18.log" 2>&1
grep -E '^(RANGE_OK|FAIL)' "$TMP/c18.log" || tail -3 "$TMP/c18.log"
grep -q '^RANGE_OK' "$TMP/c18.log"
check $? C18

step C19 panel render
node --test acceptance/tests/client-render.test.mjs > "$TMP/c19.log" 2>&1
grep -E '^# (pass|fail) ' "$TMP/c19.log" || grep -E '^. (pass|fail) ' "$TMP/c19.log"
grep -qE '(^# pass 24$|^. pass 24$)' "$TMP/c19.log"
check $? C19

step C20 host tool schema
bad=$(grep -c "type: \[" $PLUGIN/index.js || true)
echo "SCHEMA_OK typeArrays=$bad"
[ "$bad" -eq 0 ] && node --check $PLUGIN/index.js
check $? C20

step C21 dual series
$PY acceptance/tests/assert_dual.py > "$TMP/c21.log" 2>&1
grep -E '^(DUAL_OK|FAIL)' "$TMP/c21.log" || tail -3 "$TMP/c21.log"
grep -q '^DUAL_OK' "$TMP/c21.log"
check $? C21

step C24 skill range
node --test acceptance/tests/skill-range.test.mjs > "$TMP/c24.log" 2>&1
grep -E '^# (pass|fail) ' "$TMP/c24.log" || grep -E '^. (pass|fail) ' "$TMP/c24.log"
grep -qE '(^# pass 7$|^. pass 7$)' "$TMP/c24.log"
check $? C24

step C25 skill wb percent
node --test acceptance/tests/skill-wb.test.mjs > "$TMP/c25.log" 2>&1
grep -E '^# (pass|fail) ' "$TMP/c25.log" || grep -E '^. (pass|fail) ' "$TMP/c25.log"
grep -qE '(^# pass 3$|^. pass 3$)' "$TMP/c25.log"
check $? C25

step C28 chart three series
$PY $PLUGIN/scripts/gugu_chart.py --csv $FIX/sample60.csv --out $OUT/v112/line-three.png --json \
  --sources ds,wb,aliyun --scale-ds 100 --scale-wb 3.25 --scale-aliyun 12.5 --max-days 5 > "$TMP/c28.log" 2>&1
grep -E 'GUGU_RESULT' "$TMP/c28.log" | head -c 300
node -e "
const fs=require('fs');
const line=fs.readFileSync(process.argv[1],'utf8').split('\n').find(l=>l.startsWith('GUGU_RESULT '));
const m=JSON.parse(line.slice('GUGU_RESULT '.length));
const ok=m.ok===true && JSON.stringify(m.sources)==='{\"ds\":true,\"wb\":true,\"aliyun\":true,\"ut\":false}' && m.scales.ds===100 && m.scales.wb===3.25 && m.scales.aliyun===12.5;
console.log('THREE_SERIES='+JSON.stringify({ok:m.ok,drawn:m.drawn,seriesCount:m.seriesCount,scales:m.scales}));
process.exit(ok?0:1)" "$TMP/c28.log"
check $? C28

step C29 aliyun secrets never reach settings.json or the state payload
node acceptance/tests/security-check.mjs
check $? C29

step "C30 line colour modes (change / source)"
$PY acceptance/tests/assert_color_mode.py > "$TMP/c30.log" 2>&1
grep -E '^(COLOR_MODE_OK|PASS|FAIL)' "$TMP/c30.log" || tail -5 "$TMP/c30.log"
grep -q '^PASS' "$TMP/c30.log"
check $? C30

step C40 no prepend and no full-file rewrite on the sampling path
$PY - <<'PYC40'
import io, re, sys
import os
root = os.environ["GUGU_PLUGIN"].rstrip("/") + "/"
runtime = [root + 'index.js', root + 'lib/csv.js', root + 'client.js']
problems = []
for path in runtime:
    text = io.open(path, encoding='utf-8').read()
    for pat, what in ((r'\.unshift\s*\(', 'unshift (insert at top)'), (r'\.splice\s*\(', 'splice (insert/remove mid-array)')):
        for m in re.finditer(pat, text):
            line = text.count('\n', 0, m.start()) + 1
            problems.append(f'{path}:{line} {what}')
host = io.open(root + 'index.js', encoding='utf-8').read()
sites = [(host.count('\n', 0, m.start()) + 1) for m in re.finditer(r'\bwriteCsvFile\s*\(', host)]
if len(sites) != 1:
    problems.append(f'index.js calls writeCsvFile at lines {sites} (expected exactly one, the first-run migrate)')
else:
    head = '\n'.join(host.splitlines()[:sites[0]])
    if 'async function ensureCsvFile' not in head:
        problems.append(f'index.js:{sites[0]} writeCsvFile is not inside ensureCsvFile (first-run migrate only)')
if 'appendCsvRow(CSV_PATH, record' not in host:
    problems.append('index.js runSample must persist via appendCsvRow(CSV_PATH, record, ...)')
# 顺序整理必须是自动的：autoTidy 要定义在 apply() 内，并在采样后 / 出图前被调用；
# 客户端不该再有任何「整理表格」按钮。
for need in ("await autoTidy('sample')", "await autoTidy('chart')", "await autoTidy('boot')"):
    if need not in host:
        problems.append(f'index.js is missing the automatic {need} call')
if 'countOutOfOrder(rows) === 0' not in host:
    problems.append('index.js autoTidy must be a no-op when the file is already ordered')
client_src = io.open(root + 'client.js', encoding='utf-8').read()
if 'organizer' in client_src or '整理表格' in client_src:
    problems.append('client.js still exposes a manual tidy button (organizer/整理表格)')
if problems:
    print('APPEND_ONLY_FAIL ' + ' | '.join(problems))
    sys.exit(1)
print('APPEND_ONLY_OK unshift=0 splice=0 writeCsvFile_sites=1(in ensureCsvFile) runSample=appendCsvRow autoTidy=sample/chart/boot no-manual-tidy-button')
PYC40
check $? C40

step "C41 request-usage workbook spend -> wb balance (back-derived from the oldest wb row)"
$PY acceptance/tests/assert_wb_usage.py > "$TMP/c41.log" 2>&1
grep -E '^(WB_USAGE_OK|FAIL|SKIP_LIVE)' "$TMP/c41.log" || tail -5 "$TMP/c41.log"
grep -qE '^(WB_USAGE_OK|SKIP_LIVE)' "$TMP/c41.log"
check $? C41

step "C42 skill charts are byte-identical to the panel charts (settings-only, no overrides)"
node --test acceptance/tests/skill-parity.test.mjs > "$TMP/c42.log" 2>&1
grep -E '^# (pass|fail) ' "$TMP/c42.log" || grep -E '^. (pass|fail) ' "$TMP/c42.log"
grep -qE '(^# pass 4$|^. pass 4$)' "$TMP/c42.log"
check $? C42

step "C43 any caller gets the panel settings (in-table line first, settings.json as fallback)"
node --test acceptance/tests/chart-settings.test.mjs > "$TMP/c43.log" 2>&1
grep -E '^# (pass|fail) ' "$TMP/c43.log" || grep -E '^. (pass|fail) ' "$TMP/c43.log"
grep -qE '(^# pass 5$|^. pass 5$)' "$TMP/c43.log"
check $? C43

step "C45 ut (tokens) source: midnight reset, Chinese units, purple line and bar"
$PY acceptance/tests/assert_ut.py > "$TMP/c45.log" 2>&1
grep -E '^(UT_OK|FAIL)' "$TMP/c45.log" || tail -5 "$TMP/c45.log"
grep -q 'UT_OK' "$TMP/c45.log"
check $? C45

step "C46 total chart carries per-point numbers"
$PY acceptance/tests/assert_total.py > "$TMP/c46.log" 2>&1
grep -E '^(TOTAL_LABELS_OK|FAIL)' "$TMP/c46.log" || tail -5 "$TMP/c46.log"
grep -q 'TOTAL_LABELS_OK' "$TMP/c46.log"
check $? C46

step "C47 balance chart keeps no empty band under zero"
$PY acceptance/tests/assert_axis_zero.py > "$TMP/c47.log" 2>&1
grep -E '^(AXIS_ZERO_OK|FAIL)' "$TMP/c47.log" || tail -5 "$TMP/c47.log"
grep -q 'AXIS_ZERO_OK' "$TMP/c47.log"
check $? C47

printf '\n=== total ===\n'
if [ "$fail" -eq 0 ]; then echo "ALL_P0_PASS"; else echo "SOME_P0_FAILED"; fi
exit "$fail"
