#!/usr/bin/env bash
# 谷谷股图表通道：一条命令出折线图 + 柱状图，最后一行给上层的 Windows 路径。
# 只读 balances-v2.csv，绝不写任何数据行。
# 图的全部设置（v1.18.2 起，当前随插件 v1.24.4）（主题 / 颜色来源 / 数据源开关 / 三条线缩放 / 时间窗）
# 一律从插件写入的 settings.json 读取，不接受命令行覆盖 —— 保证用 skill 出的图
# 和面板上点「生成折线图 / 生成柱状图」出来的图逐字节一致。
# 速度优先 —— 设置只起一次 python；三张图并行；matplotlib 只在真缺时安装；数据+
# 设置没变直接复用上次渲染（GUGU_CACHE_HIT）；输出压到几行，Agent 只需要读
# CHART_FILES / SEND 两行。
# 只读原则（用户 m14558）：本脚本绝不采样、绝不写 CSV —— 出图不产生任何数据。
set -u

START_MS="$(date +%s%3N 2>/dev/null || echo 0)"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CSV="${GUGU_CSV:-$HOME/.dsh/data/gugu-stock/balances-v2.csv}"
DATA_DIR="${GUGU_STOCK_DIR:-$HOME/.dsh/data/gugu-stock}"

OUT=""
ONLY="both"
SAMPLE="1"

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    --no-sample) SAMPLE="0"; shift 1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    --from|--to|--days|--theme|--wb-percent|--sources|--color-mode|--scale-ds|--scale-wb|--scale-aliyun|--scale-ut)
      echo "GUGU_FIXED_SETTINGS $1 已停用：图必须完全按面板当前设置生成，参数统一从 settings.json 读取。"
      echo "要改图请先到设置页改（主题 / 颜色来源 / 数据源 / 缩放），再让 skill 出图。"
      exit 64
      ;;
    *) echo "GUGU_BAD_ARG 未知参数：$1" >&2; exit 64 ;;
  esac
done

if [ ! -f "$CSV" ]; then
  echo "GUGU_NO_CSV 找不到数据文件：$CSV"
  echo "先让用户打开谷谷股面板点「立即采样」，或等 15 分钟自动采样。"
  exit 2
fi

# ---- 找 Python：优先 GUGU_PYTHON，然后 py -3.12 / python / py -3 ----
PY_CMD=""
if [ -n "${GUGU_PYTHON:-}" ] && [ -x "${GUGU_PYTHON}" ]; then
  PY_CMD="$GUGU_PYTHON"
elif command -v py >/dev/null 2>&1 && py -3.12 -c "import sys" >/dev/null 2>&1; then
  PY_CMD="py -3.12"
elif command -v python >/dev/null 2>&1; then
  PY_CMD="python"
elif command -v py >/dev/null 2>&1; then
  PY_CMD="py -3"
else
  echo "GUGU_NO_PYTHON 找不到 Python，请安装 Python 3.12，或用 GUGU_PYTHON 指定 python.exe。"
  exit 3
fi

if ! $PY_CMD -c "import sys" >/dev/null 2>&1; then
  echo "GUGU_NO_PYTHON $PY_CMD 跑不起来，请安装 Python 3.12，或用 GUGU_PYTHON 指定 python.exe。"
  exit 3
fi

# 出图脚本就是面板用的那一个，skill 只负责组装参数，不做任何数据漂移。
CHART_PY="${GUGU_CHART_PY:-$HOME/.dsh/profiles/desktop/node_modules/dsh-gugu-stock/scripts/gugu_chart.py}"
if [ ! -f "$CHART_PY" ]; then
  echo "GUGU_NO_SCRIPT 找不到出图脚本：$CHART_PY"
  echo "请确认 dsh-gugu-stock 已安装，或用 GUGU_CHART_PY 指向 gugu_chart.py。"
  exit 6
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
if [ -z "$OUT" ]; then
  OUT="$(pwd)/gugu-charts/$STAMP"
fi
mkdir -p "$OUT" || { echo "GUGU_NO_OUT 无法创建输出目录：$OUT"; exit 5; }

# ---- 一次 python 干完三件事：读设置 / 算时间窗 / 量 CSV 有多新 ----
# 时间窗用面板默认值：最近 60 天（今天往回 59 天 → 今天），和「重置为最近 60 天」一致。
SETTINGS_OUT="$(CSV_PATH="$CSV" $PY_CMD - "$DATA_DIR/settings.json" <<'PY'
import json
import sys
from datetime import date, datetime, timedelta

path = sys.argv[1]
data = {}
try:
    with open(path, encoding="utf-8") as handle:
        loaded = json.load(handle)
    if isinstance(loaded, dict):
        data = loaded
except FileNotFoundError:
    print("GUGU_SETTINGS_NOTE settings.json 不存在，按插件默认设置出图")
except Exception as err:  # 坏文件不能让 skill 崩掉
    print("GUGU_SETTINGS_NOTE settings.json 读不出来（%s），按插件默认设置出图" % err)

SCALE_DEFAULTS = {"ds": 100.0, "wb": 3.25, "aliyun": 12.5, "ut": 12500000.0}
SCALE_MIN, SCALE_MAX = 0.05, 400.0
WB_PERCENT_MIN, WB_PERCENT_MAX = 0.1, 20.0
# ut 不是百分比而是「每格多少 token」，单独一套区间。
UT_MIN, UT_MAX = 1000.0, 1000000000.0
SOURCES_DEFAULT = {"ds": True, "wb": True, "aliyun": False, "ut": True}


def clamp(value, fallback, low, high):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if number != number or number <= 0:  # NaN / 负数
        return fallback
    return round(min(max(number, low), high), 2)


wb_percent = clamp(data.get("wbPercent"), SCALE_DEFAULTS["wb"], WB_PERCENT_MIN, WB_PERCENT_MAX)
raw_scales = data.get("scales") if isinstance(data.get("scales"), dict) else {}
scales = {}
for name in ("ds", "wb", "aliyun", "ut"):
    fallback = wb_percent if name == "wb" else SCALE_DEFAULTS[name]
    if name == "ut":
        scales[name] = clamp(raw_scales.get(name), fallback, UT_MIN, UT_MAX)
    else:
        scales[name] = clamp(raw_scales.get(name), fallback, SCALE_MIN, SCALE_MAX)

raw_sources = data.get("sources") if isinstance(data.get("sources"), dict) else {}
sources = []
for name in ("ds", "wb", "aliyun", "ut"):
    flag = raw_sources.get(name)
    enabled = flag if isinstance(flag, bool) else SOURCES_DEFAULT[name]
    if enabled:
        sources.append(name)

theme = data.get("theme") if isinstance(data.get("theme"), str) else "auto"
theme = theme.strip().lower()
if theme not in ("light", "dark", "auto"):
    theme = "auto"
# 面板把 auto 解析成页面当前明暗再传给脚本；skill 看不到页面，按亮色处理（与之前一致）。
theme = "light" if theme == "auto" else theme

color_mode = data.get("colorMode") if isinstance(data.get("colorMode"), str) else "change"
color_mode = color_mode.strip().lower()
if color_mode not in ("change", "source"):
    color_mode = "change"

today = date.today()
start = today - timedelta(days=59)
print("GUGU_THEME " + theme)
print("GUGU_COLOR_MODE " + color_mode)
print("GUGU_WB_PERCENT " + ("%g" % wb_percent))
print("GUGU_SOURCES " + ",".join(sources))
print("GUGU_SCALE_DS " + ("%g" % scales["ds"]))
print("GUGU_SCALE_WB " + ("%g" % scales["wb"]))
print("GUGU_SCALE_ALIYUN " + ("%g" % scales["aliyun"]))
print("GUGU_SCALE_UT " + ("%g" % scales["ut"]))
compact = {"separators": (",", ":")}
print("RANGE_FROM " + start.isoformat())
print("RANGE_TO " + today.isoformat())
print("GUGU_SETTINGS " + json.dumps({
    "theme": theme,
    "colorMode": color_mode,
    "wbPercent": wb_percent,
    "sources": sources,
    "scales": scales,
}, ensure_ascii=False, sort_keys=True, **compact))
print("GUGU_RANGE " + json.dumps({
    "mode": "panel-default",
    "from": start.isoformat(),
    "to": today.isoformat(),
    "days": 60,
}, ensure_ascii=False, sort_keys=True, **compact))

# 顺手量一下 CSV 最后一行有多新：刚采过样就不必再往采样接口跑一趟。
age = -1
try:
    import os
    with open(os.environ.get("CSV_PATH", ""), "rb") as handle:
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        window = min(size, 4096)
        handle.seek(size - window)
        tail = handle.read(window).decode("utf-8", "replace")
    stamp = ""
    for line in reversed([item.strip() for item in tail.splitlines() if item.strip()]):
        cells = line.replace("\t", ",").split(",")
        if len(cells) < 2:
            continue
        stamp = cells[0].strip()
        if stamp and not stamp.lower().startswith("time") and not stamp.startswith("时间"):
            break
        stamp = ""
    if stamp:
        normalized = stamp.replace("/", "-")
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                moment = datetime.strptime(normalized, fmt)
                age = int((datetime.now() - moment).total_seconds())
                break
            except ValueError:
                continue
except Exception:
    age = -1
print("CSV_AGE %d" % age)
PY
)"
SETTINGS_STATUS=$?
if [ $SETTINGS_STATUS -ne 0 ]; then
  echo "GUGU_NO_SETTINGS 读不到面板设置，放弃出图（不猜参数）。"
  exit 8
fi

THEME=""
COLOR_MODE=""
WB_PERCENT=""
SOURCES=""
SCALE_DS=""
SCALE_WB=""
SCALE_ALIYUN=""
SCALE_UT=""
RANGE_FROM=""
RANGE_TO=""
CSV_AGE="-1"
while IFS=' ' read -r key value; do
  case "$key" in
    GUGU_THEME) THEME="$value"; echo "GUGU_THEME $value" ;;
    GUGU_SOURCES) SOURCES="$value"; echo "GUGU_SOURCES $value" ;;
    GUGU_COLOR_MODE) COLOR_MODE="$value"; echo "GUGU_COLOR_MODE $value" ;;
    GUGU_WB_PERCENT) WB_PERCENT="$value"; echo "GUGU_WB_PERCENT $value" ;;
    GUGU_SCALE_DS) SCALE_DS="$value"; echo "GUGU_SCALE_DS $value" ;;
    GUGU_SCALE_WB) SCALE_WB="$value"; echo "GUGU_SCALE_WB $value" ;;
    GUGU_SCALE_ALIYUN) SCALE_ALIYUN="$value"; echo "GUGU_SCALE_ALIYUN $value" ;;
    GUGU_SCALE_UT) SCALE_UT="$value"; echo "GUGU_SCALE_UT $value" ;;
    GUGU_SETTINGS) echo "GUGU_SETTINGS $value" ;;
    GUGU_RANGE) echo "GUGU_RANGE $value" ;;
    RANGE_FROM) RANGE_FROM="$value" ;;
    RANGE_TO) RANGE_TO="$value" ;;
    CSV_AGE) CSV_AGE="$value" ;;
    "") ;;
    *) echo "$key $value" ;;   # GUGU_SETTINGS_NOTE 直接透传给上层看
  esac
done <<< "$SETTINGS_OUT"

if [ -z "$SOURCES" ]; then
  echo "GUGU_NO_SOURCE 面板里三个数据源都关着，先去设置页打开至少一个。"
  exit 9
fi

# ---- 不采样（用户 m14558：调用 skill 出图不允许顺手写数据）----
# 以前这里会 POST /api/sample 顺手采一次；那样 Agent 每出一次图就往 CSV 里多写一行，
# 既不安全也不好审计。现在 skill 纯只读：要新数据请到面板点「立即采样」或等 15 分钟
# 定时采样，或者明确调用插件工具 gugu_stock 的 action=sample。
if [ "$SAMPLE" = "0" ]; then
  : # --no-sample 保留为兼容参数，现在是默认行为，等于什么都不做
fi

run_one() {
  local kind="$1" outfile="$2" jsonfile="$3"
  # 参数与 index.js 的 generateChart 完全一致，只把 --json 换成 --meta 落文件。
  $PY_CMD "$CHART_PY" \
    --csv "$CSV" \
    --out "$outfile" \
    --max-days 60 \
    --kind "$kind" \
    --with-wb 1 \
    --wb-percent "$WB_PERCENT" \
    --sources "$SOURCES" \
    --scale-ds "$SCALE_DS" \
    --scale-wb "$SCALE_WB" \
    --scale-aliyun "$SCALE_ALIYUN" \
    --scale-ut "$SCALE_UT" \
    --theme "$THEME" \
    --color-mode "$COLOR_MODE" \
    --from "$RANGE_FROM" \
    --to "$RANGE_TO" \
    --meta "$jsonfile" >"$OUT/$kind.log" 2>"$OUT/$kind.err"
  return $?
}

# 渲染缓存：数据 + 设置 + 脚本都没变就直接复用上次 PNG（秒回）。
CACHE_DIR="$DATA_DIR/skill-cache"
# 测试会固定生成时间（GUGU_GENERATED_AT）来逐字节比对两张图；那种模式下缓存只会
# 把别处渲染的旧图搬过来，直接跳过。
CACHE_KEY=""
if command -v sha256sum >/dev/null 2>&1; then
  if [ -n "${GUGU_GENERATED_AT:-}" ]; then CACHE_KEY=""; else
  CACHE_KEY="$(printf '%s|%s|%s|%s' "$CSV" "$(stat -c '%s-%Y' "$CSV" 2>/dev/null || echo 0)" \
    "$(cat "$DATA_DIR/settings.json" 2>/dev/null | sha256sum | cut -d' ' -f1)" \
    "$(stat -c '%s-%Y' "$CHART_PY" 2>/dev/null || echo 0)" | sha256sum | cut -d' ' -f1)"
  CACHE_KEY="$CACHE_KEY-$ONLY"
  fi
fi

KIND_LIST="line spend total"
want_kind() {
  [ "$ONLY" = "both" ] && return 0
  [ "$ONLY" = "all" ] && return 0
  [ "$ONLY" = "$1" ]
}

LINE_PNG=""
SPEND_PNG=""
TOTAL_PNG=""
CACHE_HIT="0"
mkdir -p "$CACHE_DIR" 2>/dev/null || true
if [ -n "$CACHE_KEY" ] && [ -f "$CACHE_DIR/key" ] && [ "$(cat "$CACHE_DIR/key" 2>/dev/null)" = "$CACHE_KEY" ]; then
  HAVE_ALL="1"
  for kind in $KIND_LIST; do
    if want_kind "$kind"; then
      { [ -f "$CACHE_DIR/$kind.png" ] && [ -f "$CACHE_DIR/$kind.json" ]; } || HAVE_ALL="0"
    fi
  done
  if [ "$HAVE_ALL" = "1" ]; then
    CACHE_HIT="1"
    for kind in $KIND_LIST; do
      if want_kind "$kind"; then
        cp -f "$CACHE_DIR/$kind.png" "$OUT/$kind.png" 2>/dev/null || true
        cp -f "$CACHE_DIR/$kind.json" "$OUT/$kind.json" 2>/dev/null || true
        case "$kind" in
          line) [ -f "$OUT/line.png" ] && LINE_PNG="$OUT/line.png" ;;
          spend) [ -f "$OUT/spend.png" ] && SPEND_PNG="$OUT/spend.png" ;;
          total) [ -f "$OUT/total.png" ] && TOTAL_PNG="$OUT/total.png" ;;
        esac
      fi
    done
    [ -z "$LINE_PNG" ] && [ -z "$SPEND_PNG" ] && [ -z "$TOTAL_PNG" ] && CACHE_HIT="0"
  fi
fi

render_all() {
  LINE_PNG=""
  SPEND_PNG=""
  TOTAL_PNG=""
  local -A pids=()
  local kind=""
  for kind in $KIND_LIST; do
    if want_kind "$kind"; then
      run_one "$kind" "$OUT/$kind.png" "$OUT/$kind.json" &
      pids[$kind]=$!
    fi
  done
  # 三张图并行渲染：谁也不必等谁，wall time ≈ 一张图的时间。
  for kind in $KIND_LIST; do
    if [ -n "${pids[$kind]:-}" ]; then
      if wait "${pids[$kind]}"; then
        case "$kind" in
          line) LINE_PNG="$OUT/line.png" ;;
          spend) SPEND_PNG="$OUT/spend.png" ;;
          total) TOTAL_PNG="$OUT/total.png" ;;
        esac
      fi
    fi
  done
  return 0
}

if [ "$CACHE_HIT" = "1" ]; then
  echo "GUGU_CACHE_HIT 数据和设置都没变，直接复用上次渲染"
else
  render_all
  # 平时不预检 matplotlib（省一次 python 启动）；渲染报缺库才装一次并重试。
  if [ -z "$LINE_PNG" ] && [ -z "$SPEND_PNG" ] && [ -z "$TOTAL_PNG" ] && grep -qls "No module named 'matplotlib'" "$OUT"/*.err 2>/dev/null; then
    echo "GUGU_NO_MATPLOTLIB 缺 matplotlib，正在安装…"
    $PY_CMD -m pip install --user matplotlib >/dev/null 2>&1 || true
    if $PY_CMD -c "import matplotlib" >/dev/null 2>&1; then
      render_all
    else
      echo "GUGU_NO_MATPLOTLIB 安装失败。请手动运行：$PY_CMD -m pip install --user matplotlib"
      exit 4
    fi
  fi

  if [ -z "$LINE_PNG" ] && want_kind line; then
    echo "GUGU_LINE_FAILED"
    cat "$OUT/line.err" >&2
  fi
  if [ -z "$SPEND_PNG" ] && want_kind spend; then
    echo "GUGU_SPEND_FAILED"
    cat "$OUT/spend.err" >&2
  fi
  if [ -z "$TOTAL_PNG" ] && want_kind total; then
    echo "GUGU_TOTAL_FAILED"
    cat "$OUT/total.err" >&2
  fi
  if [ -z "$LINE_PNG" ] && [ -z "$SPEND_PNG" ] && [ -z "$TOTAL_PNG" ]; then
    echo "GUGU_ALL_FAILED 一张图都没生成，先看上面的 stderr。"
    exit 7
  fi

  # 渲染成功就把结果放进缓存，下次数据没变直接复用。
  if [ -n "$CACHE_KEY" ]; then
    for kind in $KIND_LIST; do
      if [ -f "$OUT/$kind.png" ]; then
        cp -f "$OUT/$kind.png" "$CACHE_DIR/$kind.png" 2>/dev/null || true
        cp -f "$OUT/$kind.json" "$CACHE_DIR/$kind.json" 2>/dev/null || true
      fi
    done
    printf '%s' "$CACHE_KEY" > "$CACHE_DIR/key" 2>/dev/null || true
  fi
fi

# 合并 result.json 并打一行摘要（Agent 只需要读这一行）。
$PY_CMD - "$OUT" "$OUT/result.json" <<'PY'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
merged_path = Path(sys.argv[2])
result = {}
for kind in ("line", "spend", "total"):
    path = out / (kind + ".json")
    if path.exists():
        try:
            result[kind] = json.loads(path.read_text(encoding="utf-8"))
        except Exception as err:
            result[kind] = {"error": str(err)}
try:
    merged_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
except Exception:
    pass

line = result.get("line", {}) or {}
spend = result.get("spend", {}) or {}
total = result.get("total", {}) or {}
print("SUMMARY " + json.dumps({
    "days": line.get("days"),
    "points": line.get("points"),
    "firstDate": line.get("firstDate"),
    "lastDate": line.get("lastDate"),
    "theme": line.get("theme"),
    "colorMode": line.get("colorMode"),
    "spendBars": len(spend.get("bars") or []),
    "totalLines": len(total.get("totalLines") or []),
}, ensure_ascii=False, separators=(",", ":")))
PY

echo "CHART_FILES $LINE_PNG|$SPEND_PNG|$TOTAL_PNG|$OUT/result.json"
# MSYS 的 pwd 是 /c/Users/...，转成 Windows 路径给上层直接用。
WIN_LINE="$LINE_PNG"
WIN_SPEND="$SPEND_PNG"
WIN_TOTAL="$TOTAL_PNG"
if command -v cygpath >/dev/null 2>&1; then
  WIN_LINE="$(cygpath -w "$LINE_PNG" 2>/dev/null || printf '%s' "$LINE_PNG")"
  WIN_SPEND="$(cygpath -w "$SPEND_PNG" 2>/dev/null || printf '%s' "$SPEND_PNG")"
  WIN_TOTAL="$(cygpath -w "$TOTAL_PNG" 2>/dev/null || printf '%s' "$TOTAL_PNG")"
  echo "WINDOWS_PATHS $WIN_LINE|$WIN_SPEND|$WIN_TOTAL|$(cygpath -w "$OUT/result.json" 2>/dev/null)"
fi
# 给上层的手把手指令：把这三个路径原样交给 present / dsh_im_return_file。
echo "SEND $WIN_LINE|$WIN_SPEND|$WIN_TOTAL"
END_MS="$(date +%s%3N 2>/dev/null || echo 0)"
if [ "$START_MS" -gt 0 ] && [ "$END_MS" -gt 0 ] 2>/dev/null; then
  echo "ELAPSED_MS $((END_MS - START_MS))"
fi
