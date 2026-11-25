import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * DSH Go 工具卡：经 DSH Remote 中转时，插件只剩「工具卡」这一条可见通道。
 * 这里用假 ctx 把 apply 跑起来，直接调用 gugu_stock 工具，检查
 *   1) 工具确实注册上了（说明中转主机上模型能调到）
 *   2) presentationMeta 返回 { "dsh-go/view": … } 且 JSON ≤ 8 KiB
 *   3) 视图只用文档列出的 v1 组件，字段名正确
 *   4) 工具给模型的文字里有余额和 CSV 路径
 */

import { PLUGIN } from './_plugin-path.mjs'

async function bootPlugin(csvText, settings) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-go-'))
  const csvPath = path.join(dir, 'balances-v2.csv')
  await fs.writeFile(csvPath, csvText, 'utf8')
  if (settings) await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify(settings), 'utf8')
  process.env.GUGU_STOCK_DIR = dir
  process.env.GUGU_OPEN_DRY = '1'

  const registered = []
  const fakeCtx = {
    effect: (factory) => {
      const dispose = factory()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    get: (name) => (name === 'tools' ? { register: (def) => { registered.push(def); return () => {} } } : undefined),
    webServer: { register: () => () => {} },
    connection: { requestRejection: () => undefined },
  }
  // index.js 在 import 时就把 GUGU_STOCK_DIR 固化进 DATA_DIR；每个测试必须
  // 用带查询串的 URL 破缓存重新加载，否则后一个测试会读到前一个的目录/设置。
  const url = pathToFileURL(path.join(PLUGIN, 'index.js')).href + '?' + Date.now() + Math.random()
  const mod = await import(url)
  const dispose = mod.apply(fakeCtx, {})
  await new Promise((resolve) => setTimeout(resolve, 60))
  return { dir, csvPath, registered, dispose }
}

const SAMPLE = '\uFEFF时间,余额\r\n2026-11-21 15:48,21.36\r\n2026-11-21 12:00,26.78\r\n2026-11-20 23:45,14.29\r\n2026-11-20 09:00,16.00\r\n'

test('gugu_stock 工具注册并返回 dsh-go 视图', async () => {
  const { registered, dispose } = await bootPlugin(SAMPLE)
  try {
    assert.equal(registered.length, 1)
    const definition = registered[0]
    assert.equal(definition.name, 'gugu_stock')
    assert.equal(typeof definition.output.presentationMeta, 'function')

    const value = await definition.execute({ action: 'status' })
    assert.equal(value.ok, true)
    assert.equal(value.rows, 4)
    assert.equal(value.days, 2)
    assert.equal(value.latestBalance, 21.36)
    assert.deepEqual(value.daily.map((day) => day.date), ['2026-11-20', '2026-11-21'])
    assert.deepEqual(value.daily.map((day) => day.balance), [14.29, 21.36])

    // 给模型看的文字
    const blocks = definition.output.render({ action: 'status' }, value)
    assert.equal(blocks[0].type, 'text')
    assert.match(blocks[0].text, /21\.4 元/)
    assert.match(blocks[0].text, /balances-v2\.csv/)

    // 给 DSH Go 画的卡片
    const meta = definition.output.presentationMeta({ action: 'status' }, value)
    const view = meta['dsh-go/view']
    assert.ok(view, 'presentationMeta 必须返回 dsh-go/view')
    const text = JSON.stringify(view)
    assert.ok(Buffer.byteLength(text, 'utf8') <= 8 * 1024, '工具卡视图必须 ≤ 8 KiB')
    assert.equal(view.type, 'stack')
    assert.match(view.title, /谷谷股 · 21\.4 元/)
    assert.ok(view.children.length <= 16)

    const kinds = view.children.map((child) => child.type)
    assert.deepEqual(kinds, ['row', 'chart', 'keyValue', 'text'])

    const metrics = view.children[0].children
    // v1.19 起卡片第一行是 DS 余额 / WB 积分 / Tokens 累计 / 记录条数 / 天数
    assert.equal(metrics.length, 5)
    assert.deepEqual(
      metrics.map((metric) => metric.label),
      ['DS 余额', 'WB 积分', 'Tokens 累计', '记录', '天数'],
      'the tool card should name all four series',
    )
    for (const metric of metrics) {
      assert.equal(metric.type, 'metric')
      assert.equal(typeof metric.label, 'string')
      assert.ok(metric.value !== undefined)
    }

    const chart = view.children[1]
    assert.equal(chart.kind, 'line')
    assert.deepEqual(chart.categories, ['11-20', '11-21'])
    assert.equal(chart.series.length, 1)
    assert.deepEqual(chart.series[0].values, [14.29, 21.36])
    assert.ok(chart.series[0].values.length <= 60)

    const kv = view.children[2]
    assert.equal(kv.type, 'keyValue')
    assert.ok(Array.isArray(kv.items))
    assert.ok(kv.items.length <= 24)
  } finally {
    dispose()
  }
})

test('gugu_stock 的 meta 在异常输入下仍返回合法视图或空对象', async () => {
  const { registered, dispose } = await bootPlugin(SAMPLE)
  try {
    const definition = registered[0]
    const empty = {
      ok: true,
      action: 'status',
      csvPath: 'C:\\x\\balances.csv',
      rows: 0,
      days: 0,
      latestBalance: null,
      latestTime: null,
      daily: [],
      sampled: null,
      chart: null,
      error: null,
    }
    const view = definition.output.presentationMeta({}, empty)['dsh-go/view']
    assert.equal(view.type, 'stack')
    assert.equal(view.children.filter((child) => child.type === 'chart').length, 0)
    for (const child of view.children) {
      assert.ok(['row', 'chart', 'keyValue', 'text', 'callout'].includes(child.type))
    }
  } finally {
    dispose()
  }
})

test('gugu_stock 的 chart 动作会跑 Python 出图', async () => {
  const { registered, dispose } = await bootPlugin(SAMPLE)
  try {
    const definition = registered[0]
    const value = await definition.execute({ action: 'chart' })
    assert.equal(value.ok, true, 'chart failed: ' + JSON.stringify({ error: value && value.error, chart: value && value.chart }))
    assert.ok(value.chart && value.chart.generatedAt, 'chart 动作要返回 generatedAt')
    assert.equal(value.chart.points, 4)
    assert.equal(value.chart.days, 2)
    const view = definition.output.presentationMeta({ action: 'chart' }, value)['dsh-go/view']
    assert.ok(Buffer.byteLength(JSON.stringify(view), 'utf8') <= 8 * 1024)
  } finally {
    dispose()
  }
})



test('工具出图必须带上用户的设置，不再出白图/默认缩放/无阿里云（m14864）', async () => {
  // 一套和面板一致的「非默认」设置：dark + source + 四源全开 + 自定义缩放。
  // 工具路径以前只传 kind/from/to，generateChart 用内置默认（light/change/不开
  // 阿里云），还作为显式参数覆盖渲染器读 settings.json 的兜底 → 白图。
  const settings = {
    theme: 'dark',
    colorMode: 'source',
    sources: { ds: true, wb: true, aliyun: true, ut: true },
    scales: { ds: 100, wb: 4.8, aliyun: 35.25, ut: 12500000 },
  }
  const { registered, dispose } = await bootPlugin(SAMPLE, settings)
  try {
    const definition = registered[0]
    const value = await definition.execute({ action: 'chart' })
    assert.equal(value.ok, true, 'chart failed: ' + JSON.stringify(value.error))
    const chart = value.chart || (value.charts && value.charts[0])
    assert.ok(chart, 'tool must return a chart')
    assert.equal(chart.theme, 'dark', 'chart must use panel theme, not white default')
    assert.equal(chart.colorMode, 'source', 'chart must use panel color mode')
    assert.deepEqual(chart.sources, settings.sources, 'all four series must be on')
    assert.equal(chart.sources.aliyun, true, 'the aliyun line must be enabled')
    assert.deepEqual(chart.scales, settings.scales, 'scales must match the panel')
  } finally {
    dispose()
  }
})
