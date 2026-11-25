import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PLUGIN } from './_plugin-path.mjs'
const CSV_NAME = 'balances-v2.csv'

async function freshModule(dataDir, extraEnv = {}) {
  // index.js resolves its data dir at import time, so every test uses its own copy.
  process.env.GUGU_STOCK_DIR = dataDir
  process.env.GUGU_OPEN_DRY = '1'
  // ut 数据源默认扫真实会话日志（慢、不稳定）；测试里指向空目录，得到确定的 0。
  process.env.GUGU_SESSIONS_DIR = path.join(dataDir, 'sessions')
  delete process.env.GUGU_PYTHON
  for (const [key, value] of Object.entries(extraEnv)) process.env[key] = value
  const url = new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/index.js?' + Date.now() + Math.random())
  return import(url.href)
}

function fakeCtx(overrides = {}) {
  const routes = []
  const ctx = {
    effect(fn) {
      return fn()
    },
    get() {
      return undefined
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    connection: { requestRejection: () => undefined },
    ...overrides,
  }
  return { ctx, routes }
}

function fakeRes() {
  return {
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
}

async function request(routes, method, pathname, body) {
  const res = fakeRes()
  const req = {
    method,
    url: pathname,
    headers: { 'content-type': 'application/json' },
  }
  if (body !== undefined) {
    const payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
    req[Symbol.asyncIterator] = async function* iterate() {
      yield payload
    }
  }
  await routes[0].handler(req, res)
  let json = null
  try {
    json = JSON.parse(res.body)
  } catch {
    json = null
  }
  return { status: res.statusCode, headers: res.headers, json }
}

async function boot(payload = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-'))
  const mod = await freshModule(dir)
  const { ctx, routes } = fakeCtx(payload)
  const dispose = mod.apply(ctx, undefined)
  dispose() // stop the boot timer so the tests never touch the network
  return { dir, routes, dispose, mod }
}

test('the sample interval is a persisted setting with a clamped range', async () => {
  const { routes, dir } = await boot()
  const before = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(before.json.intervalMinutes, 15, 'defaults to 15 minutes')
  assert.equal(before.json.intervalMs, 15 * 60 * 1000)
  assert.deepEqual(before.json.intervalRange, { min: 1, max: 1440, default: 15 })

  const saved = await request(routes, 'POST', '/gugu-stock/api/settings', { intervalMinutes: 45 })
  assert.equal(saved.json.intervalMinutes, 45)
  const settings = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'))
  assert.equal(settings.intervalMinutes, 45, 'persisted to settings.json')
  const after = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(after.json.intervalMs, 45 * 60 * 1000)

  // Out-of-range values are clamped, not accepted verbatim.
  const low = await request(routes, 'POST', '/gugu-stock/api/settings', { intervalMinutes: 0 })
  assert.equal(low.json.intervalMinutes, 1)
  const high = await request(routes, 'POST', '/gugu-stock/api/settings', { intervalMinutes: 99999 })
  assert.equal(high.json.intervalMinutes, 1440)
})

test('apply registers one prefix route and does not start sampling early', async () => {
  const { routes, dir, mod } = await boot()
  assert.equal(mod.inject.length, 2)
  assert.ok(mod.inject.includes('webServer'))
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/gugu-stock/api')

  const state = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(state.status, 200)
  assert.equal(state.json.ok, true)
  assert.equal(state.json.csvPath, path.join(dir, CSV_NAME))
  assert.equal(state.json.rows, 0)
  assert.equal(state.json.exists, false)
  assert.equal(state.json.intervalMs, 15 * 60 * 1000)
  assert.equal(state.json.maxDays, 60)
  assert.equal(state.headers['cache-control'], 'no-store')
})

test('state reflects the CSV that is on disk', async () => {
  const { routes, dir } = await boot()
  const csv = await import(new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/lib/csv.js').href)
  await csv.writeCsvFile(path.join(dir, CSV_NAME), [
    { time: '2026-11-21 12:30:00', kind: 'ds', value: 7.5 },
    { time: '2026-11-21 12:00:00', kind: 'ds', value: 8 },
    { time: '2026-11-20 21:00:00', kind: 'ds', value: 9 },
  ])
  const state = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(state.json.rows, 3)
  assert.equal(state.json.days, 2)
  assert.equal(state.json.latestBalance, 7.5)
  assert.equal(state.json.latestTime, '2026-11-21 12:30:00')
  assert.equal(state.json.exists, true)
})

test('one sample writes both series and keeps both rows', async () => {
  const http = await import('node:http')
  const csv = await import(new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/lib/csv.js').href)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-dual-'))
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ accounts: [{ id: 'a', selected: true, credits: 969.03 }] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const mod = await freshModule(dir)
  const routes = []
  const sources = (name) => {
    if (name === 'deepseekAccount') {
      return {
        getState: () => ({ userId: 'test' }),
        getBalance: async () => ({ status: 'ready', value: [{ currency: 'CNY', balance: 12.5 }], bonusWallets: [] }),
      }
    }
    if (name === 'webServer') return { getOrigin: () => `http://127.0.0.1:${port}` }
    return undefined
  }
  const dispose = mod.apply(
    {
      effect: (fn) => fn(),
      get: sources,
      webServer: {
        getOrigin: () => `http://127.0.0.1:${port}`,
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
      connection: { requestRejection: () => undefined },
    },
    undefined,
  )
  dispose()
  const result = await request(routes, 'POST', '/gugu-stock/api/sample')
  await new Promise((resolve) => server.close(resolve))
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  // v1.19：ut（本机 token 累计）也是采样源，一次采样写三行。
  assert.equal(result.json.records.length, 3, 'all three series were recorded')
  assert.deepEqual(result.json.records.map((record) => record.kind).sort(), ['ds', 'ut', 'wb'])
  const rows = await csv.readCsvFile(path.join(dir, CSV_NAME))
  assert.equal(rows.length, 3, 'parallel samples must not overwrite each other')
  assert.deepEqual(rows.map((row) => row.kind).sort(), ['ds', 'ut', 'wb'])
  const utRow = rows.find((row) => row.kind === 'ut')
  assert.equal(utRow.value, 0, 'an empty sessions dir reports zero tokens')
})

test('several WorkBuddy accounts are summed into one wb row', async () => {
  const http = await import('node:http')
  const csv = await import(new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/lib/csv.js').href)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-wbsum-'))
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    // 三种形状都要认：数字、{total}、读不出来的（credits 为 null / 缺失）。
    res.end(
      JSON.stringify({
        accounts: [
          { id: 'a', accountName: '淘淘', selected: true, credits: 845.5 },
          { id: 'b', accountName: '小号', credits: { total: 154.5 } },
          { id: 'c', accountName: '坏号', credits: null },
        ],
      }),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const mod = await freshModule(dir)
  const routes = []
  const sources = (name) => {
    if (name === 'deepseekAccount') {
      return {
        getState: () => ({ userId: 'test' }),
        getBalance: async () => ({ status: 'ready', value: [{ currency: 'CNY', balance: 12.5 }], bonusWallets: [] }),
      }
    }
    if (name === 'webServer') return { getOrigin: () => `http://127.0.0.1:${port}` }
    return undefined
  }
  const dispose = mod.apply(
    {
      effect: (fn) => fn(),
      get: sources,
      webServer: {
        getOrigin: () => `http://127.0.0.1:${port}`,
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
      connection: { requestRejection: () => undefined },
    },
    undefined,
  )
  dispose()
  const result = await request(routes, 'POST', '/gugu-stock/api/sample')
  await new Promise((resolve) => server.close(resolve))

  assert.equal(result.status, 200)
  // records 是扁平的 {time, kind, value}（runSampleBoth 直接放 sample.record）
  const wb = result.json.records.find((record) => record.kind === 'wb')
  assert.ok(wb, 'the wb series was recorded')
  assert.equal(wb.value, 1000, 'the two readable accounts are added together')

  const rows = await csv.readCsvFile(path.join(dir, CSV_NAME))
  const wbRow = rows.find((row) => row.kind === 'wb')
  assert.equal(wbRow.value, 1000, 'the summed total is what lands in the CSV')

  const state = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(state.json.wbAccountCount, 2, 'the unreadable account is left out of the breakdown')
  assert.deepEqual(
    state.json.wbAccounts.map((item) => item.name),
    ['淘淘', '小号'],
  )
})

test('a sample with no readable balance source still reports the failure and writes only ut', async () => {
  const csv = await import(new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/lib/csv.js').href)
  const { routes, dir } = await boot()
  const result = await request(routes, 'POST', '/gugu-stock/api/sample')
  // 余额三源全部读不到，但 ut（本机 token 累计）不需要任何凭据，照样落一行 →
  // 整体算成功（200），同时把余额源的失败原因原样带在顶层 error 里。
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.error.code, 'sample_failed')
  assert.match(result.json.error.message, /余额/)
  const rows = await csv.readCsvFile(path.join(dir, CSV_NAME))
  assert.deepEqual(rows.map((row) => row.kind), ['ut'], 'only the local token row lands')
  // 数据目录里除了 CSV 与本机私有文件（监听地址 / token / 会话累计缓存 / 设置）不该有别的。
  const listing = (await fs.readdir(dir).catch(() => [])).filter(
    (name) => ![CSV_NAME, '.api-token', '.endpoint', '.token-cache.json', 'settings.json'].includes(name),
  )
  assert.deepEqual(listing, [])
})

test('the daily and total token cards add up the delta rows', async () => {
  const csv = await import(new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/lib/csv.js').href)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-uttoday-'))
  // CSV 里的 ut 行已经是增量：昨天那段 1000、今天这段 4000。
  // 于是今天的日消耗 = 4000（今天所有 ut 行之和），总消耗 = 5000（全表之和）。
  await csv.writeCsvFile(path.join(dir, CSV_NAME), [
    { time: '2026-01-01 23:59:00', kind: 'ut', value: 1000 },
    { time: '2026-01-02 12:00:00', kind: 'ut', value: 4000 },
  ])
  const { apply } = await freshModule(dir)
  const { ctx, routes } = fakeCtx()
  const dispose = apply(ctx)
  try {
    const body = await request(routes, 'GET', '/gugu-stock/api/state')
    const state = body.json
    assert.equal(state.latestUt, 4000, 'the newest ut row is the last delta')
    assert.equal(state.utToday, 4000, 'today sums only the rows stamped today')
    assert.equal(state.utTotal, 5000, 'the grand total sums every ut row')
  } finally {
    dispose()
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('importing a csv replaces the rows and adopts the settings it carries', async () => {
  const csv = await import(new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/lib/csv.js').href)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-import-'))
  await csv.writeCsvFile(path.join(dir, CSV_NAME), [
    { time: '2026-01-01 10:00:00', kind: 'ds', value: 111 },
  ])
  const { apply } = await freshModule(dir)
  const { ctx, routes } = fakeCtx()
  const dispose = apply(ctx)
  try {
    const incoming = csv.serializeCsv(
      [
        { time: '2026-02-01 09:00:00', kind: 'ds', value: 7.5 },
        { time: '2026-02-01 09:00:00', kind: 'ut', value: 2500 },
      ],
      { version: 1, theme: 'light', colorMode: 'source', sources: { ds: true, wb: false, aliyun: false, ut: true }, scales: { ds: 100, ut: 2500000 } },
    )
    const body = await request(
      routes,
      'POST',
      '/gugu-stock/api/import',
      JSON.stringify({ data: Buffer.from(incoming, 'utf8').toString('base64') }),
    )
    assert.equal(body.status, 200)
    assert.equal(body.json.ok, true)
    assert.equal(body.json.rows, 2, 'both rows of the imported file are counted')
    assert.equal(body.json.adopted, true, 'the settings line is adopted')

    const state = (await request(routes, 'GET', '/gugu-stock/api/state')).json
    assert.equal(state.rows, 2, 'the old row is gone: import replaces the table')
    assert.equal(state.utCount, 1)
    assert.equal(state.utTotal, 2500, 'the imported ut row is a delta row')
    assert.equal(state.utToday, 2500)
    assert.equal(state.theme, 'light', 'theme comes from the file')
    assert.equal(state.colorMode, 'source')
    assert.equal(state.scales.ut, 2500000)
    assert.equal(state.utBaseline, null, 'a different ledger starts with no token baseline')

    const rejected = await request(
      routes,
      'POST',
      '/gugu-stock/api/import',
      JSON.stringify({ data: Buffer.from('hello,world\n', 'utf8').toString('base64') }),
    )
    assert.equal(rejected.status, 400, 'a file without any data row is refused')
    assert.equal(rejected.json.error.code, 'bad_import')
  } finally {
    dispose()
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('ut samples the local token total from every session log (archived included)', async () => {
  const zlib = await import('node:zlib')
  const csv = await import(new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/lib/csv.js').href)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-ut-'))
  const sessions = path.join(dir, 'sessions')
  // 两个工作区、两个会话：一个「活着的」，一个已归档（归档只影响 workspace.json，
  // 日志照样在 sessions 目录里，所以遍历日志天然覆盖归档会话）。
  const appends = [
    [
      { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1100 } } },
      { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1100 } } },
    ],
    [
      { type: 'assistant/message', data: { turn: 2, step: 1, usage: { inputTokens: 0, outputTokens: 900, cacheReadTokens: 4100, cacheWriteTokens: 0, totalTokens: 5000 } } },
    ],
  ]
  const logs = [
    path.join(sessions, 'ws-a', 'session-1', 'session.v4.jsonl.zstd'),
    path.join(sessions, 'ws-b', 'archived-one', 'session.v4.jsonl.zstd'),
  ]
  for (let index = 0; index < logs.length; index += 1) {
    await fs.mkdir(path.dirname(logs[index]), { recursive: true })
    // 多帧追加：每个 append 是一帧，正是真实日志的写法。
    const frames = appends[index].map((row) =>
      zlib.zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n', 'utf8')),
    )
    await fs.writeFile(logs[index], Buffer.concat(frames))
  }
  const mod = await freshModule(dir, { GUGU_SESSIONS_DIR: sessions })
  const { ctx, routes } = fakeCtx()
  const dispose = mod.apply(ctx, undefined)
  dispose()

  const result = await request(routes, 'POST', '/gugu-stock/api/sample')
  assert.equal(result.status, 200)
  const ut = result.json.records.find((record) => record.kind === 'ut')
  assert.ok(ut, 'the token series was recorded')
  // 会话 A：同一 (turn, step) 重复两次只算一次 → 1100；会话 B：5000；合计 6100。
  // 第一次采样只立基线：CSV 里存的是「这次比上次多了多少」，没有上一条就记 0。
  assert.equal(ut.value, 0, 'the first sample records no delta, only a baseline')

  const rows = await csv.readCsvFile(path.join(dir, CSV_NAME))
  const utRow = rows.find((row) => row.kind === 'ut')
  assert.equal(utRow.value, 0, 'the CSV keeps the delta row, not the cumulative total')

  const state = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(state.json.utBaseline, 6100, 'both sessions add up into the baseline')
  assert.equal(state.json.utCount, 1)
  assert.equal(state.json.utSessions, 2, 'both logs were counted')

  // 日志长出新的一帧（+400）：下一次采样记 400，而不是 6500。
  const grown = zlib.zstdCompressSync(
    Buffer.from(
      JSON.stringify({
        type: 'assistant/message',
        data: {
          turn: 3,
          step: 1,
          usage: { inputTokens: 400, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 400 },
        },
      }) + '\n',
      'utf8',
    ),
  )
  await fs.appendFile(logs[0], grown)
  const again = await request(routes, 'POST', '/gugu-stock/api/sample')
  const utAgain = again.json.records.find((record) => record.kind === 'ut')
  assert.equal(utAgain.value, 400, 'only the increase since the last sample is recorded')
  const after = await request(routes, 'GET', '/gugu-stock/api/state')
  // 同一分钟内第二次采样会被 dedupeMinute 跳过（Excel 只有分钟精度），
  // 所以这一行没落盘，基线故意不前移，等下一分钟把这段增量补上。
  assert.equal(after.json.utBaseline, 6100, 'a skipped row must not move the baseline')
  assert.equal(after.json.utTotal, 0, 'nothing new landed in the CSV yet')
})

test('a session whose log disappears keeps feeding its last known token total', async () => {
  const zlib = await import('node:zlib')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-ut-gone-'))
  const sessions = path.join(dir, 'sessions')
  const makeLog = async (workspace, session, rows) => {
    const log = path.join(sessions, workspace, session, 'session.v4.jsonl.zstd')
    await fs.mkdir(path.dirname(log), { recursive: true })
    const frames = rows.map((row) =>
      zlib.zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n', 'utf8')),
    )
    await fs.writeFile(log, Buffer.concat(frames))
    return log
  }
  const kept = await makeLog('ws-a', 'session-keep', [
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1100 } } },
  ])
  const doomed = await makeLog('ws-b', 'session-gone', [
    { type: 'assistant/message', data: { turn: 2, step: 1, usage: { inputTokens: 0, outputTokens: 900, cacheReadTokens: 4100, cacheWriteTokens: 0, totalTokens: 5000 } } },
  ])
  const mod = await freshModule(dir, { GUGU_SESSIONS_DIR: sessions })
  const { ctx, routes } = fakeCtx()
  const dispose = mod.apply(ctx, undefined)
  dispose()

  const first = await request(routes, 'POST', '/gugu-stock/api/sample')
  // 第一次采样只立基线，差值记 0。
  assert.equal(first.json.records.find((record) => record.kind === 'ut').value, 0)

  // 会话被删掉：日志没了，但它的 5000 不应该从总量里消失。
  await fs.rm(path.dirname(doomed), { recursive: true, force: true })
  assert.equal(await fs.stat(kept).then(() => true), true)

  const second = await request(routes, 'POST', '/gugu-stock/api/sample')
  assert.equal(
    second.json.records.find((record) => record.kind === 'ut').value,
    0,
    'a vanished session keeps its last known total, so the sum does not move',
  )
  const state = await request(routes, 'GET', '/gugu-stock/api/state')
  // utSessions 是「参与统计的会话数」= 还在磁盘上的 1 个 + 记得的 1 个。
  assert.equal(state.json.utSessions, 2, 'one live log plus one remembered session')
  assert.equal(state.json.utRemembered, 1, 'the deleted session is remembered')
  assert.equal(state.json.utRememberedTokens, 5000)

  // 活着的会话再长 300：总量 6400，差值应是 300。
  // 若没有「记得消失的会话」，总量会掉回 1400，差值就会被夹成 0。
  const grown = zlib.zstdCompressSync(
    Buffer.from(
      JSON.stringify({
        type: 'assistant/message',
        data: {
          turn: 3,
          step: 1,
          usage: { inputTokens: 300, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 300 },
        },
      }) + '\n',
      'utf8',
    ),
  )
  await fs.appendFile(kept, grown)
  const third = await request(routes, 'POST', '/gugu-stock/api/sample')
  assert.equal(
    third.json.records.find((record) => record.kind === 'ut').value,
    300,
    'the remembered session still counts towards the baseline',
  )

  // 重启插件（重新 apply）后仍然记得它：再采一次样本，差值还是 300，
  // 说明那 5000 没有因为日志没了就从总量里消失。
  const mod2 = await freshModule(dir, { GUGU_SESSIONS_DIR: sessions })
  const again = fakeCtx()
  const dispose2 = mod2.apply(again.ctx, undefined)
  dispose2()
  const afterRestart = await request(again.routes, 'POST', '/gugu-stock/api/sample')
  assert.equal(
    afterRestart.json.records.find((record) => record.kind === 'ut').value,
    300,
    'the remembered total survives a restart',
  )
  const restarted = await request(again.routes, 'GET', '/gugu-stock/api/state')
  assert.equal(restarted.json.utRemembered, 1, 'the vanished session is still remembered')
  assert.equal(restarted.json.utRememberedTokens, 5000)
})

test('manual sampling ignores the freshness guard so the button always works', async () => {
  // 定时采样（trigger 不是 manual）在 10 分钟内已有同源的行时会安静跳过，避免一台
  // 机器开多个 DSH 窗口时同一分钟写十几行；手动「立即采样」不受限，永远真写一行。
  const { routes, dir } = await boot()
  const csv = await import(new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/lib/csv.js').href)
  const stamp = (offsetMinutes) => {
    const at = new Date(Date.now() - offsetMinutes * 60 * 1000)
    const pad = (value) => String(value).padStart(2, '0')
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  }
  await csv.writeCsvFile(path.join(dir, CSV_NAME), [{ time: stamp(2), kind: 'ut', value: 0 }])
  const before = (await csv.readCsvFile(path.join(dir, CSV_NAME))).filter((row) => row.kind === 'ut').length
  const manual = await request(routes, 'POST', '/gugu-stock/api/sample')
  assert.equal(manual.status, 200)
  const after = (await csv.readCsvFile(path.join(dir, CSV_NAME))).filter((row) => row.kind === 'ut').length
  assert.equal(after, before + 1, 'manual sampling always appends one ut row')
})

test('a baseline advanced by another window is respected instead of recounted', async () => {
  // 多开 DSH 时每个窗口都是独立进程。A 窗口落了一条并推进了 settings.json，
  // B 窗口内存里的基线还停在旧值；它必须读磁盘上的新基线，否则同一段消耗会被记两次。
  const zlib = await import('node:zlib')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-shared-'))
  const sessions = path.join(dir, 'sessions')
  const log = path.join(sessions, 'ws-a', 'session-1', 'session.v4.jsonl.zstd')
  await fs.mkdir(path.dirname(log), { recursive: true })
  const frame = (turn, tokens) =>
    zlib.zstdCompressSync(
      Buffer.from(
        JSON.stringify({
          type: 'assistant/message',
          data: { turn, step: 1, usage: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: tokens } },
        }) + '\n',
        'utf8',
      ),
    )
  await fs.writeFile(log, frame(1, 1000))
  const mod = await freshModule(dir, { GUGU_SESSIONS_DIR: sessions })
  const { ctx, routes } = fakeCtx()
  const dispose = mod.apply(ctx, undefined)
  dispose()

  const first = await request(routes, 'POST', '/gugu-stock/api/sample')
  assert.equal(first.json.records.find((record) => record.kind === 'ut').value, 0)

  // 模拟「另一个窗口刚刚采样过」：settings.json 的基线已经推到 1000。
  const settingsPath = path.join(dir, 'settings.json')
  const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
  saved.utBaseline = 1000
  await fs.writeFile(settingsPath, JSON.stringify(saved))

  await fs.writeFile(log, Buffer.concat([frame(1, 1000), frame(2, 600)]))
  const second = await request(routes, 'POST', '/gugu-stock/api/sample')
  const ut = second.json.records.find((record) => record.kind === 'ut')
  assert.equal(ut.value, 600, 'only the real growth is recorded, not the whole total again')
})

test('the ut baseline persists across restarts and can be reset', async () => {
  const zlib = await import('node:zlib')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-utbase-'))
  const sessions = path.join(dir, 'sessions')
  const log = path.join(sessions, 'ws-a', 'session-1', 'session.v4.jsonl.zstd')
  await fs.mkdir(path.dirname(log), { recursive: true })
  const frame = (turn, tokens) =>
    zlib.zstdCompressSync(
      Buffer.from(
        JSON.stringify({
          type: 'assistant/message',
          data: {
            turn,
            step: 1,
            usage: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: tokens },
          },
        }) + '\n',
        'utf8',
      ),
    )
  await fs.writeFile(log, frame(1, 6100))

  const mod = await freshModule(dir, { GUGU_SESSIONS_DIR: sessions })
  const { ctx, routes } = fakeCtx()
  const dispose = mod.apply(ctx, undefined)
  dispose()

  const first = await request(routes, 'POST', '/gugu-stock/api/sample')
  assert.equal(first.json.records.find((record) => record.kind === 'ut').value, 0)
  const state = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(state.json.utBaseline, 6100, 'the total is stored as the baseline')

  // 重启插件：基线应当从 settings.json 读回来，第二次采样仍是 0。
  const mod2 = await freshModule(dir, { GUGU_SESSIONS_DIR: sessions })
  const second = fakeCtx()
  const dispose2 = mod2.apply(second.ctx, undefined)
  dispose2()
  const restarted = await request(second.routes, 'GET', '/gugu-stock/api/state')
  assert.equal(restarted.json.utBaseline, 6100, 'the baseline survives a restart')

  // 把基线清回 0：下一次采样就把整段总量重新记一遍。
  const cleared = await request(second.routes, 'POST', '/gugu-stock/api/settings', { utBaseline: 0 })
  assert.equal(cleared.json.utBaseline, 0)
  const reset = await request(second.routes, 'POST', '/gugu-stock/api/sample')
  assert.equal(
    reset.json.records.find((record) => record.kind === 'ut').value,
    6100,
    'a zero baseline makes the next sample record the whole total again',
  )
})

test('open-csv resolves the Windows opener without spawning in dry mode', async () => {
  const { routes, dir } = await boot()
  const result = await request(routes, 'POST', '/gugu-stock/api/open-csv')
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.dry, true)
  assert.equal(result.json.path, path.join(dir, CSV_NAME))
  assert.ok(await fs.stat(path.join(dir, CSV_NAME)))
  const raw = await fs.readFile(path.join(dir, CSV_NAME), 'utf8')
  assert.equal(raw[0], '\uFEFF')
  assert.match(raw, /时间,来源,数值/)
})

test('save-chart copies the generated PNG to the desktop with a timestamped Chinese name', async () => {
  const { routes, dir } = await boot()
  const desktop = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-desktop-'))
  process.env.GUGU_DESKTOP_DIR = desktop
  try {
    const fixture = path.resolve(import.meta.dirname, '../fixtures/sample60.csv')
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(fixture, path.join(dir, CSV_NAME))

    const missing = await request(routes, 'POST', '/gugu-stock/api/save-chart', { kind: 'line' })
    assert.equal(missing.status, 500)
    assert.equal(missing.json.error.code, 'chart_missing')

    const charted = await request(routes, 'POST', '/gugu-stock/api/chart')
    assert.equal(charted.status, 200, JSON.stringify(charted.json && charted.json.error))

    const saved = await request(routes, 'POST', '/gugu-stock/api/save-chart', { kind: 'line' })
    assert.equal(saved.status, 200, JSON.stringify(saved.json))
    assert.equal(saved.json.ok, true)
    assert.equal(path.dirname(saved.json.savedPath), desktop)
    assert.match(saved.json.fileName, /^谷谷股_折线图_\d{14}\.png$/)
    const stat = await fs.stat(saved.json.savedPath)
    assert.ok(stat.size > 1000, 'saved PNG should not be empty')

    const second = await request(routes, 'POST', '/gugu-stock/api/save-chart', { kind: 'line' })
    assert.equal(second.status, 200)
    assert.notEqual(second.json.savedPath, saved.json.savedPath, 'repeated saves must not clobber each other')
  } finally {
    delete process.env.GUGU_DESKTOP_DIR
    await fs.rm(desktop, { recursive: true, force: true })
  }
})

test('save-chart names the spend variant 柱状图', async () => {
  const { routes, dir } = await boot()
  const desktop = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-desktop-'))
  process.env.GUGU_DESKTOP_DIR = desktop
  try {
    const fixture = path.resolve(import.meta.dirname, '../fixtures/sample60.csv')
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(fixture, path.join(dir, CSV_NAME))
    const charted = await request(routes, 'POST', '/gugu-stock/api/chart', { kind: 'spend' })
    assert.equal(charted.status, 200, JSON.stringify(charted.json && charted.json.error))
    const saved = await request(routes, 'POST', '/gugu-stock/api/save-chart', { kind: 'spend' })
    assert.equal(saved.status, 200, JSON.stringify(saved.json))
    assert.match(saved.json.fileName, /^谷谷股_柱状图_\d{14}\.png$/)
  } finally {
    delete process.env.GUGU_DESKTOP_DIR
    await fs.rm(desktop, { recursive: true, force: true })
  }
})

test('the cumulative chart is a third kind and saves with its own name', async () => {
  const { routes, dir } = await boot()
  const desktop = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-desktop-'))
  process.env.GUGU_DESKTOP_DIR = desktop
  try {
    const fixture = path.resolve(import.meta.dirname, '../fixtures/sample60.csv')
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(fixture, path.join(dir, CSV_NAME))
    const charted = await request(routes, 'POST', '/gugu-stock/api/chart', { kind: 'total' })
    assert.equal(charted.status, 200, JSON.stringify(charted.json && charted.json.error))
    assert.equal(charted.json.meta.kind, 'total', 'the host should ask python for the cumulative chart')
    assert.ok(Array.isArray(charted.json.meta.totalLines) && charted.json.meta.totalLines.length > 0, 'no cumulative lines')
    const saved = await request(routes, 'POST', '/gugu-stock/api/save-chart', { kind: 'total' })
    assert.equal(saved.status, 200, JSON.stringify(saved.json))
    assert.match(saved.json.fileName, /^谷谷股_累计图_\d{14}\.png$/)
  } finally {
    delete process.env.GUGU_DESKTOP_DIR
    await fs.rm(desktop, { recursive: true, force: true })
  }
})

test('chart returns an inline PNG plus the metadata for the drawn window', async () => {
  const { routes, dir } = await boot()
  const fixture = path.resolve(import.meta.dirname, '../fixtures/sample60.csv')
  await fs.mkdir(dir, { recursive: true })
  await fs.copyFile(fixture, path.join(dir, CSV_NAME))

  const result = await request(routes, 'POST', '/gugu-stock/api/chart')
  assert.equal(result.status, 200, JSON.stringify(result.json && result.json.error))
  assert.equal(result.json.ok, true)
  assert.match(result.json.dataUrl, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
  assert.ok(await fs.stat(path.join(dir, 'gugu-chart.png')))
  assert.equal(result.json.meta.days, 60)
  assert.equal(result.json.meta.points, 180)
  assert.equal(result.json.meta.gridStep, 10)

  const again = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(again.json.chartMeta.days, 60)
})

test('colorMode is persisted via settings, exposed in state and passed to the chart', async () => {
  const { routes, dir } = await boot()
  const fixture = path.resolve(import.meta.dirname, '../fixtures/sample60.csv')
  await fs.mkdir(dir, { recursive: true })
  await fs.copyFile(fixture, path.join(dir, CSV_NAME))

  // settings POST 接受 change/source 并落盘；非法值回落到 change。
  const saved = await request(routes, 'POST', '/gugu-stock/api/settings', { colorMode: 'source' })
  assert.equal(saved.status, 200, JSON.stringify(saved.json && saved.json.error))
  assert.equal(saved.json.colorMode, 'source')
  assert.ok(Array.isArray(saved.json.colorModeOptions))
  assert.deepEqual(saved.json.colorModeOptions, ['change', 'source'])

  const state = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(state.json.colorMode, 'source')
  assert.deepEqual(state.json.colorModeOptions, ['change', 'source'])

  // 不显式传 colorMode 时沿用 state 的值；显式传非法值也不污染 state。
  const charted = await request(routes, 'POST', '/gugu-stock/api/chart')
  assert.equal(charted.status, 200, JSON.stringify(charted.json && charted.json.error))
  assert.equal(charted.json.colorMode, 'source')
  assert.equal(charted.json.meta.colorMode, 'source')

  const bad = await request(routes, 'POST', '/gugu-stock/api/settings', { colorMode: 'nonsense' })
  assert.equal(bad.json.colorMode, 'change')
})

test('chart rejects an empty CSV with empty_csv', async () => {
  const { routes } = await boot()
  const result = await request(routes, 'POST', '/gugu-stock/api/chart')
  assert.equal(result.status, 500)
  assert.equal(result.json.error.code, 'empty_csv')
})

test('methods and unknown paths are rejected', async () => {
  const { routes } = await boot()
  assert.equal((await request(routes, 'GET', '/gugu-stock/api/chart')).status, 405)
  assert.equal((await request(routes, 'DELETE', '/gugu-stock/api/state')).status, 405)
  const unknown = await request(routes, 'POST', '/gugu-stock/api/nope')
  assert.equal(unknown.status, 404)
  assert.equal(unknown.json.error.code, 'not_found')
})

test('the connection fence wins before any route work', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-'))
  const mod = await freshModule(dir)
  const { ctx, routes } = fakeCtx({ connection: { requestRejection: () => ({ reason: 'bad-origin' }) } })
  const dispose = mod.apply(ctx, undefined)
  dispose()
  const result = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(result.status, 403)
  assert.equal(result.json.error.code, 'forbidden')
})

test('a missing python reports an actionable python_missing error', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-'))
  await fs.copyFile(
    path.resolve(import.meta.dirname, '../fixtures/sample-flat.csv'),
    path.join(dir, CSV_NAME),
  )
  const mod = await freshModule(dir)
  process.env.GUGU_PYTHON = 'gugu-python-that-does-not-exist'
  try {
    const { ctx, routes } = fakeCtx()
    const dispose = mod.apply(ctx, undefined)
    dispose()
    const result = await request(routes, 'POST', '/gugu-stock/api/chart')
    assert.equal(result.status, 500)
    assert.equal(result.json.error.code, 'python_missing')
    assert.match(result.json.error.message, /GUGU_PYTHON/)
  } finally {
    delete process.env.GUGU_PYTHON
  }
})

test('chart honours kind/from/to and writes the spend PNG next to the line one', async () => {
  const { routes, dir } = await boot()
  const fixture = path.resolve(import.meta.dirname, '../fixtures/sample-spend.csv')
  await fs.copyFile(fixture, path.join(dir, CSV_NAME))

  const spend = await request(routes, 'POST', '/gugu-stock/api/chart', {
    kind: 'spend',
    from: '2026-11-02',
    to: '2026-11-04',
  })
  assert.equal(spend.status, 200, JSON.stringify(spend.json && spend.json.error))
  assert.equal(spend.json.kind, 'spend')
  assert.equal(spend.json.meta.firstDate, '2026-11-02')
  assert.equal(spend.json.meta.lastDate, '2026-11-04')
  assert.equal(spend.json.meta.days, 3)
  assert.ok(await fs.stat(path.join(dir, 'gugu-spend-chart.png')))

  const line = await request(routes, 'POST', '/gugu-stock/api/chart', { kind: 'line' })
  assert.equal(line.status, 200, JSON.stringify(line.json && line.json.error))
  assert.equal(line.json.meta.kind, 'line')
  assert.ok(await fs.stat(path.join(dir, 'gugu-chart.png')))
})

test('chart rejects malformed or oversized date ranges with 400', async () => {
  const { routes } = await boot()
  const fixture = path.resolve(import.meta.dirname, '../fixtures/sample-spend.csv')
  const dir = process.env.GUGU_STOCK_DIR
  await fs.copyFile(fixture, path.join(dir, CSV_NAME))

  const bad = await request(routes, 'POST', '/gugu-stock/api/chart', { from: '2026/11/02' })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.error.code, 'bad_range')

  const reversed = await request(routes, 'POST', '/gugu-stock/api/chart', { from: '2026-11-05', to: '2026-11-01' })
  assert.equal(reversed.status, 400)
  assert.equal(reversed.json.error.code, 'bad_range')

  const tooLong = await request(routes, 'POST', '/gugu-stock/api/chart', { from: '2024-01-01', to: '2026-11-01' })
  assert.equal(tooLong.status, 400)
  assert.equal(tooLong.json.error.code, 'range_too_long')
})

test('state exposes the default 60-day window', async () => {
  const { routes } = await boot()
  const result = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(result.status, 200)
  const range = result.json.range
  assert.ok(range && range.defaultFrom && range.defaultTo)
  assert.equal(range.maxDays, 60)
  assert.equal(range.limitDays, 366)
  const span = (Date.parse(range.defaultTo) - Date.parse(range.defaultFrom)) / 86400000 + 1
  assert.equal(span, 60)
})

test('normalize re-orders the file without losing a row, and state reports outOfOrder', async () => {
  const { routes, dir } = await boot()
  const csv = await import(new URL('file://' + PLUGIN.replace(/\\\\/g, '/') + '/lib/csv.js').href)
  const file = path.join(dir, CSV_NAME)
  // 模拟 Excel 回写：22 日的块被挪到最上方。
  await csv.writeCsvFile(file, [
    { time: '2026-11-22 19:41:00', kind: 'ds', value: 15.45 },
    { time: '2026-11-10 01:34:00', kind: 'ds', value: 9.1 },
    { time: '2026-11-11 14:22:00', kind: 'al', value: 300 },
  ])

  const before = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(before.json.outOfOrder, 1, 'state surfaces the out-of-order count')

  const fixed = await request(routes, 'POST', '/gugu-stock/api/normalize', {})
  assert.equal(fixed.status, 200)
  assert.equal(fixed.json.ok, true)
  assert.equal(fixed.json.changed, true)
  assert.equal(fixed.json.rows, 3, 'row count is unchanged')

  const after = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(after.json.outOfOrder, 0, 'the file is tidy afterwards')
  assert.equal(after.json.rows, 3, 'no row was dropped')
  assert.equal(after.json.latestTime, '2026-11-22 19:41:00', 'the newest row is still the 22nd')

  const rows = await csv.readCsvFile(file)
  assert.deepEqual(
    rows.map((r) => r.time),
    ['2026-11-10 01:34:00', '2026-11-11 14:22:00', '2026-11-22 19:41:00'],
    'oldest first, the hand-added al 300 row survives',
  )

  const noop = await request(routes, 'POST', '/gugu-stock/api/normalize', {})
  assert.equal(noop.json.changed, false, 'a second run is a no-op')
})

test('a sample tidies an out-of-order file automatically (no button, no manual call)', async () => {
  const http = await import('node:http')
  const csv = await import(new URL('file://' + PLUGIN.replace(/\\\\/g, '/') + '/lib/csv.js').href)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-host-tidy-'))
  const file = path.join(dir, CSV_NAME)
  // 模拟 Excel 回写出来的乱序文件：22 日那几行被挪到了最顶部。
  await csv.writeCsvFile(file, [
    { time: '2026-11-22 19:41:00', kind: 'wb', value: 891.21 },
    { time: '2026-11-22 19:41:00', kind: 'ds', value: 15.45 },
    { time: '2026-11-10 01:34:00', kind: 'ds', value: 9.1 },
    { time: '2026-11-11 14:22:00', kind: 'al', value: 300 },
  ])
  const before = await csv.readCsvFile(file)
  assert.ok(csv.countOutOfOrder(before) > 0, 'fixture really is out of order')

  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ accounts: [{ id: 'a', selected: true, credits: 969.03 }] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const mod = await freshModule(dir)
  const routes = []
  const sources = (name) => {
    if (name === 'deepseekAccount') {
      return {
        getState: () => ({ userId: 'test' }),
        getBalance: async () => ({ status: 'ready', value: [{ currency: 'CNY', balance: 12.5 }], bonusWallets: [] }),
      }
    }
    if (name === 'webServer') return { getOrigin: () => `http://127.0.0.1:${port}` }
    return undefined
  }
  const dispose = mod.apply(
    {
      effect: (fn) => fn(),
      get: sources,
      webServer: {
        getOrigin: () => `http://127.0.0.1:${port}`,
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
      connection: { requestRejection: () => undefined },
    },
    undefined,
  )
  dispose()
  // 只点「立即采样」——没有 normalize 按钮、也没有额外的整理调用。
  const sampled = await request(routes, 'POST', '/gugu-stock/api/sample')
  await new Promise((resolve) => server.close(resolve))
  assert.equal(sampled.status, 200)

  const after = await csv.readCsvFile(file)
  // v1.19：一次采样写 ds/wb/ut 三行（ut 是新增的 token 源）。
  assert.equal(after.length, before.length + 3, 'only the three new samples were added')
  assert.equal(csv.countOutOfOrder(after), 0, 'the file is chronological again without a manual tidy')
  const stamps = after.map((row) => row.time)
  assert.deepEqual(stamps, [...stamps].sort(), 'rows read oldest-first')
  // 一行都不能少：手加的 al 300 和 22 日那两行都还在。
  assert.ok(after.some((row) => row.kind === 'al' && Math.abs(row.value - 300) < 1e-9), 'the hand-added al row survives')
  assert.ok(after.some((row) => row.kind === 'wb'), 'the 22nd wb row survives')

  const state = await request(routes, 'GET', '/gugu-stock/api/state')
  assert.equal(state.json.outOfOrder, 0, 'state agrees the file is tidy')
  assert.ok(state.json.lastTidyAt, 'the automatic tidy is recorded on state')
  assert.ok(state.json.lastTidyMoved >= 2, 'it reports how many rows it moved')
})
