// Skill 通道的缩放/颜色来源：v1.18.2 起一律跟面板走。
// 1) 三处默认值必须一致（出图脚本 / 宿主 / 面板），否则面板点出来的图和 skill 出来的图会不一样。
// 2) skill 报告的 wbPercent 必须等于 settings.json 里的值（没有就退到 3.25）。
// 3) 真正画出来的图里，colorMode / 缩放 / 数据源必须就是面板保存的那一套 —— 这是
//    「skill 不出自定义设置」的行为级证据（读 line.json 的 meta，不看脚本源码）。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { PLUGIN } from './_plugin-path.mjs'
const SKILL = path.join(os.homedir(), '.dsh', 'skills', 'gugu-stock-charts', 'scripts', 'gugu-charts.sh')
const SETTINGS = path.join(os.homedir(), '.dsh', 'data', 'gugu-stock', 'settings.json')

function run(args) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gugu-wb-'))
  const stdout = execFileSync('bash', [SKILL, '--no-sample', '--only', 'line', '--out', path.join(out, 'x'), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { stdout, dir: path.join(out, 'x') }
}

function field(stdout, name) {
  const line = stdout.split(/\r?\n/).find((row) => row.startsWith(name + ' '))
  assert.ok(line, name + ' not printed')
  return line.slice(name.length + 1).trim()
}

const saved = fs.existsSync(SETTINGS) ? JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) : null

test('the python renderer, the host and the panel agree on the default scales', () => {
  const py = fs.readFileSync(path.join(PLUGIN, 'scripts', 'gugu_chart.py'), 'utf8')
  const host = fs.readFileSync(path.join(PLUGIN, 'index.js'), 'utf8')
  const client = fs.readFileSync(path.join(PLUGIN, 'client.js'), 'utf8')
  assert.match(
    py,
    /^SCALE_DEFAULTS = \{"ds": 100\.0, "wb": 3\.25, "aliyun": 12\.5, "ut": 12500000\.0\}$/m,
    'the renderer defaults must include the ut divisor',
  )
  assert.match(py, /^WB_PERCENT_DEFAULT = SCALE_DEFAULTS\["wb"\]$/m)
  assert.match(host, /^const WB_PERCENT_DEFAULT = 3\.25$/m)
  assert.match(
    client,
    /^ {4}const SCALES_DEFAULT = \{ ds: 100, wb: 3\.25, aliyun: 12\.5, ut: 12500000 \}$/m,
    'the panel defaults must include the ut divisor',
  )
})

test('the skill reports the wb scale the panel saved', () => {
  const { stdout } = run([])
  const reported = Number(field(stdout, 'GUGU_WB_PERCENT'))
  if (saved) {
    const expected = saved.scales && typeof saved.scales.wb === 'number' ? saved.scales.wb : saved.wbPercent
    assert.equal(reported, Number(expected), 'skill should use the panel value ' + expected)
  } else {
    assert.equal(reported, 3.25)
  }
})

test('the rendered chart carries the panel colour mode, scales and sources', () => {
  const { stdout, dir } = run([])
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'line.json'), 'utf8'))
  const settings = JSON.parse(field(stdout, 'GUGU_SETTINGS'))
  assert.equal(meta.colorMode, settings.colorMode, 'colour mode must come from the panel')
  assert.equal(Number(meta.wbPercent), Number(settings.scales.wb), 'wb scale must come from the panel')
  assert.equal(Number(meta.scales && meta.scales.ds), Number(settings.scales.ds))
  assert.equal(Number(meta.scales && meta.scales.aliyun), Number(settings.scales.aliyun))
  for (const name of ['ds', 'wb', 'aliyun']) {
    assert.equal(
      Boolean(meta.sources && meta.sources[name]),
      settings.sources.indexOf(name) >= 0,
      'source ' + name + ' must follow the panel switch',
    )
  }
})