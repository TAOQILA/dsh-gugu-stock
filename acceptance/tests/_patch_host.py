# -*- coding: utf-8 -*-
"""补丁 3：Host 侧支持 kind/from/to、区间信息与两种输出文件。"""
from pathlib import Path

path = Path(__file__).resolve().parents[2] / "dsh-gugu-stock" / "index.js"
src = path.read_text(encoding="utf-8")


def swap(old: str, new: str) -> None:
    global src
    assert old in src, old[:70]
    src = src.replace(old, new, 1)


swap(
    "const CHART_PATH = path.join(DATA_DIR, 'gugu-chart.png')\n",
    """const CHART_PATH = path.join(DATA_DIR, 'gugu-chart.png')
const SPEND_CHART_PATH = path.join(DATA_DIR, 'gugu-spend-chart.png')
""",
)

swap(
    "const MAX_DAYS = 60\n",
    """const MAX_DAYS = 60
const RANGE_LIMIT_DAYS = 366
const DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/
""",
)

# generateChart 接受 {kind, from, to}
swap(
    """async function generateChart() {
  const rows = await readCsvFile(CSV_PATH)
  if (rows.length === 0) {
    return fail('empty_csv', 'CSV 还没有数据，先点一次「立即采样」。')
  }
  await fs.mkdir(DATA_DIR, { recursive: true })
  const scriptArgs = [
    SCRIPT_PATH,
    '--csv',
    CSV_PATH,
    '--out',
    CHART_PATH,
    '--max-days',
    String(MAX_DAYS),
    '--json',
  ]""",
    """async function generateChart(options = {}) {
  const rows = await readCsvFile(CSV_PATH)
  if (rows.length === 0) {
    return fail('empty_csv', 'CSV 还没有数据，先点一次「立即采样」。')
  }

  const kind = options.kind === 'spend' ? 'spend' : 'line'
  const from = typeof options.from === 'string' && options.from !== '' ? options.from : null
  const to = typeof options.to === 'string' && options.to !== '' ? options.to : null
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return fail('bad_range', '日期格式应为 YYYY-MM-DD。')
  }
  if (from && to && from > to) {
    return fail('bad_range', '起始日期不能晚于结束日期。')
  }
  if (from && to) {
    const span = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1
    if (Number.isFinite(span) && span > RANGE_LIMIT_DAYS) {
      return fail('range_too_long', '一次最多画 ' + String(RANGE_LIMIT_DAYS) + ' 天，请把区间收窄。')
    }
  }

  const chartPath = kind === 'spend' ? SPEND_CHART_PATH : CHART_PATH
  await fs.mkdir(DATA_DIR, { recursive: true })
  const scriptArgs = [
    SCRIPT_PATH,
    '--csv',
    CSV_PATH,
    '--out',
    chartPath,
    '--max-days',
    String(MAX_DAYS),
    '--kind',
    kind,
    '--json',
  ]
  if (from) scriptArgs.push('--from', from)
  if (to) scriptArgs.push('--to', to)""",
)

swap(
    """    const meta = parseScriptMeta(attempt.stdout || '')
    let dataUrl
    try {
      const png = await fs.readFile(CHART_PATH)""",
    """    const meta = parseScriptMeta(attempt.stdout || '')
    let dataUrl
    try {
      const png = await fs.readFile(chartPath)""",
)

swap(
    """    return {
      ok: true,
      dataUrl,
      chartPath: CHART_PATH,
      python: candidate.label,
      generatedAt: new Date().toISOString(),
      meta: meta || null,
    }""",
    """    return {
      ok: true,
      kind,
      from,
      to,
      dataUrl,
      chartPath,
      python: candidate.label,
      generatedAt: new Date().toISOString(),
      meta: meta || null,
    }""",
)

# state：补上区间信息，供界面的日期选择器使用
swap(
    """    const summary = summarize(rows)
    let exists = true""",
    """    const summary = summarize(rows)
    const dates = rows.map((row) => String(row.time || '').slice(0, 10)).filter((date) => DATE_RE.test(date))
    const firstDate = dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null
    const lastDate = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null
    let exists = true""",
)

swap(
    """      lastChartAt: state.lastChartAt,
      chartMeta: state.lastChartMeta,
    }""",
    """      lastChartAt: state.lastChartAt,
      chartMeta: state.lastChartMeta,
      range: {
        firstDate,
        lastDate,
        defaultFrom: isoDateDaysAgo(MAX_DAYS - 1),
        defaultTo: isoDateDaysAgo(0),
        maxDays: MAX_DAYS,
        limitDays: RANGE_LIMIT_DAYS,
      },
    }""",
)

# 日期工具
swap(
    "export const inject = ['webServer', 'connection']\n",
    """export const inject = ['webServer', 'connection']

function isoDateDaysAgo(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return String(date.getFullYear()) + '-' + month + '-' + day
}

async function readJsonBody(req, limit = 8192) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) return null
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return null
  }
}
""",
)

# chart 路由：解析 body 并区分 400
swap(
    """      if (sub === 'chart') {
        const result = await generateChart()""",
    """      if (sub === 'chart') {
        const body = await readJsonBody(req)
        if (body === null) {
          sendJson(res, 400, fail('bad_request', '请求体不是合法的 JSON。'))
          return
        }
        const result = await generateChart({
          kind: body.kind,
          from: body.from,
          to: body.to,
        })""",
)

swap(
    """        sendJson(res, result.ok ? 200 : 500, result)
        return
      }
      sendJson(res, 404, fail('not_found', '未知接口：' + sub))""",
    """        const status = result.ok
          ? 200
          : ['bad_range', 'range_too_long', 'empty_csv', 'no_data'].includes(result.error && result.error.code)
            ? 400
            : 500
        sendJson(res, status, result)
        return
      }
      sendJson(res, 404, fail('not_found', '未知接口：' + sub))""",
)

path.write_text(src, encoding="utf-8")
print("patched index.js")
