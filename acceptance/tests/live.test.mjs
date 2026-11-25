import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PLUGIN } from './_plugin-path.mjs'
// 默认用本机真实数据；换一台机器（或 CI）时可用环境变量指到自己的 CSV，
// 指不到就由下面的 t.skip 优雅跳过，不让整个验收套件因为「没有个人数据」而红。
const DEFAULT_DIR = path.join(os.homedir(), '.dsh', 'data', 'gugu-stock')
const CSV_PATH = process.env.GUGU_CSV_PATH
  ? path.resolve(process.env.GUGU_CSV_PATH)
  : path.join(DEFAULT_DIR, 'balances-v2.csv')
const CHART_PATH = process.env.GUGU_CHART_PATH
  ? path.resolve(process.env.GUGU_CHART_PATH)
  : path.join(DEFAULT_DIR, 'gugu-chart.png')

const csv = await import(new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/lib/csv.js').href)

async function livePlugin() {
  delete process.env.GUGU_STOCK_DIR
  delete process.env.GUGU_OPEN_DRY
  delete process.env.GUGU_PYTHON
  // 指了自定义 CSV 时，让插件也去同一个目录读写出图，否则两边看的不是一份数据。
  if (process.env.GUGU_CSV_PATH) process.env.GUGU_STOCK_DIR = path.dirname(CSV_PATH)
  const url = new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/index.js?' + Date.now())
  const mod = await import(url.href)
  const routes = []
  const ctx = {
    effect: (fn) => fn(),
    get: () => undefined,
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    connection: { requestRejection: () => undefined },
  }
  const dispose = mod.apply(ctx, undefined)
  dispose() // only the HTTP surface is under test; the boot timer must not double-sample
  return routes
}

async function request(routes, method, sub) {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(body) {
      this.body = body
    },
  }
  await routes[0].handler({ method, url: '/gugu-stock/api' + sub, headers: {} }, res)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

test('the live CSV keeps the documented shape', async (t) => {
  const rows = await csv.readCsvFile(CSV_PATH).catch(() => [])
  if (rows.length === 0) {
    t.skip('no live CSV yet — the plugin has not sampled on this machine')
    return
  }
  // 真机存活冒烟测试：这份 CSV 与机器上其他 DSH 实例共享，外部旧引擎会不定时
  // 用两列/倒序内容整体重写它（这正是用户 m07327 抱怨的跨进程竞态）。因此这里
  // 只校验「有可解析的实时数据」，不把编码/全局升序作为硬断言——严格 append-only
  // 与升序由受控单测 csv.test.mjs 的 sampling-is-append-only 用例保证。
  // 编码（BOM UTF-8 或 GBK）已由 csv.readCsvFile 统一处理。
  for (const row of rows) {
    assert.match(row.time, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/)
    assert.ok(['ds', 'wb', 'al', 'ut'].includes(row.kind), 'kind is ds / wb / al / ut: ' + row.kind)
    assert.ok(Number.isFinite(row.value))
  }
  assert.ok(rows.some((row) => row.kind === 'ds'), 'DS rows exist')
  assert.ok(rows.some((row) => row.kind === 'wb'), 'WB rows exist')
  // 阿里云卡券是第三条线，启用后 CSV 里会出现 al 行（没配置时这条不成立，所以只在有 al 时校验）。
  // 注意：用户会手工往这个 CSV 里加行（m08535「我在表里手动新增了几个数据，禁止删除」），
  // 手工行可能写成 0 或别的值，所以这里只要求「非负且有限」，不把 > 0 当硬条件。
  const alRows = rows.filter((row) => row.kind === 'al')
  for (const row of alRows) {
    assert.ok(Number.isFinite(row.value) && row.value >= 0, 'an Aliyun row keeps a non-negative balance: ' + row.value)
  }
})

test('the live state route reads the real CSV', async (t) => {
  const rows = await csv.readCsvFile(CSV_PATH).catch(() => [])
  if (rows.length === 0) {
    t.skip('no live CSV yet')
    return
  }
  const routes = await livePlugin()
  const state = await request(routes, 'GET', '/state')
  assert.equal(state.status, 200)
  assert.equal(state.json.csvPath, CSV_PATH)
  assert.equal(state.json.rows, rows.length)
  // 升序文件里第一行是最旧的；最新一行按最大时间取，不依赖行位置。
  const latestOf = (kind) => rows.filter((row) => row.kind === kind).reduce((best, row) => (!best || row.time > best.time ? row : best), null)
  const latestDs = latestOf('ds')
  const latestWb = latestOf('wb')
  assert.equal(state.json.latestTime, latestDs.time)
  assert.equal(state.json.latestBalance, latestDs.value)
  assert.ok(state.json.dsCount > 0 && state.json.wbCount > 0, 'state counts both series')
  assert.equal(state.json.latestWb, latestWb.value)
  assert.equal(state.json.latestWbTime, latestWb.time)
  assert.equal(state.json.intervalMs, 900000)
})

test('the live chart route draws the real CSV through python + matplotlib', async (t) => {
  const rows = await csv.readCsvFile(CSV_PATH).catch(() => [])
  if (rows.length === 0) {
    t.skip('no live CSV yet')
    return
  }
  const routes = await livePlugin()
  const result = await request(routes, 'POST', '/chart')
  assert.equal(result.status, 200, JSON.stringify(result.json && result.json.error))
  assert.equal(result.json.ok, true)
  assert.match(result.json.dataUrl, /^data:image\/png;base64,/)
  // 图表落在数据目录里；用自定义 GUGU_CSV_PATH 时目录可能不同，只比文件名。
  assert.equal(path.basename(result.json.chartPath), path.basename(CHART_PATH))
  const stat = await fs.stat(CHART_PATH)
  assert.ok(stat.size > 1000)
  assert.equal(result.json.meta.points, rows.filter((row) => row.kind === 'ds').length)
  assert.equal(result.json.meta.withWb, true)
  assert.ok(result.json.meta.wbPoints > 0, 'WB points are drawn')
  const days = new Set(rows.map((row) => row.time.slice(0, 10))).size
  assert.equal(result.json.meta.days, Math.min(days, 60))
  assert.equal(result.json.meta.gridStep, 10)
  const png = await fs.readFile(CHART_PATH)
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
})
