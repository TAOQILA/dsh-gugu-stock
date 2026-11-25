// Skill 通道：v1.18.2 起不再允许自定义设置。
// 图的一切参数（主题 / 颜色来源 / 数据源开关 / 三条线缩放）都从面板写的
// settings.json 读，时间窗固定为面板默认的「最近 60 天」。
// 本用例锁死三件事：
//   1) 默认时间窗 == 面板默认（今天往回 59 天 → 今天，60 天）
//   2) 任何视觉参数都被拒绝（exit 64 + GUGU_FIXED_SETTINGS），skill 无法让图和面板不同
//   3) 没有 settings.json 时退化成插件的自带默认值，而不是乱猜
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const SKILL = path.join(os.homedir(), '.dsh', 'skills', 'gugu-stock-charts', 'scripts', 'gugu-charts.sh')
const DATA_DIR = path.join(os.homedir(), '.dsh', 'data', 'gugu-stock')
const SETTINGS = path.join(DATA_DIR, 'settings.json')

function outDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gugu-range-'))
}

function run(args, env = {}) {
  const dir = outDir()
  const stdout = execFileSync('bash', [SKILL, '--no-sample', '--only', 'line', '--out', path.join(dir, 'x'), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, env),
  })
  return { stdout, dir }
}

function runRaw(args, env = {}) {
  const dir = outDir()
  try {
    const stdout = execFileSync('bash', [SKILL, '--out', path.join(dir, 'x'), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, env),
    })
    return { status: 0, stdout, dir }
  } catch (err) {
    return { status: err.status, stdout: String(err.stdout || ''), stderr: String(err.stderr || ''), dir }
  }
}

function field(stdout, name) {
  const line = stdout.split(/\r?\n/).find((row) => row.startsWith(name + ' '))
  assert.ok(line, name + ' not printed')
  return line.slice(name.length + 1).trim()
}

function has(stdout, name) {
  return stdout.split(/\r?\n/).some((row) => row === name || row.startsWith(name + ' '))
}

const pad = (value) => String(value).padStart(2, '0')
const iso = (date) => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
const today = new Date()
const expectedFrom = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 59))

test('the window is the panel default: today-59 .. today, 60 days', () => {
  const { stdout } = run([])
  const range = JSON.parse(field(stdout, 'GUGU_RANGE'))
  assert.equal(range.mode, 'panel-default')
  assert.equal(range.days, 60)
  assert.equal(range.from, expectedFrom)
  assert.equal(range.to, iso(today))
})

test('the settings line mirrors settings.json field by field', () => {
  const { stdout } = run([])
  const settings = JSON.parse(field(stdout, 'GUGU_SETTINGS'))
  assert.deepEqual(
    Object.keys(settings).sort(),
    ['colorMode', 'scales', 'sources', 'theme', 'wbPercent'],
  )
  if (fs.existsSync(SETTINGS)) {
    const saved = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
    const savedTheme = String(saved.theme || 'auto').toLowerCase()
    assert.equal(settings.theme, savedTheme === 'auto' ? 'light' : savedTheme)
    assert.equal(settings.colorMode, saved.colorMode === 'source' ? 'source' : 'change')
    assert.deepEqual(
      settings.sources,
      ['ds', 'wb', 'aliyun', 'ut'].filter((name) => {
        const savedSources = saved.sources || {}
        if (typeof savedSources[name] === 'boolean') return savedSources[name]
        return name !== 'aliyun'
      }),
    )
  }
})

test('visual overrides are refused: --theme', () => {
  const result = runRaw(['--theme', 'light', '--no-sample'])
  assert.equal(result.status, 64)
  assert.match(result.stdout, /GUGU_FIXED_SETTINGS/)
})

test('visual overrides are refused: --days / --from / --to', () => {
  for (const args of [['--days', '7'], ['--from', '2026-11-01'], ['--to', '2026-11-20']]) {
    const result = runRaw(args.concat(['--no-sample']))
    assert.equal(result.status, 64, args[0] + ' should be refused')
    assert.match(result.stdout, /GUGU_FIXED_SETTINGS/)
  }
})

test('visual overrides are refused: --wb-percent / --sources / --color-mode / scales', () => {
  for (const args of [
    ['--wb-percent', '5'],
    ['--sources', 'ds'],
    ['--color-mode', 'change'],
    ['--scale-ds', '80'],
    ['--scale-wb', '4'],
    ['--scale-aliyun', '20'],
  ]) {
    const result = runRaw(args.concat(['--no-sample']))
    assert.equal(result.status, 64, args[0] + ' should be refused')
    assert.match(result.stdout, /GUGU_FIXED_SETTINGS/)
  }
})

test('--only and --out still work (they do not change the picture)', () => {
  const { stdout, dir } = run(['--only', 'line'])
  assert.match(stdout, /CHART_FILES /)
  assert.equal(fs.existsSync(path.join(dir, 'x', 'line.png')), true)
  assert.equal(fs.existsSync(path.join(dir, 'x', 'spend.png')), false)
  assert.equal(fs.existsSync(path.join(dir, 'x', 'total.png')), false)
})

test('without settings.json the skill falls back to the plugin defaults', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gugu-nosettings-'))
  fs.writeFileSync(path.join(empty, '.endpoint'), '')
  const { stdout, status } = runRaw(['--no-sample', '--only', 'line'], { GUGU_STOCK_DIR: empty })
  assert.ok(has(stdout, 'GUGU_SETTINGS_NOTE'), 'should announce the fallback: ' + stdout.slice(0, 200))
  const settings = JSON.parse(field(stdout, 'GUGU_SETTINGS'))
  assert.equal(settings.theme, 'light')
  assert.equal(settings.colorMode, 'change')
  assert.deepEqual(settings.sources, ['ds', 'wb', 'ut'])
  assert.equal(settings.scales.ds, 100)
  assert.equal(settings.scales.wb, 3.25)
  assert.equal(settings.scales.aliyun, 12.5)
  assert.equal(settings.scales.ut, 12500000)
  assert.ok(status === 0 || status === 2 || status === 7, 'unexpected status ' + status)
})