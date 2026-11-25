// 不管谁调用渲染器，都按设置面板那一套出图（用户 m09150：另一个 Agent 拿到的还是浅色、没有阿里云线）。
//
// 以前 `python gugu_chart.py --csv ... --out ...` 裸调会退回内置默认（light + 不画阿里云），
// 出来的图和面板不一致。现在渲染器会自己读 CSV 同目录的 settings.json：
//   1) 裸调（不给任何视觉参数）→ 主题/配色/三源/缩放全部等于 settings.json
//   2) 裸调 与「按 settings.json 显式传参」逐字节相同
//   3) 夹具目录没有 settings.json → 仍然 light + change（单测的确定性不能被破坏）
//   4) 显式参数优先于 settings.json
import assert from 'node:assert/strict'

// 出图右下角有「生成时间」水印；逐字节比对时把它钉死。
process.env.GUGU_GENERATED_AT = '2026-01-01 00:00'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { PLUGIN } from './_plugin-path.mjs'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHART_PY = path.join(PLUGIN, 'scripts', 'gugu_chart.py')
const DATA = path.join(os.homedir(), '.dsh', 'data', 'gugu-stock')
const CSV = path.join(DATA, 'balances-v2.csv')
const SETTINGS = path.join(DATA, 'settings.json')

function py(script, args) {
  if (process.env.GUGU_PYTHON) return execFileSync(process.env.GUGU_PYTHON, [script, ...args], { encoding: 'utf8' })
  if (process.platform === 'win32') return execFileSync('py', ['-3.12', script, ...args], { encoding: 'utf8' })
  return execFileSync('python3', [script, ...args], { encoding: 'utf8' })
}

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

// 把真机 CSV + settings.json 复制到一个临时目录，这样测试不碰用户数据。
function sandboxCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gugu-settings-'))
  if (!fs.existsSync(CSV)) return null
  fs.copyFileSync(CSV, path.join(dir, 'balances-v2.csv'))
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, path.join(dir, 'settings.json'))
  return dir
}

function chart(dir, out, extra = []) {
  const meta = out + '.json'
  const stdout = py(CHART_PY, [
    '--csv', path.join(dir, 'balances-v2.csv'),
    '--out', out,
    '--meta', meta,
    '--max-days', '60',
    '--from', '2026-09-25',
    '--to', '2026-11-23',
    ...extra,
  ])
  return { meta: JSON.parse(fs.readFileSync(meta, 'utf8')), stdout, png: out }
}

test('a bare invocation reads settings.json next to the CSV', (t) => {
  const dir = sandboxCopy()
  if (!dir) return t.skip('no live CSV on this machine')
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
  const { meta, stdout } = chart(dir, path.join(dir, 'bare.png'))

  assert.equal(meta.settingsApplied, true, 'renderer should report that panel settings were applied')
  assert.equal(meta.theme, settings.theme, 'theme must come from settings.json')
  assert.equal(meta.colorMode, settings.colorMode, 'color mode must come from settings.json')
  assert.deepEqual(meta.sources, settings.sources, 'series switches must come from settings.json')
  for (const name of ['ds', 'wb', 'aliyun', 'ut']) {
    assert.equal(meta.scales[name], settings.scales[name], `scale for ${name} must come from settings.json`)
  }
  // v1.22 起面板设置也写在表的第一行（`#gugu {...}`），表里有就以表为准。
  const firstLine = fs.readFileSync(path.join(dir, 'balances-v2.csv'), 'utf8').split(/\r?\n/)[0]
  if (firstLine.startsWith('#gugu ')) {
    assert.ok(meta.settingsPath.endsWith('#gugu'), 'the settings line inside the csv wins: ' + meta.settingsPath)
  } else {
    assert.equal(path.basename(meta.settingsPath), 'settings.json', 'renderer should report which settings file it used')
  }
})

test('without the in-table line the renderer falls back to settings.json', (t) => {
  const dir = sandboxCopy()
  if (!dir) return t.skip('no live CSV on this machine')
  const csvPath = path.join(dir, 'balances-v2.csv')
  const text = fs.readFileSync(csvPath, 'utf8')
  fs.writeFileSync(
    csvPath,
    text
      .split(/\r?\n/)
      .filter((line) => !line.startsWith('#gugu '))
      .join('\r\n'),
    'utf8',
  )
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
  const { meta } = chart(dir, path.join(dir, 'fallback.png'))
  assert.equal(path.basename(meta.settingsPath), 'settings.json', 'falls back to settings.json')
  assert.equal(meta.theme, settings.theme)
})

test('bare invocation is byte-identical to passing settings.json explicitly', (t) => {
  const dir = sandboxCopy()
  if (!dir) return t.skip('no live CSV on this machine')
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
  const bare = chart(dir, path.join(dir, 'a.png'))
  const explicit = chart(dir, path.join(dir, 'b.png'), [
    '--theme', settings.theme,
    '--color-mode', settings.colorMode,
    '--sources', ['ds', 'wb', 'aliyun', 'ut'].filter((n) => settings.sources[n]).join(','),
    '--scale-ds', String(settings.scales.ds),
    '--scale-wb', String(settings.scales.wb),
    '--scale-aliyun', String(settings.scales.aliyun),
    '--scale-ut', String(settings.scales.ut),
  ])
  assert.equal(sha(bare.png), sha(explicit.png), 'the two PNGs must be identical')
})

test('a fixture without settings.json keeps the deterministic defaults', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gugu-nosettings-'))
  const png = path.join(out, 'fixture.png')
  const metaFile = png + '.json'
  const fixture = path.join(HERE, '..', 'fixtures', 'sample60.csv')
  py(CHART_PY, ['--csv', fixture, '--out', png, '--meta', metaFile])
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
  assert.equal(meta.settingsApplied, false, 'no settings.json beside the fixture')
  assert.equal(meta.theme, 'light')
  assert.equal(meta.colorMode, 'change')
  assert.equal(meta.sources.aliyun, false)
  assert.equal(meta.sources.ut, false, 'ut is off unless asked for')
})

test('explicit arguments still win over settings.json', (t) => {
  const dir = sandboxCopy()
  if (!dir) return t.skip('no live CSV on this machine')
  const { meta } = chart(dir, path.join(dir, 'force.png'), [
    '--theme', 'light',
    '--color-mode', 'change',
    '--sources', 'ds',
  ])
  assert.equal(meta.theme, 'light')
  assert.equal(meta.colorMode, 'change')
  assert.deepEqual(meta.sources, { ds: true, wb: false, aliyun: false, ut: false })
})