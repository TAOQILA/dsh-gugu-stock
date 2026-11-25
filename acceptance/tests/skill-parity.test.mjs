// Skill 通道和面板必须出同一张图 —— 逐字节相同，不是「看起来差不多」。
//
// 面板点「生成折线图」时，宿主用 generateChart() 组一组参数调 scripts/gugu_chart.py；
// skill 现在组的是同一组参数（只把 --json 换成 --meta 落文件）。参数一样、CSV 一样、
// 日期一样，产出的 PNG 就应该完全一致，所以这里直接比 sha256。
//
// 三个用例：
//   1) line.png 与宿主参数直调的产物逐字节相同
//   2) spend.png 同上
//   3) total.png 同上（消耗累计图）
//   3) skill 传给渲染器的参数清单不落后于宿主（防止以后宿主加参数、skill 没跟上）
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
const CHART_PY = path.join(PLUGIN, 'scripts', 'gugu_chart.py')
const SKILL = path.join(os.homedir(), '.dsh', 'skills', 'gugu-stock-charts', 'scripts', 'gugu-charts.sh')
const CSV = path.join(os.homedir(), '.dsh', 'data', 'gugu-stock', 'balances-v2.csv')

function pythonArgs(script, args) {
  if (process.env.GUGU_PYTHON) return [process.env.GUGU_PYTHON, [script, ...args]]
  // 本机（Windows）用 py -3.12；其它平台退到 python3 / python。
  if (process.platform === 'win32') return ['py', ['-3.12', script, ...args]]
  return ['python3', [script, ...args]]
}

function runSkill(kind) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gugu-parity-'))
  const stdout = execFileSync(
    'bash',
    [SKILL, '--no-sample', '--only', kind, '--out', path.join(out, 'x')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  return { stdout, dir: path.join(out, 'x') }
}

function field(stdout, name) {
  const line = stdout.split(/\r?\n/).find((row) => row.startsWith(name + ' '))
  assert.ok(line, name + ' not printed')
  return line.slice(name.length + 1).trim()
}

/** 用宿主 generateChart() 的那一组参数直调渲染器（--json 换成 --meta 只是为了拿元数据）。 */
function runHostStyle(kind, settings, range, tag) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gugu-hoststyle-'))
  const png = path.join(out, kind + '-' + tag + '.png')
  const meta = path.join(out, kind + '-' + tag + '.json')
  const sources = settings.sources.join(',')
  const args = [
    '--csv', CSV,
    '--out', png,
    '--max-days', '60',
    '--kind', kind,
    '--with-wb', '1',
    '--wb-percent', String(settings.scales.wb),
    '--sources', sources,
    '--scale-ds', String(settings.scales.ds),
    '--scale-wb', String(settings.scales.wb),
    '--scale-aliyun', String(settings.scales.aliyun),
    '--theme', settings.theme,
    '--color-mode', settings.colorMode,
    '--from', range.from,
    '--to', range.to,
    '--meta', meta,
  ]
  const [command, argv] = pythonArgs(CHART_PY, args)
  execFileSync(command, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return png
}

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function panelSettings(stdout) {
  return JSON.parse(field(stdout, 'GUGU_SETTINGS'))
}

test('the skill line chart is byte-identical to the panel chart', () => {
  const { stdout, dir } = runSkill('line')
  const settings = panelSettings(stdout)
  const range = JSON.parse(field(stdout, 'GUGU_RANGE'))
  const skillPng = path.join(dir, 'line.png')
  const hostPng = runHostStyle('line', settings, range, 'line')
  assert.equal(fs.statSync(skillPng).size, fs.statSync(hostPng).size, 'PNG size differs')
  assert.equal(sha(skillPng), sha(hostPng), 'skill and panel produced different pixels')
})

test('the skill spend chart is byte-identical to the panel chart', () => {
  const { stdout, dir } = runSkill('spend')
  const settings = panelSettings(stdout)
  const range = JSON.parse(field(stdout, 'GUGU_RANGE'))
  const skillPng = path.join(dir, 'spend.png')
  const hostPng = runHostStyle('spend', settings, range, 'spend')
  assert.equal(fs.statSync(skillPng).size, fs.statSync(hostPng).size, 'PNG size differs')
  assert.equal(sha(skillPng), sha(hostPng), 'skill and panel produced different pixels')
})

test('the skill total chart is byte-identical to the panel chart', () => {
  const { stdout, dir } = runSkill('total')
  const settings = panelSettings(stdout)
  const range = JSON.parse(field(stdout, 'GUGU_RANGE'))
  const skillPng = path.join(dir, 'total.png')
  const hostPng = runHostStyle('total', settings, range, 'total')
  assert.equal(fs.statSync(skillPng).size, fs.statSync(hostPng).size, 'PNG size differs')
  assert.equal(sha(skillPng), sha(hostPng), 'skill and panel produced different pixels')
})

test('the skill passes every argument the host passes', () => {
  const script = fs.readFileSync(SKILL, 'utf8')
  // 宿主 generateChart() 的参数清单（v1.18.2）：少一个都可能画出不一样的图。
  for (const flag of [
    '--max-days',
    '--kind',
    '--with-wb',
    '--wb-percent',
    '--sources',
    '--scale-ds',
    '--scale-wb',
    '--scale-aliyun',
    '--theme',
    '--color-mode',
    '--from',
    '--to',
  ]) {
    assert.ok(script.indexOf(flag) >= 0, 'skill must forward ' + flag)
  }
  // 反过来：视觉参数不允许从命令行进来（否则「完全按面板」就是空话）。
  assert.match(script, /--from\|--to\|--days\|--theme\|--wb-percent\|--sources\|--color-mode\|--scale-ds\|--scale-wb\|--scale-aliyun/)
  assert.match(script, /GUGU_FIXED_SETTINGS/)
})