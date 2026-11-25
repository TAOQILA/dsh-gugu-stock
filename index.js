/**
 * 谷谷股 — host side.
 *
 * Every 15 minutes while DSH runs, read the DeepSeek total balance
 * (topped-up + granted) and APPEND one row (newest at the bottom) to
 * `~/.dsh/data/gugu-stock/balances-v2.csv`. Only one CSV, append-only:
 * existing rows are never rewritten or removed.
 *
 * The settings page (client.js) talks to the four routes below. They are
 * answered under one prefix so the client can resolve them relative to the page
 * base (desktop shell uses the custom `dsh-app://` scheme).
 */
import { spawn } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CSV_FILE_NAME,
  LEGACY_FILE_NAME,
  KIND_DS,
  KIND_WB,
  KIND_ALIYUN,
  KIND_UT,
  balanceText,
  formatTimestamp,
  appendCsvRow,
  countOutOfOrder,
  normalizeCsvFile,
  readCsvFile,
  readCsvFileWithMeta,
  writeMetaLine,
  decode,
  parseCsv,
  readMeta,
  writeBufferAtomic,
  summarize,
  writeCsvFile,
} from './lib/csv.js'
import { totalTokens } from './lib/tokens.js'

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.join(PACKAGE_ROOT, 'scripts', 'gugu_chart.py')

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DATA_DIR = process.env.GUGU_STOCK_DIR || path.join(DSH_HOME, 'data', 'gugu-stock')
const CSV_PATH = path.join(DATA_DIR, CSV_FILE_NAME)
// v1 文件名。曾经把三列数据写进 balances.csv，但机器上可能同时跑着不止一个
// DSH 引擎（GUI + DSH Remote 主机）；旧引擎的模块里还是两列代码，它每 15 分钟
// 把整份 balances.csv 用两列内容重写一遍，会把三列历史整段吞掉。所以数据文件
// 换名到 balances-v2.csv：旧引擎继续写它的 balances.csv，与新版互不干扰；
// 首次启动时若 v2 不存在而 legacy 存在，就把 legacy 并进 v2 完成迁移。
const LEGACY_CSV_PATH = path.join(DATA_DIR, LEGACY_FILE_NAME)
const CHART_PATH = path.join(DATA_DIR, 'gugu-chart.png')
const SPEND_CHART_PATH = path.join(DATA_DIR, 'gugu-spend-chart.png')
const TOTAL_CHART_PATH = path.join(DATA_DIR, 'gugu-total-chart.png')

// 三种图：余额折线 / 花费柱状 / 消耗累计（v1.23）。路径、中文名、桌面文件名都放一起，
// 免得每加一种图都要在七八个地方补一遍三元表达式。
const CHART_KINDS = {
  line: { path: CHART_PATH, label: '余额折线图', file: '折线图' },
  spend: { path: SPEND_CHART_PATH, label: '花费柱状图', file: '柱状图' },
  total: { path: TOTAL_CHART_PATH, label: '消耗累计图', file: '累计图' },
}
const CHART_KIND_NAMES = Object.keys(CHART_KINDS)

function chartKindOf(value) {
  return CHART_KIND_NAMES.includes(value) ? value : 'line'
}
// 本机脚本（gugu-stock-charts skill）用的旁路凭据：一份随机 token 与监听地址
// 都写在数据目录里，只有本机读得到；带对 token 的请求可以绕过 GUI fence
// 直接触发一次采样（v1.7 ③「Skill 生图前先采样」）。
const API_TOKEN_PATH = path.join(DATA_DIR, '.api-token')
const API_ENDPOINT_PATH = path.join(DATA_DIR, '.endpoint')
// ut（v1.19）：会话日志目录 + 每会话 token 数的增量缓存。
// 会话日志目录（ut 数据源）；测试可用 GUGU_SESSIONS_DIR 指到临时目录。
const SESSION_LOGS_DIR = process.env.GUGU_SESSIONS_DIR || path.join(DSH_HOME, 'sessions')
const TOKEN_CACHE_PATH = path.join(DATA_DIR, '.token-cache.json')
const SETTINGS_FILE = 'settings.json'

// 采样间隔：默认 15 分钟，用户可在设置页改 1..1440 分钟（1 分钟到 24 小时）。
const INTERVAL_DEFAULT_MINUTES = 15
const INTERVAL_MIN_MINUTES = 1
const INTERVAL_MAX_MINUTES = 1440
const RECENT_ENOUGH_MS = 5 * 60 * 1000
const MAX_DAYS = 60
const RANGE_LIMIT_DAYS = 366
// WB 积分的缩放百分比（v1.12 起是「缩放」板块里的一条，默认 3.25%）。
// 旧的 wbPercent 字段仍在 API 里，只是 mirrors scales.wb，老调用方不用改。
const WB_PERCENT_DEFAULT = 3.25
const WB_PERCENT_MIN = 0.1
const WB_PERCENT_MAX = 20
// 图表主题：明 / 暗 / 自动。auto 由客户端按 prefers-color-scheme 解析后再传具体值，
// Host 侧只做合法性校验，非法值一律退回 auto（= 亮色）。
const THEME_DEFAULT = 'auto'
const THEME_NAMES = ['light', 'dark', 'auto']
/**
 * Clamp the WB scale percent coming from the UI. Anything unparsable falls
 * back to the default so a typo can never collapse the WB line onto the axis.
 */
function clampTheme(value) {
  const text = String(value === undefined || value === null ? THEME_DEFAULT : value).trim().toLowerCase()
  return THEME_NAMES.indexOf(text) >= 0 ? text : THEME_DEFAULT
}

/** 采样间隔（分钟）：非数字/越界一律回落默认 15，取整，最小 1 分钟。 */
function normalizeIntervalMinutes(value) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return INTERVAL_DEFAULT_MINUTES
  return Math.round(Math.min(INTERVAL_MAX_MINUTES, Math.max(INTERVAL_MIN_MINUTES, n)))
}

function clampWbPercent(value) {
  const percent = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(percent) || percent <= 0) return WB_PERCENT_DEFAULT
  return Math.min(WB_PERCENT_MAX, Math.max(WB_PERCENT_MIN, percent))
}

// ---- 四条序列 -------------------------------------------------------------
// ds = DeepSeek 余额（元）、wb = WorkBuddy 积分、aliyun = 阿里云卡券余额（元）、
// ut = 本机所有 DSH 会话（含已归档）累计消耗的 token 总量（token 原值）。
// 默认 DS/WB/ut 开、阿里云关：阿里云要先在「数据源配置」里填账号，否则永远采不到数。
const SOURCE_NAMES = ['ds', 'wb', 'aliyun', 'ut']
// 面板/路由用长名（ds / wb / aliyun / ut），CSV 第二列写短名（ds / wb / al / ut）——
// 这里做唯一的一处映射，别处一律用 KIND_* 常量比较，避免长短名混用。
const SAMPLE_KINDS = { ds: KIND_DS, wb: KIND_WB, aliyun: KIND_ALIYUN, al: KIND_ALIYUN, ut: KIND_UT }
const SOURCES_DEFAULT = { ds: true, wb: true, aliyun: false, ut: true }
// 每条线各自的高度缩放：画图时 y = value * scale / 100。
// WB 积分和阿里云卡券的量级跟「元」差得远，靠百分比压进同一根纵轴。
// ut 的量级是「亿」，百分比要写成 0.000001% 才能看，所以它换了一种语义：
// scale.ut = 每 1 个纵轴单位对应多少 token（divisor，默认 10 万），
// 画图时 y = value / scale.ut。图表脚本里按 key 分支处理。
const SCALES_DEFAULT = { ds: 100, wb: WB_PERCENT_DEFAULT, aliyun: 12.5, ut: 12500000 }
const SCALE_STEP = 0.25
const SCALE_MIN = 0.05
const SCALE_MAX = 400
// ut 的 divisor：范围与步长都跟百分比不一样（面板上下调一次跳 1 万）。
const UT_DIVISOR_MIN = 1000
const UT_DIVISOR_MAX = 1000000000
const UT_DIVISOR_STEP = 100000
// ut 记录的是「这次比上次多了多少」，所以要记住上一次的累计总量（utBaseline）。
const UT_BASELINE_MAX = 1000000000000000
/**
 * null 表示「还没有基线」——第一次采样写 0，此后每次写差值。
 */
function normalizeUtBaseline (value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return Math.min(UT_BASELINE_MAX, Math.max(0, Math.round(number)))
}

function normalizeSources(value) {
  const out = Object.assign({}, SOURCES_DEFAULT)
  if (!value || typeof value !== 'object') return out
  for (const name of SOURCE_NAMES) {
    if (typeof value[name] === 'boolean') out[name] = value[name]
  }
  return out
}

/** 缩放值：非数字/<=0 退回该序列默认值，其余夹到各自区间。
 *  百分比序列（ds/wb/aliyun）夹到 [SCALE_MIN, SCALE_MAX] 保留两位小数；
 *  ut 是 divisor（每格多少 token），夹到 [UT_DIVISOR_MIN, UT_DIVISOR_MAX] 取整。 */
function clampScale(name, value) {
  const fallback = SCALES_DEFAULT[name] === undefined ? 100 : SCALES_DEFAULT[name]
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num <= 0) return fallback
  if (name === 'ut') {
    return Math.round(Math.min(UT_DIVISOR_MAX, Math.max(UT_DIVISOR_MIN, num)))
  }
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(num * 100) / 100))
}

/** 每条序列的缩放步长 / 上下限（面板按钮与 state 都按 key 取）。 */
function scaleStepOf(name) {
  return name === 'ut' ? UT_DIVISOR_STEP : SCALE_STEP
}

function scaleRangeOf(name) {
  return name === 'ut' ? { min: UT_DIVISOR_MIN, max: UT_DIVISOR_MAX } : { min: SCALE_MIN, max: SCALE_MAX }
}

function normalizeScales(value) {
  const out = Object.assign({}, SCALES_DEFAULT)
  if (!value || typeof value !== 'object') return out
  for (const name of SOURCE_NAMES) {
    if (value[name] !== undefined) out[name] = clampScale(name, value[name])
  }
  return out
}

// 折线颜色：change=按涨跌（涨红跌绿平灰，默认）/ source=按数据源（DS 蓝、WB 绿、阿里云橙红）。
const COLOR_MODES = ['change', 'source']
const COLOR_MODE_DEFAULT = 'change'
function normalizeColorMode(value) {
  if (typeof value === 'string') {
    const candidate = value.trim().toLowerCase()
    if (COLOR_MODES.includes(candidate)) return candidate
  }
  return COLOR_MODE_DEFAULT
}

/** 卡券编号 / 子账号不是密钥，但仍然只有用户自己填：默认留空、只做长度截断。 */
function sanitizeAliyunConfig(value) {
  const out = { couponId: '', subAccount: '' }
  if (!value || typeof value !== 'object') return out
  if (typeof value.couponId === 'string') out.couponId = value.couponId.trim().slice(0, 64)
  if (typeof value.subAccount === 'string') out.subAccount = value.subAccount.trim().slice(0, 160)
  return out
}

// ---- 阿里云卡券（BSS OpenAPI 2017-12-14 QueryCashCoupons）------------------
// RPC 风格 + HMAC-SHA1 签名，只读。AK 存 DSH 凭据库（~/.dsh/.credentials.yaml），
// 不进 settings.json、也不回显给前端。
const ALIYUN_ENDPOINT = 'business.aliyuncs.com'
const ALIYUN_API_VERSION = '2017-12-14'
const ALIYUN_TIMEOUT_MS = 8000
const CRED_ALIYUN_AK_ID = 'ALIYUN_ACCESS_KEY_ID'
const CRED_ALIYUN_AK_SECRET = 'ALIYUN_ACCESS_KEY_SECRET'

/** 阿里云要求 RFC3986：只有 A-Za-z0-9-_.~ 保持原样。 */
function rfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (ch) =>
    '%' + ch.charCodeAt(0).toString(16).toUpperCase(),
  )
}

function aliyunSignature(params, secret) {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => rfc3986(key) + '=' + rfc3986(params[key]))
    .join('&')
  const stringToSign = 'GET&' + rfc3986('/') + '&' + rfc3986(canonical)
  return createHmac('sha1', secret + '&').update(stringToSign, 'utf8').digest('base64')
}

function aliyunError(code, message, detail) {
  const error = new Error(message)
  error.code = code
  if (detail) error.detail = detail
  return error
}

/** 查一张代金券的剩余余额；任何一步不成就抛带 code 的 Error（消息直接给用户看）。 */
async function queryAliyunCoupon(options) {
  const accessKeyId = String(options.accessKeyId || '')
  const accessKeySecret = String(options.accessKeySecret || '')
  const couponId = String(options.couponId || '').trim()
  if (!accessKeyId || !accessKeySecret) {
    throw aliyunError('aliyun_credentials_missing', '还没有配置阿里云 AccessKey（ID / Secret 都要填）。')
  }
  if (!couponId) {
    throw aliyunError('aliyun_coupon_missing', '还没有填阿里云卡券编号。')
  }
  const params = {
    AccessKeyId: accessKeyId,
    Action: 'QueryCashCoupons',
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomBytes(12).toString('hex'),
    SignatureVersion: '1.0',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: ALIYUN_API_VERSION,
  }
  const signed = Object.assign({}, params, { Signature: aliyunSignature(params, accessKeySecret) })
  const query = Object.keys(signed)
    .sort()
    .map((key) => rfc3986(key) + '=' + rfc3986(signed[key]))
    .join('&')
  let payload
  try {
    const response = await fetch('https://' + ALIYUN_ENDPOINT + '/?' + query, {
      signal: AbortSignal.timeout(ALIYUN_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    const text = await response.text()
    try {
      payload = JSON.parse(text)
    } catch {
      throw aliyunError('aliyun_bad_payload', '阿里云返回了非 JSON 内容：' + text.slice(0, 200))
    }
  } catch (err) {
    if (err && err.code) throw err
    throw aliyunError('aliyun_network', '连不上阿里云 BSS API：' + messageOf(err))
  }
  // BSS OpenAPI 的成功响应也带 Code（"Success" 或 "200"）与 Message:"Successful!"，
  // 所以只有 Success 不为 true 且 Code 不是成功码时才算失败——否则成功会被读成错误。
  const code = payload && payload.Code !== undefined && payload.Code !== null ? String(payload.Code) : ''
  const succeeded = !payload || payload.Success === true || code === '' || code === 'Success' || code === '200'
  if (!succeeded) {
    throw aliyunError(
      'aliyun_api_error',
      code === 'NotAuthorized'
        ? '子账号没有 BSS 只读权限，请在 RAM 控制台给它授权 AliyunBSSReadOnlyAccess。'
        : String(payload.Message || code),
      { Code: code, RequestId: payload.RequestId },
    )
  }
  const data = payload && payload.Data && Array.isArray(payload.Data.CashCoupon) ? payload.Data.CashCoupon : []
  const hit = data.find(
    (item) => String(item.CashCouponId) === couponId || String(item.CashCouponNo) === couponId,
  )
  if (!hit) {
    throw aliyunError(
      'aliyun_coupon_not_found',
      '这张代金券不在可查列表里（编号 ' + couponId + '，共 ' + String(data.length) + ' 张可查）。',
    )
  }
  const balance = Number(hit.Balance)
  if (!Number.isFinite(balance)) {
    throw aliyunError('aliyun_bad_payload', '阿里云返回的余额不是数字：' + String(hit.Balance))
  }
  return {
    balance,
    couponId: String(hit.CashCouponId || couponId),
    couponNo: String(hit.CashCouponNo || ''),
    status: String(hit.Status || ''),
    expiry: String(hit.ExpiryTime || ''),
    nominalValue: String(hit.NominalValue || ''),
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ROUTE_PATH = '/gugu-stock/api'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const WB_CREDITS_PATH = '/plugins/dsh-connect-workbuddy/account-credits'
const API_TIMEOUT_MS = 8000
const ACCOUNT_TIMEOUT_MS = 5000
const PYTHON_TIMEOUT_MS = 120000

export const inject = ['webServer', 'connection']

function isoDateDaysAgo(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return String(date.getFullYear()) + '-' + month + '-' + day
}

async function readJsonBody(req, limit = 8192) {
  // 测试替身或极端情况下 req 不是可迭代流，按「空 body」处理即可
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') return {}
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

const messageOf = (err) => {
  if (err === null || err === undefined) return 'unknown error'
  if (typeof err === 'string') return err
  if (typeof err.message === 'string' && err.message !== '') return err.message
  return String(err)
}

const CURRENCY_OF = (wallet) => String((wallet && wallet.currency) || 'CNY').toUpperCase()
const numeric = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Pick one currency (CNY first among non-zero wallets) and sum that currency. */
function sumWallets(wallets) {
  const usable = wallets.filter((wallet) => wallet && numeric(wallet.balance) !== null)
  if (usable.length === 0) return null
  const nonzero = usable.filter((wallet) => Number(wallet.balance) > 0)
  const picked =
    nonzero.find((wallet) => CURRENCY_OF(wallet) === 'CNY') ||
    nonzero[0] ||
    usable.find((wallet) => CURRENCY_OF(wallet) === 'CNY') ||
    usable[0]
  const currency = CURRENCY_OF(picked)
  const total = usable
    .filter((wallet) => CURRENCY_OF(wallet) === currency)
    .reduce((sum, wallet) => sum + Number(wallet.balance), 0)
  return { currency, balance: Number(total.toFixed(6)), wallets: usable.length }
}

async function fetchApiKeyBalance(ctx) {
  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
  if (!credentials || typeof credentials.resolve !== 'function') return null
  let cred
  try {
    cred = await credentials.resolve('DEEPSEEK_API_KEY')
  } catch (err) {
    return { error: '读取 DEEPSEEK_API_KEY 失败：' + messageOf(err) }
  }
  if (!cred || !cred.value) return null
  let response
  try {
    response = await fetch(BALANCE_URL, {
      headers: { authorization: 'Bearer ' + cred.value, accept: 'application/json' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
  } catch (err) {
    return { error: '余额接口请求失败：' + messageOf(err) }
  }
  if (!response.ok) return { error: '余额接口 HTTP ' + response.status }
  let data
  try {
    data = await response.json()
  } catch (err) {
    return { error: '余额接口返回不是 JSON：' + messageOf(err) }
  }
  const infos = Array.isArray(data && data.balance_infos) ? data.balance_infos : []
  const usable = infos.filter((info) => info && numeric(info.total_balance) !== null)
  if (usable.length === 0) return { error: '余额响应里没有 total_balance' }
  const picked =
    usable.find((info) => String(info.currency || '').toUpperCase() === 'CNY') || usable[0]
  return {
    balance: Number(Number(picked.total_balance).toFixed(6)),
    currency: String(picked.currency || 'CNY').toUpperCase(),
    source: 'api-key',
  }
}

async function fetchAccountBalance(ctx) {
  const account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : undefined
  if (!account || typeof account.getBalance !== 'function') {
    return { error: '账号服务不可用（没有 deepseekAccount）' }
  }
  const request = account.getBalance({
    version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
    locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  })
  let result
  try {
    result = await Promise.race([
      request,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('账号余额请求超时')), ACCOUNT_TIMEOUT_MS),
      ),
    ])
  } catch (err) {
    return { error: '账号余额请求失败：' + messageOf(err) }
  }
  if (!result) return { error: '未登录 DeepSeek 账号' }
  if (result.status !== 'ready') return { error: '账号余额未就绪（' + String(result.status || 'unknown') + '）' }
  const normal = Array.isArray(result.value) ? result.value : []
  const bonus = Array.isArray(result.bonusWallets) ? result.bonusWallets : []
  const summed = sumWallets(normal.concat(bonus))
  if (!summed) return { error: '账号没有可用的余额钱包' }
  return { balance: summed.balance, currency: summed.currency, source: 'account' }
}

/** Total balance: API key first, then the signed-in account wallets. */
async function readBalance(ctx) {
  const apiKey = await fetchApiKeyBalance(ctx)
  if (apiKey && numeric(apiKey.balance) !== null) return apiKey
  const account = await fetchAccountBalance(ctx)
  if (account && numeric(account.balance) !== null) return account
  const parts = []
  if (apiKey && apiKey.error) parts.push('API key 路：' + apiKey.error)
  else if (!apiKey) parts.push('API key 路：没有配置 DEEPSEEK_API_KEY')
  if (account && account.error) parts.push('账号登录路：' + account.error)
  const err = new Error(
    '读取不到余额。' + (parts.length > 0 ? parts.join('；') : '既没有 API key，也没有登录账号'),
  )
  err.code = 'balance_unavailable'
  throw err
}

/**
 * WorkBuddy CN credit total, read from the local dsh-connect-workbuddy plugin's
 * loopback route (http://127.0.0.1:<port>/plugins/dsh-connect-workbuddy/account-credits).
 * The request carries no Origin header on purpose: the workbuddy fence lets
 * plugin-internal fetches through when the Host header is a trusted listener.
 *
 * 多个 WB 账号时取**全部可读账号之和**（用户 m09409）：以前只取 selected/第一个，
 * 有多个号就会少算。无法读出积分的账号跳过并计数，但至少有一个可读才算成功。
 * Returns `{ value, account, accounts }` or throws with err.code 'wb_unavailable'.
 */
async function readWbCredits(ctx) {
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (!webServer || typeof webServer.getOrigin !== 'function') {
    const err = new Error('webServer 服务不可用')
    err.code = 'wb_unavailable'
    throw err
  }
  let origin
  try {
    origin = webServer.getOrigin()
  } catch (err) {
    const wrapped = new Error('webServer 未就绪：' + messageOf(err))
    wrapped.code = 'wb_unavailable'
    throw wrapped
  }
  const url = String(origin).replace(/\/+$/, '') + WB_CREDITS_PATH
  let response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
  } catch (err) {
    const wrapped = new Error('WorkBuddy 接口请求失败：' + messageOf(err))
    wrapped.code = 'wb_unavailable'
    throw wrapped
  }
  if (!response.ok) {
    const wrapped = new Error('WorkBuddy 接口 HTTP ' + response.status)
    wrapped.code = 'wb_unavailable'
    throw wrapped
  }
  let data
  try {
    data = await response.json()
  } catch (err) {
    const wrapped = new Error('WorkBuddy 接口返回不是 JSON：' + messageOf(err))
    wrapped.code = 'wb_unavailable'
    throw wrapped
  }
  const accounts = Array.isArray(data && data.accounts) ? data.accounts : Array.isArray(data) ? data : []
  // credits 有两种形状，都要认：数字（本机 workbuddy 5.30 的 account-credits 路由）
  // 或 { total, packages, ... }（插件内部 toCredits() 的形状）。
  const creditTotal = (account) => {
    if (!account) return null
    const credits = account.credits
    // numeric(null) === 0，所以这里必须先挡掉空值，否则「没有积分字段的账号」
    // 会被当成 0 分混进加总与账号清单里。
    if (credits === null || credits === undefined || credits === '') return null
    if (numeric(credits) !== null) return Number(credits)
    if (credits && typeof credits === 'object' && numeric(credits.total) !== null) return Number(credits.total)
    return null
  }
  const readable = []
  for (const account of accounts) {
    const value = creditTotal(account)
    if (value === null) continue
    readable.push({
      name: String(account.accountName || account.id || '未命名'),
      value: Number(Number(value).toFixed(6)),
      selected: account.selected === true,
    })
  }
  if (readable.length === 0) {
    const err = new Error('WorkBuddy 响应里没有可读的积分账户')
    err.code = 'wb_unavailable'
    throw err
  }
  // 加总：N 个号就是 N 个数相加（旧行为只取 selected，多号会漏）。
  const total = readable.reduce((sum, item) => sum + item.value, 0)
  return {
    value: Number(total.toFixed(6)),
    account: readable.map((item) => item.name).join(' + '),
    accounts: readable,
    source: 'wb',
  }
}

/**
 * 「保存到桌面」用的目标目录。Windows 上桌面可能被 OneDrive 接管，所以按顺序
 * 试几个候选，取第一个真实存在的；都不在就退回 home 下的 Desktop。
 */
async function desktopDir() {
  const home = os.homedir()
  const candidates = [
    process.env.GUGU_DESKTOP_DIR,
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'OneDrive - 个人', 'Desktop'),
    path.join(home, '桌面'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isDirectory()) return candidate
    } catch {
      /* try next */
    }
  }
  return path.join(home, 'Desktop')
}

const pad2 = (value) => String(value).padStart(2, '0')

/** 2026-11-22 01:36:07 -> 20261122013607 */
function stampForFile(date) {
  return (
    String(date.getFullYear()) +
    pad2(date.getMonth() + 1) +
    pad2(date.getDate()) +
    pad2(date.getHours()) +
    pad2(date.getMinutes()) +
    pad2(date.getSeconds())
  )
}

async function uniquePath(dir, baseName) {
  const ext = path.extname(baseName)
  const stem = baseName.slice(0, baseName.length - ext.length)
  let target = path.join(dir, baseName)
  for (let index = 2; index < 100; index += 1) {
    try {
      await fs.access(target)
      target = path.join(dir, stem + '-' + index + ext)
    } catch {
      return target
    }
  }
  return target
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  if (typeof res.setHeader === 'function') {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
  } else {
    res.statusCode = status
  }
  res.end(body)
}

const fail = (code, message, extra) => ({ ok: false, error: { code, message, ...(extra || {}) } })

async function ensureCsvFile() {
  try {
    await fs.access(CSV_PATH)
    return
  } catch {
    /* fall through: create it (and migrate the legacy file if there is one) */
  }
  let rows = []
  try {
    rows = await readCsvFile(LEGACY_CSV_PATH)
  } catch {
    rows = []
  }
  await writeCsvFile(CSV_PATH, rows)
}

/** Windows: `cmd /d /c start "" <path>`; fall back to the ShellExecute handler. */
function openerCommands(target) {
  if (process.platform === 'win32') {
    return [
      { command: 'cmd.exe', args: ['/d', '/c', 'start', '', target] },
      { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', target] },
    ]
  }
  if (process.platform === 'darwin') return [{ command: 'open', args: [target] }]
  return [{ command: 'xdg-open', args: [target] }]
}

function launchDetached(command, args) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    } catch (err) {
      reject(err)
      return
    }
    const timer = setTimeout(() => {
      child.removeListener('error', onError)
      child.unref()
      resolve()
    }, 10000)
    function onError(err) {
      clearTimeout(timer)
      child.removeListener('spawn', onSpawn)
      reject(err)
    }
    function onSpawn() {
      clearTimeout(timer)
      child.removeListener('error', onError)
      child.unref()
      resolve()
    }
    child.once('error', onError)
    child.once('spawn', onSpawn)
  })
}

async function openCsvFile() {
  await ensureCsvFile()
  const commands = openerCommands(CSV_PATH)
  const attempted = []
  for (const command of commands) {
    if (process.env.GUGU_OPEN_DRY === '1') {
      return { ok: true, dry: true, path: CSV_PATH, command: command.command, args: command.args }
    }
    try {
      await launchDetached(command.command, command.args)
      return { ok: true, path: CSV_PATH, command: command.command }
    } catch (err) {
      attempted.push(command.command + ': ' + messageOf(err))
    }
  }
  return fail('open_failed', '打开 CSV 失败：' + attempted.join('；'), { path: CSV_PATH })
}

function pythonCandidates() {
  const explicit = process.env.GUGU_PYTHON
  if (explicit && explicit.trim() !== '') {
    return [{ command: explicit.trim(), args: [], label: explicit.trim() }]
  }
  if (process.platform === 'win32') {
    return [
      { command: 'py', args: ['-3.12'], label: 'py -3.12' },
      { command: 'python', args: [], label: 'python' },
      { command: 'py', args: ['-3'], label: 'py -3' },
    ]
  }
  return [
    { command: 'python3', args: [], label: 'python3' },
    { command: 'python', args: [], label: 'python' },
  ]
}

function runPython(candidate, extraArgs) {
  return new Promise((resolve) => {
    const args = candidate.args.concat(extraArgs)
    let settled = false
    let timer = null
    let stdout = ''
    let stderr = ''
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    let child
    try {
      child = spawn(candidate.command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      finish({ ok: false, code: err && err.code === 'ENOENT' ? 'enoent' : 'spawn_failed', stderr: messageOf(err) })
      return
    }
    timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish({ ok: false, code: 'timeout', stderr: 'Python 执行超时（120s）' })
    }, PYTHON_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (err) => {
      finish({ ok: false, code: err && err.code === 'ENOENT' ? 'enoent' : 'spawn_failed', stderr: messageOf(err) })
    })
    child.once('close', (code) => {
      finish({ ok: code === 0, code: code === 0 ? 'ok' : 'exit_' + code, exitCode: code, stdout, stderr })
    })
  })
}

function parseScriptMeta(stdout) {
  const line = String(stdout)
    .split(/\r?\n/)
    .reverse()
    .find((row) => row.startsWith('GUGU_RESULT '))
  if (!line) return null
  try {
    return JSON.parse(line.slice('GUGU_RESULT '.length))
  } catch {
    return null
  }
}

/**
 * Real work of "生成谷谷股图": run scripts/gugu_chart.py, self-heal a missing
 * matplotlib once, then hand the PNG back as a data URL.
 */
async function generateChart(options = {}) {
  const rows = await readCsvFile(CSV_PATH)
  if (rows.length === 0) {
    return fail('empty_csv', 'CSV 还没有数据，先点一次「立即采样」。')
  }

  const kind = chartKindOf(options.kind)
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

  // generateChart 是模块级函数，拿不到 apply 里的 state：默认值交给 clampScale，
  // 调用方（路由 / 工具）负责把「上次用的值」显式传进来。
  const wbPercent = clampScale('wb', options.wbPercent)
  const theme = clampTheme(options.theme)
  const colorMode = normalizeColorMode(options.colorMode)
  // 画哪几条由开关决定。不传 sources 时沿用旧行为：DS 一定画，WB 看数据里有没有。
  const sources = normalizeSources(
    options.sources === undefined
      ? {
          ds: true,
          wb: rows.some((row) => row.kind === KIND_WB),
          aliyun: false,
          ut: rows.some((row) => row.kind === KIND_UT),
        }
      : options.sources,
  )
  const scales = normalizeScales(
    options.scales === undefined ? { wb: wbPercent } : Object.assign({ wb: wbPercent }, options.scales),
  )
  if (!sources.ds && !sources.wb && !sources.aliyun && !sources.ut) {
    return fail('no_source', '四个数据源都关掉了，先去「数据源配置」里打开至少一个。')
  }
  const chartPath = CHART_KINDS[kind].path
  const hasWb = sources.wb && rows.some((row) => row.kind === KIND_WB)
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
  if (hasWb) scriptArgs.push('--with-wb', '1')
  scriptArgs.push('--wb-percent', String(wbPercent))
  // v1.12 的正式参数：哪几条线 + 各自缩放。--with-wb/--wb-percent 只留作兼容。
  scriptArgs.push('--sources', SOURCE_NAMES.filter((name) => sources[name]).join(','))
  scriptArgs.push('--scale-ds', String(scales.ds))
  scriptArgs.push('--scale-wb', String(scales.wb))
  scriptArgs.push('--scale-aliyun', String(scales.aliyun))
  // ut 的 scale 是 divisor（每格多少 token），与上面三个百分比语义不同。
  scriptArgs.push('--scale-ut', String(scales.ut))
  scriptArgs.push('--theme', theme)
  scriptArgs.push('--color-mode', colorMode)
  if (from) scriptArgs.push('--from', from)
  if (to) scriptArgs.push('--to', to)
  const failures = []
  for (const candidate of pythonCandidates()) {
    let attempt = await runPython(candidate, scriptArgs)
    if (!attempt.ok && attempt.code === 'enoent') {
      failures.push(candidate.label + '：找不到该解释器')
      continue
    }
    if (!attempt.ok && /ModuleNotFoundError: No module named 'matplotlib'/.test(attempt.stderr || '')) {
      const install = await runPython(candidate, ['-m', 'pip', 'install', '--user', 'matplotlib'])
      if (!install.ok) {
        return fail(
          'matplotlib_missing',
          '缺少 matplotlib 且自动安装失败，请手动执行：' +
            candidate.label +
            ' -m pip install --user matplotlib',
          { detail: String(install.stderr || '').slice(0, 2000) },
        )
      }
      attempt = await runPython(candidate, scriptArgs)
    }
    if (!attempt.ok) {
      if (attempt.code === 'exit_2') {
        return fail('no_data', 'CSV 里没有可画的数据（需要至少一行有效记录）。')
      }
      if (attempt.code === 'exit_3') {
        return fail(
          'matplotlib_missing',
          'Python 缺少 matplotlib，请安装：' + candidate.label + ' -m pip install --user matplotlib',
          { detail: String(attempt.stderr || '').slice(0, 2000) },
        )
      }
      return fail('chart_failed', '出图失败：' + String(attempt.stderr || attempt.code).slice(0, 800), {
        python: candidate.label,
        detail: String(attempt.stderr || '').slice(0, 4000),
      })
    }
    const meta = parseScriptMeta(attempt.stdout || '')
    let dataUrl
    try {
      const png = await fs.readFile(chartPath)
      dataUrl = 'data:image/png;base64,' + png.toString('base64')
    } catch (err) {
      return fail('chart_missing', '脚本退出成功但没找到 PNG：' + messageOf(err))
    }
    return {
      ok: true,
      kind,
      from,
      to,
      withWb: hasWb,
      wbPercent,
      sources,
      scales,
      theme,
      colorMode,
      dataUrl,
      chartPath,
      python: candidate.label,
      generatedAt: new Date().toISOString(),
      meta: meta || null,
    }
  }
  return fail(
    'python_missing',
    '找不到 Python。请安装 Python 3，或设置环境变量 GUGU_PYTHON 指向 python.exe 后重启 DSH。',
    { tried: failures },
  )
}


/**
 * 把刚生成的那张图复制到桌面，文件名带本地时间戳：
 *   谷谷股_折线图_20261122013607.png / 谷谷股_柱状图_20261122013607.png
 * 只复制磁盘上现成的那张，不重新跑 Python，所以和面板里看到的一模一样。
 */
async function saveChartToDesktop(kind) {
  const chartKind = chartKindOf(kind)
  const source = CHART_KINDS[chartKind].path
  try {
    await fs.access(source)
  } catch {
    return fail('chart_missing', '还没有生成过这张图，先点「生成」再来保存。')
  }
  const dir = await desktopDir()
  const name = '谷谷股_' + CHART_KINDS[chartKind].file + '_' + stampForFile(new Date()) + '.png'
  try {
    await fs.mkdir(dir, { recursive: true })
    const target = await uniquePath(dir, name)
    await fs.copyFile(source, target)
    return { ok: true, savedPath: target, fileName: path.basename(target), kind: chartKind }
  } catch (err) {
    const error = new Error('保存到桌面失败：' + messageOf(err))
    error.code = 'save_failed'
    throw error
  }
}


/* ------------------------------------------------------------------ *
 * DSH Go 工具卡（经 DSH Remote 中转时唯一能看到插件的通道）
 * ------------------------------------------------------------------ */

const DSH_GO_VIEW_KEY = 'dsh-go/view'
const VIEW_BUDGET_BYTES = 8 * 1024
const TOOL_NAME = 'gugu_stock'

const round1Text = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? (Math.round(number * 10) / 10).toFixed(1) : '—'
}

/** token 数太大，卡片上按「亿 / 万」压缩一下；CSV 里永远存原值。 */
const tokenText = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  if (number >= 1e8) return (number / 1e8).toFixed(2) + ' 亿'
  if (number >= 1e4) return (number / 1e4).toFixed(1) + ' 万'
  return String(Math.round(number))
}

const mmdd = (date) => String(date || '').slice(5)

/**
 * Rows of one series in ascending time order. The CSV is append-only but Excel
 * rewrites can shuffle it, so never trust the on-disk order: sort here.
 */
function seriesRows(rows, kind) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.kind === kind)
    .slice()
    .sort((a, b) => (a.time === b.time ? 0 : a.time < b.time ? -1 : 1))
}

/** 每日最终余额：升序遍历，同一天后面的值覆盖前面的，取到的就是当天最后一笔。 */
function dailyFinals(rows, limit, kind = KIND_DS) {
  const seen = new Map()
  for (const row of seriesRows(rows, kind)) {
    const date = String(row.time || '').slice(0, 10)
    if (!date) continue
    seen.set(date, Number(row.value))
  }
  const days = [...seen.entries()].map(([date, balance]) => ({ date, balance }))
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return days.slice(-limit)
}

/** rows 先按时间升序，累计每天余额的下降幅度即为当天花费。 */
function spendByDay(rows, limit, kind = KIND_DS) {
  const ordered = seriesRows(rows, kind)
  const spent = new Map()
  let previous = null
  for (const row of ordered) {
    const date = String(row.time || '').slice(0, 10)
    const balance = Number(row.value)
    if (!date || !Number.isFinite(balance)) continue
    if (!spent.has(date)) spent.set(date, 0)
    if (previous !== null && previous > balance) spent.set(date, spent.get(date) + (previous - balance))
    previous = balance
  }
  const days = [...spent.entries()].map(([date, value]) => ({ date, balance: Number(value.toFixed(6)) }))
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return days.slice(-limit)
}

function buildGoView(value) {
  const daily = Array.isArray(value.daily) ? value.daily : []
  const children = [
    {
      type: 'row',
      children: [
        { type: 'metric', label: 'DS 余额', value: round1Text(value.latestBalance) + ' 元' },
        { type: 'metric', label: 'WB 积分', value: round1Text(value.latestWb) },
        { type: 'metric', label: 'Tokens 累计', value: tokenText(value.latestUt) },
        { type: 'metric', label: '记录', value: String(value.rows || 0) + ' 条' },
        { type: 'metric', label: '天数', value: String(value.days || 0) + ' 天' },
      ],
    },
  ]
  if (daily.length >= 2) {
    const spend = value.kind === 'spend'
    children.push({
      type: 'chart',
      kind: spend ? 'bar' : 'line',
      categories: daily.map((day) => mmdd(day.date)),
      series: [
        {
          name: spend ? '每日花费' : '每日最终余额',
          values: daily.map((day) => day.balance),
        },
      ],
      unit: '元',
      caption: spend
        ? '横轴为日期（月-日），每根柱子是当天余额下降的总额'
        : '横轴为日期（月-日），每点为当日最终余额',
    })
  }
  children.push({
    type: 'keyValue',
    items: [
      ['最近采样', String(value.latestTime || '—')],
      ['数据文件', String(value.csvPath || '')],
    ],
  })
  for (const item of Array.isArray(value.charts) ? value.charts : []) {
    children.push({
      type: 'text',
      text:
        CHART_KINDS[chartKindOf(item.kind)].label + '：' +
        String(item.generatedAt || '').replace('T', ' ').slice(0, 16) +
        '，' +
        String(item.points || 0) +
        ' 个节点 · ' +
        String(item.chartPath || ''),
    })
  }
  if (value.chart && value.chart.generatedAt) {
    children.push({
      type: 'text',
      text: '图已生成：' + value.chart.generatedAt.replace('T', ' ').slice(0, 16) + '，' + String(value.chart.points || 0) + ' 个节点',
      tone: 'muted',
    })
  }
  if (value.error && value.error.message) {
    children.push({ type: 'callout', tone: 'warn', text: String(value.error.message).slice(0, 300) })
  }
  children.push({ type: 'text', text: '完整折线图在电脑端 设置 → 谷谷股', tone: 'muted' })
  return { type: 'stack', title: '谷谷股 · ' + round1Text(value.latestBalance) + ' 元', children }
}

/** presentationMeta 抛错或超限会让整次工具调用失败，这里一律兜住。 */
function goToolCard(value) {
  try {
    const text = JSON.stringify(buildGoView(value))
    if (text === undefined || Buffer.byteLength(text, 'utf8') > VIEW_BUDGET_BYTES) return {}
    return { [DSH_GO_VIEW_KEY]: JSON.parse(text) }
  } catch {
    return {}
  }
}

function toolText(value) {
  const lines = []
  if (value.action === 'sample') {
    lines.push(value.sampled ? '已采样：' + value.sampled.time + ' → ' + round1Text(value.sampled.balance) + ' 元' : '采样没成功。')
  }
  lines.push('谷谷股 · DS 余额 ' + round1Text(value.latestBalance) + ' 元（' + String(value.latestTime || '还没有记录') + '）')
  if (value.latestWb !== undefined && value.latestWb !== null) {
    lines.push('谷谷股 · WB 积分 ' + round1Text(value.latestWb) + '（' + String(value.latestWbTime || '还没有记录') + '）')
  }
  if (value.latestAliyun !== undefined && value.latestAliyun !== null) {
    lines.push('谷谷股 · 阿里云卡券 ' + round1Text(value.latestAliyun) + ' 元（' + String(value.latestAliyunTime || '还没有记录') + '）')
  }
  if (value.latestUt !== undefined && value.latestUt !== null) {
    lines.push('谷谷股 · Tokens 累计 ' + tokenText(value.latestUt) + '（' + String(value.latestUtTime || '还没有记录') + '）')
  }
  lines.push('记录 ' + String(value.rows || 0) + ' 条，覆盖 ' + String(value.days || 0) + ' 天')
  const daily = Array.isArray(value.daily) ? value.daily : []
  if (daily.length > 0) {
    lines.push(
      (value.kind === 'spend' ? '最近几天的每日花费：' : '最近几天的日终余额：') +
        daily.slice(-7).map((day) => mmdd(day.date) + ' ' + round1Text(day.balance)).join('、'),
    )
  }
  for (const item of Array.isArray(value.charts) ? value.charts : []) {
    lines.push(
      CHART_KINDS[chartKindOf(item.kind)].label + '已生成：' +
        String(item.generatedAt || '') +
        '（' + String(item.points || 0) + ' 个节点，' + String(item.days || 0) + ' 天）',
    )
    if (item.chartPath) lines.push('PNG：' + item.chartPath)
  }
  if (value.chart && value.chart.generatedAt) {
    lines.push((value.kind === 'spend' ? '花费柱状图已生成：' : '余额折线图已生成：') + value.chart.generatedAt + '（' + String(value.chart.points || 0) + ' 个节点，' + String(value.chart.days || 0) + ' 天）')
    if (value.chart.chartPath) lines.push('PNG：' + value.chart.chartPath)
  }
  lines.push('CSV：' + String(value.csvPath || ''))
  if (value.error && value.error.message) lines.push('失败：' + value.error.message)
  return lines.join('\n')
}

const GUGU_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['status', 'sample', 'chart'],
      description: 'status=只看当前余额和记录（默认）；sample=立刻采样一次并写入 CSV；chart=用 Python 出图',
    },
    kind: {
      type: 'string',
      enum: ['line', 'spend', 'total', 'both'],
      description:
        'chart 时画哪种图：line=余额折线图（默认）；spend=花费柱状图；total=消耗累计图；both=三张一起出（没有 shell 的 Agent 走「一次调用拿三张图」）',
    },
    from: { type: 'string', description: 'chart 的起始日期 YYYY-MM-DD（默认最近 60 天）' },
    to: { type: 'string', description: 'chart 的结束日期 YYYY-MM-DD（默认今天）' },
  },
  additionalProperties: false,
}

const GUGU_TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    kind: { type: 'string' },
    csvPath: { type: 'string' },
    rows: { type: 'integer' },
    days: { type: 'integer' },
    latestBalance: { type: 'number' },
    latestTime: { type: 'string' },
    latestWb: { type: 'number' },
    latestWbTime: { type: 'string' },
    latestAliyun: { type: 'number' },
    latestAliyunTime: { type: 'string' },
    latestUt: { type: 'number' },
    latestUtTime: { type: 'string' },
    daily: {
      type: 'array',
      items: {
        type: 'object',
        properties: { date: { type: 'string' }, balance: { type: 'number' } },
      },
    },
    sampled: { type: 'object', properties: { time: { type: 'string' }, kind: { type: 'string' }, balance: { type: 'number' } } },
    sampledWb: { type: 'number' },
    chart: {
      type: 'object',
      properties: {
        generatedAt: { type: 'string' },
        chartPath: { type: 'string' },
        days: { type: 'integer' },
        points: { type: 'integer' },
          theme: { type: 'string' },
          colorMode: { type: 'string' },
          sources: {
            type: 'object',
            properties: {
              ds: { type: 'boolean' }, wb: { type: 'boolean' },
              aliyun: { type: 'boolean' }, ut: { type: 'boolean' },
            },
          },
          scales: {
            type: 'object',
            properties: {
              ds: { type: 'number' }, wb: { type: 'number' },
              aliyun: { type: 'number' }, ut: { type: 'number' },
            },
          },
      },
    },
    charts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          generatedAt: { type: 'string' },
          chartPath: { type: 'string' },
          days: { type: 'integer' },
          points: { type: 'integer' },
            theme: { type: 'string' },
            colorMode: { type: 'string' },
            sources: {
              type: 'object',
              properties: {
                ds: { type: 'boolean' }, wb: { type: 'boolean' },
                aliyun: { type: 'boolean' }, ut: { type: 'boolean' },
              },
            },
            scales: {
              type: 'object',
              properties: {
                ds: { type: 'number' }, wb: { type: 'number' },
                aliyun: { type: 'number' }, ut: { type: 'number' },
              },
            },
        },
      },
    },
    error: {
      type: 'object',
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
}

/**
 * 当天到目前为止消耗了多少 tokens（面板「日Tokens 消耗」卡片）。
 *
 * CSV 里 ut 行从 v1.21 起存的是**两次采样之间的增量**，所以当天消耗 = 今天所有
 * ut 行相加，总量 = 全表相加。
 */
function utRowsSorted (rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.kind === KIND_UT)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
}

function todayTokenSpend (rows) {
  const utRows = utRowsSorted(rows)
  if (!utRows.length) return null
  const today = String(utRows[utRows.length - 1].time).slice(0, 10)
  let sum = 0
  for (const row of utRows) {
    if (String(row.time).slice(0, 10) === today) sum += Number(row.value) || 0
  }
  return Math.max(0, Math.round(sum))
}


function makeToolDefinition(deps) {
  return {
    name: TOOL_NAME,
    description:
      '谷谷股：查看充值余额记录（默认）、立刻采样一次（action=sample）、或生成余额折线图 / 花费柱状图 / 消耗累计图（action=chart，kind 可为 line/spend/total/both）。出图走本机 Python，图的样子完全跟随设置面板（主题、颜色来源、数据源开关、缩放），不需要任何 shell 命令——没有 bash 工具的 Agent 也能用：调用后把返回的 chartPath 用 present / dsh_im_return_file 发出去即可。在 DSH Go 里会渲染成原生卡片。',
    parameters: GUGU_TOOL_PARAMETERS,
    output: {
      schema: GUGU_TOOL_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: toolText(value) }],
      presentationMeta: (_args, value) => goToolCard(value),
    },
    async execute(args) {
      const action = String((args && args.action) || 'status')
      // 只放真实存在的字段：schema 里没有 nullable，null 会被输出校验判为不合法。
      const value = {
        ok: true,
        action,
        csvPath: deps.csvPath(),
        rows: 0,
        days: 0,
        daily: [],
      }
      try {
        if (action === 'sample') {
          // 采两个序列（DS 余额 + WB 积分）；任一侧失败都如实报告，不掩盖另一半
          const sampled = deps.runSampleBoth ? await deps.runSampleBoth('tool') : await deps.runSample('tool')
          const ds = sampled && sampled.ds ? sampled.ds : sampled
          const wb = sampled && sampled.wb ? sampled.wb : null
          if (ds && ds.ok && ds.record) {
            value.sampled = { time: ds.record.time, kind: ds.record.kind, balance: ds.record.value }
          }
          if (wb && wb.ok && wb.record) value.sampledWb = wb.record.value
          const errors = [ds, wb].filter((sample) => sample && !sample.ok).map((sample) => sample.error)
          if (errors.length > 0) {
            value.error = {
              code: errors[0] && errors[0].code ? errors[0].code : 'sample_failed',
              message: errors.map((error) => (error && error.message) || '采样失败').join('；'),
            }
          }
        }
        if (action === 'chart') {
          if (typeof deps.autoTidy === 'function') await deps.autoTidy()
          const wanted = args && args.kind === 'both' ? 'both' : chartKindOf(args && args.kind)
          const kinds = wanted === 'both' ? ['line', 'spend', 'total'] : [wanted]
          value.kind = wanted
          const made = []
          for (const kind of kinds) {
            const chart = await deps.generateChart({ kind, from: args && args.from, to: args && args.to })
            if (chart && chart.ok) {
              const item = { kind, generatedAt: chart.generatedAt, chartPath: chart.chartPath }
              if (chart.meta && typeof chart.meta.days === 'number') item.days = chart.meta.days
              if (chart.meta && typeof chart.meta.points === 'number') item.points = chart.meta.points
              // 回显本次出图实际用的设置：Agent 能确认图和面板一致；也是一条
              // 回归断言（工具路径以前不传设置，出的是白图/默认缩放/无阿里云）。
              if (chart.theme) item.theme = chart.theme
              if (chart.colorMode) item.colorMode = chart.colorMode
              if (chart.sources) item.sources = chart.sources
              if (chart.scales) item.scales = chart.scales
              made.push(item)
            } else if (!value.error) {
              value.error = (chart && chart.error) || { code: 'chart_failed', message: '出图失败' }
            }
          }
          if (made.length === 1) value.chart = made[0]
          else if (made.length > 1) value.charts = made
        }
        const rows = await deps.readRows()
        const summary = summarize(rows)
        value.rows = summary.count
        value.days = summary.days
        if (summary.latestDs) value.latestBalance = summary.latestDs.value
        if (summary.latestDs) value.latestTime = summary.latestDs.time
        if (summary.latestWb) {
          value.latestWb = summary.latestWb.value
          value.latestWbTime = summary.latestWb.time
        }
        if (summary.latestAliyun) {
          value.latestAliyun = summary.latestAliyun.value
          value.latestAliyunTime = summary.latestAliyun.time
        }
        if (summary.latestUt) {
          value.latestUt = summary.latestUt.value
          value.latestUtTime = summary.latestUt.time
        }
        value.daily = value.kind === 'spend' ? spendByDay(rows, MAX_DAYS) : dailyFinals(rows, MAX_DAYS)
      } catch (err) {
        value.ok = false
        value.error = { code: 'tool_failed', message: messageOf(err) }
      }
      return value
    },
  }
}

export function apply(ctx, _config) {
  // 用户设置（WB 缩放百分比、图表主题）持久化到 settings.json，插件重启后恢复（v1.7 ⑨）。
  const SETTINGS_PATH = path.join(DATA_DIR, SETTINGS_FILE)
  // 采样间隔是运行状态，随 state 走；所有定时器与 nextSampleAt 都从这里取。
  const intervalMs = () => state.intervalMinutes * 60 * 1000
  function loadSettings() {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(SETTINGS_PATH, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  /**
   * ut 基线必须所有 DSH 窗口共用一份。每个窗口都是独立进程、各有一份内存 state，
   * 只信内存的话，A 窗口落了一条、B 窗口还在用旧基线，就会把同一段消耗再记一次
   * （真机上表现为面板「日 Tokens」莫名翻倍）。所以每次采样前都从 settings.json
   * 重新读一次，取两者较大值。
   */
  function readPersistedBaseline() {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(SETTINGS_PATH, 'utf8'))
      return normalizeUtBaseline(parsed && parsed.utBaseline)
    } catch {
      return null
    }
  }

  function saveSettings() {
    try {
      fsSync.mkdirSync(DATA_DIR, { recursive: true })
      fsSync.writeFileSync(
        SETTINGS_PATH,
        JSON.stringify(
          {
            wbPercent: state.scales.wb,
            theme: state.theme,
            colorMode: state.colorMode,
            intervalMinutes: state.intervalMinutes,
            utBaseline: state.utBaseline,
            sources: state.sources,
            scales: state.scales,
            // 卡券编号/子账号不是密钥，但同样只有用户自己填，默认留空。
            aliyun: state.aliyunConfig,
            savedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      )
    } catch {
      // 设置写盘失败不致命，下次再试。
    }
    // 同时把设置写进 csv 的第一行：搬走这一张表就等于搬走全部数据。
    void writeSettingsMeta()
  }
  /** 要随表搬走的那部分设置（utBaseline 是本机 token 计数，不写进表）。 */
  function settingsMeta () {
    return {
      version: 1,
      theme: state.theme,
      colorMode: state.colorMode,
      intervalMinutes: state.intervalMinutes,
      sources: Object.assign({}, state.sources),
      scales: Object.assign({}, state.scales),
      wbPercent: state.scales.wb,
    }
  }
  async function writeSettingsMeta () {
    try {
      await withCsvLock(() => writeMetaLine(CSV_PATH, settingsMeta()))
    } catch (err) {
      state.lastSettingsError = messageOf(err)
    }
  }
  /** 导入或启动时把表里的设置搬回内存。 */
  function applySettingsMeta (meta) {
    if (!meta || typeof meta !== 'object') return false
    let changed = false
    if (meta.theme !== undefined) {
      const next = clampTheme(meta.theme)
      if (next !== state.theme) { state.theme = next; changed = true }
    }
    if (meta.colorMode !== undefined) {
      const next = normalizeColorMode(meta.colorMode)
      if (next !== state.colorMode) { state.colorMode = next; changed = true }
    }
    if (meta.intervalMinutes !== undefined) {
      const next = normalizeIntervalMinutes(meta.intervalMinutes)
      if (next !== state.intervalMinutes) {
        state.intervalMinutes = next
        changed = true
        rearmTimer()
      }
    }
    if (meta.sources !== undefined) {
      const next = normalizeSources(meta.sources)
      if (JSON.stringify(next) !== JSON.stringify(state.sources)) { state.sources = next; changed = true }
    }
    if (meta.scales !== undefined || meta.wbPercent !== undefined) {
      const next = normalizeScales(
        meta.scales !== undefined
          ? meta.scales
          : { wb: meta.wbPercent === undefined ? state.scales.wb : meta.wbPercent },
      )
      if (JSON.stringify(next) !== JSON.stringify(state.scales)) { state.scales = next; changed = true }
    }
    return changed
  }
  const saved = loadSettings()
  // 采样旁路 token：首次生成后复用（本机私有文件，权限尽量收紧）。
  let apiToken = ''
  try {
    apiToken = String(fsSync.readFileSync(API_TOKEN_PATH, 'utf8')).trim()
  } catch {
    apiToken = ''
  }
  if (!/^[0-9a-f]{32}$/.test(apiToken)) {
    apiToken = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
  }
  try {
    fsSync.mkdirSync(DATA_DIR, { recursive: true })
    fsSync.writeFileSync(API_TOKEN_PATH, apiToken, 'utf8')
  } catch {
    // 写不进去就退化成「只有 GUI 能用」，不影响主流程。
  }
  // 把监听地址也写出来，独立脚本不用猜端口。
  try {
    const server = ctx.get('webServer')
    if (server && typeof server.getOrigin === 'function') {
      const origin = String(server.getOrigin() || '').replace(/\/+$/, '')
      if (origin) fsSync.writeFileSync(API_ENDPOINT_PATH, origin, 'utf8')
    }
  } catch {
    // 未监听时拿不到 origin，脚本自己再探测。
  }
  const state = {
    lastAttemptAt: null,
    lastSampleOk: null,
    lastSampleError: null,
    lastWbOk: null,
    lastWbError: null,
    // 最近一次 wb 采样是哪些账号相加得到的（[{name,value,selected}]）
    lastWbAccounts: null,
    lastAliyunOk: null,
    lastAliyunError: null,
    // ut：最近一次汇总了多少个会话日志、缓存命中了几个
    lastUtOk: null,
    lastUtError: null,
    lastUtSessions: null,
    lastUtReused: null,
    lastUtRemembered: null,
    lastUtRememberedTokens: null,
    nextSampleAt: null,
    lastChartAt: null,
    lastChartMeta: null,
    // 老 settings.json 只有 wbPercent，没有 scales：迁移一次就够了。
    scales:
      saved.scales === undefined
        ? normalizeScales({ wb: saved.wbPercent === undefined ? WB_PERCENT_DEFAULT : saved.wbPercent })
        : normalizeScales(saved.scales),
    sources: normalizeSources(saved.sources),
    aliyunConfig: sanitizeAliyunConfig(saved.aliyun),
    theme: clampTheme(saved.theme === undefined ? THEME_DEFAULT : saved.theme),
    colorMode: normalizeColorMode(saved.colorMode),
    intervalMinutes: normalizeIntervalMinutes(saved.intervalMinutes),
    utBaseline: normalizeUtBaseline(saved.utBaseline),
    bootedAt: new Date().toISOString(),
  }
  let disposed = false
  const inflightSample = { ds: null, wb: null, aliyun: null, ut: null }
  // DS 与 WB 两路采样并行跑，但落盘必须串行：否则两边各自 read-modify-write
  // 同一份 CSV，后写的会把先写的那条覆盖掉（曾经丢过整条 WB 记录）。
  let csvQueue = Promise.resolve()
  function withCsvLock(task) {
    const run = csvQueue.then(task, task)
    csvQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
  let timer = null

  /**
   * 自动整理（用户 m08192：不要按钮，应当自动整理）。文件里的行只要不是按时间
   * 升序，就原地重排一次——只重排：不删行、不改编码、不改格式。触发点：启动、
   * 每次采样之后、出图之前。文件被 Excel 占用等失败只记一行错误，不打断采样。
   */
  async function autoTidy(reason) {
    try {
      const rows = await readCsvFile(CSV_PATH)
      if (countOutOfOrder(rows) === 0) return { ok: true, changed: false, moved: 0 }
      const result = await withCsvLock(() => normalizeCsvFile(CSV_PATH))
      if (result && result.ok && result.moved > 0) {
        state.lastTidyAt = new Date().toISOString()
        state.lastTidyMoved = result.moved
        state.lastTidyReason = reason || null
        state.lastTidyError = null
      }
      return result || { ok: true, changed: false, moved: 0 }
    } catch (err) {
      state.lastTidyError = messageOf(err)
      return { ok: false, changed: false, moved: 0, error: state.lastTidyError }
    }
  }

  /**
   * Sample one series and append it to the CSV (newest at the bottom). `kind` is 'ds' (DeepSeek
   * balance, 元) or 'wb' (WorkBuddy CN credits). WB sample failures never
   * block the DS sample — they are recorded separately and skipped.
   * The DS failure path keeps throwing `fail(...)` so existing tests/API
   * semantics hold; WB failure returns a `{ok:false}` result instead.
   */
  // 同一台机器可能同时开着好几个 DSH 窗口，每个窗口都跑一份插件、都有自己的定时器。
  // 如果谁到点都写一行，同一分钟里会冒出十几行、图表也会被重复数据带偏。定时采样
  // 前先看一眼磁盘上这个数据源最近一条的时间：10 分钟内刚采过就安静跳过；手动点
  // 「立即采样」不受这个限制（那是用户明确要求现在就写）。
  const SAMPLE_FRESH_MS = 10 * 60 * 1000
  async function recentlySampled(kind) {
    try {
      const rows = await readCsvFile(CSV_PATH)
      let latest = 0
      for (const row of rows) {
        if (row.kind !== kind) continue
        const at = Date.parse(String(row.time).replace(' ', 'T'))
        if (Number.isFinite(at) && at > latest) latest = at
      }
      return latest > 0 && Date.now() - latest < SAMPLE_FRESH_MS
    } catch {
      return false
    }
  }

  async function runSample(trigger, kind = KIND_DS) {
    const key = SAMPLE_KINDS[kind] || KIND_DS
    if (inflightSample[key]) return inflightSample[key]
    inflightSample[key] = (async () => {
      state.lastAttemptAt = new Date().toISOString()
      state.nextSampleAt = new Date(Date.now() + intervalMs()).toISOString()
      // ut 的基线要等这一行真的落盘后才推进（见下面的 landed 判断）。
      let utBaselineNext = null
      try {
        if (trigger !== 'manual' && (await recentlySampled(key))) {
          return { ok: true, skipped: true, reason: 'fresh', kind: key, trigger: trigger || null }
        }
        let raw
        let sourceName = key
        let accountBreakdown = null
        if (key === KIND_WB) {
          const source = await readWbCredits(ctx)
          raw = source.value
          sourceName = source.source || key
          accountBreakdown = source.accounts || null
        } else if (key === KIND_ALIYUN) {
          // 阿里云这一路现读凭据库里的 AK，失败原因（没配/没权限/查不到券）各自成码。
          const creds = await aliyunCredentials()
          const info = await queryAliyunCoupon({
            accessKeyId: creds.accessKeyId,
            accessKeySecret: creds.accessKeySecret,
            couponId: state.aliyunConfig.couponId,
            subAccount: state.aliyunConfig.subAccount,
          })
          raw = info.balance
          sourceName = 'aliyun-coupon'
        } else if (key === KIND_UT) {
          // ut：把本机所有 DSH 会话（含已归档会话）的 token 消耗加总，纯本地计算，
          // 不需要任何凭据，也不允许调用方手输数字。
          const info = await totalTokens({ sessionsDir: SESSION_LOGS_DIR, cachePath: TOKEN_CACHE_PATH })
          // CSV 里的 ut 行是增量：这条记录 = 本次累计 − 上次累计。
          const total = info.tokens
          // 基线以「内存」和「settings.json 里最新的」两者较大值为准：多开 DSH 时
          // 别的窗口刚落过一条，这条就该是 0，而不是把同一段消耗再记一次。
          const memory = state.utBaseline
          const persisted = readPersistedBaseline()
          let previous = memory
          if (persisted !== null && (previous === null || persisted > previous)) {
            previous = persisted
            state.utBaseline = persisted
          }
          raw = previous === null ? 0 : Math.max(0, total - previous)
          // 基线先不往前推：只有这一行真的落盘了才推进。同一分钟内第二次采样会被
          // dedupeMinute 跳过，那时如果提前推进基线，这段增量就永久丢了。
          utBaselineNext = total
          sourceName = 'ut-delta'
          state.lastUtSessions = info.counted
          state.lastUtReused = info.reused
          state.lastUtRemembered = info.remembered || 0
          state.lastUtRememberedTokens = info.rememberedTokens || 0
        } else {
          const source = await readBalance(ctx)
          raw = source && source.balance
          sourceName = (source && source.source) || key
        }
        const record = {
          time: formatTimestamp(new Date()),
          kind: key,
          value: Number(Number(raw).toFixed(6)),
        }
        const written = await withCsvLock(async () => {
          // Append-only: never rewrite or delete an existing row (single CSV,
          // no sidecar). Exact (time, kind) duplicates are skipped, and the
          // live sampler keeps at most one row per (minute, kind) because the
          // CSV is opened in Excel, which stores minute precision.
          // detail:true tells us whether this record actually landed — the
          // ut baseline may only move forward when it did.
          return appendCsvRow(CSV_PATH, record, { dedupeMinute: true, detail: true })
        })
        const next = written.rows
        const landed = written.added.length > 0
        if (key === KIND_UT && landed && utBaselineNext !== null) {
          state.utBaseline = utBaselineNext
          // 基线要立刻落盘：插件重启后靠它算下一次的差值。
          saveSettings()
        }
        if (key === KIND_WB) {
          state.lastWbOk = true
          state.lastWbError = null
          // 面板/排障用：这次 wb 行是几个账号相加得来的。
          state.lastWbAccounts = accountBreakdown
        } else if (key === KIND_ALIYUN) {
          state.lastAliyunOk = true
          state.lastAliyunError = null
        } else if (key === KIND_UT) {
          state.lastUtOk = true
          state.lastUtError = null
        } else {
          state.lastSampleOk = true
          state.lastSampleError = null
        }
        return {
          ok: true,
          trigger,
          kind: key,
          record,
          rows: next.length,
          skipped: !landed,
          source: sourceName,
        }
      } catch (err) {
        if (key === KIND_WB) {
          state.lastWbOk = false
          state.lastWbError = messageOf(err)
          return fail('wb_sample_failed', state.lastWbError || 'WorkBuddy 积分采样失败')
        }
        if (key === KIND_ALIYUN) {
          state.lastAliyunOk = false
          state.lastAliyunError = messageOf(err)
          return fail(err && err.code ? err.code : 'aliyun_sample_failed', state.lastAliyunError)
        }
        if (key === KIND_UT) {
          state.lastUtOk = false
          state.lastUtError = messageOf(err)
          return fail(err && err.code ? err.code : 'ut_sample_failed', state.lastUtError)
        }
        state.lastSampleOk = false
        state.lastSampleError = messageOf(err)
        return fail('sample_failed', state.lastSampleError)
      } finally {
        inflightSample[key] = null
      }
    })()
    return inflightSample[key]
  }

  /**
   * 按开关采样：只跑开着的序列。任一路失败都不挡其它路——
   * `ok` 仍以 DS 为准（DS 关掉时退回 WB / 阿里云），旧调用方读的就是这个语义。
   */
  async function runSampleBoth(trigger) {
    const active = SOURCE_NAMES.filter((name) => state.sources[name])
    const results = await Promise.all(active.map((name) => runSample(trigger, name)))
    const byName = {}
    active.forEach((name, index) => {
      byName[name] = results[index]
    })
    const ds = byName.ds || null
    const wb = byName.wb || null
    const aliyun = byName.aliyun || null
    const ut = byName.ut || null
    const primary = ds || wb || aliyun || ut || null
    const records = results.filter((sample) => sample && sample.ok && sample.record).map((sample) => sample.record)
    const errors = results.filter((sample) => sample && !sample.ok).map((sample) => sample.error)
    // 采完顺手把顺序理正（用户 m08192：自动整理，不给按钮）。
    await autoTidy('sample')
    return {
      // 只要有一条真的写进去了就算成功（v1.19：ut 不需要任何凭据，DS/WB/阿里云
      // 全挂的时候它照样能落一行，这时不该给面板报整体失败）。具体哪个源失败
      // 仍放在各源的 ok/error 与顶层 error 里。
      ok: records.length > 0,
      trigger,
      sources: Object.assign({}, state.sources),
      ds,
      wb,
      aliyun,
      ut,
      records,
      errors,
      // 顶层 error 保留主序列的失败原因：客户端提示读的就是这个字段
      ...(primary && !primary.ok && primary.error ? { error: primary.error } : {}),
    }
  }

  /** 从 DSH 凭据库取阿里云 AK；没配就是空串（不是异常，用户还没填而已）。 */
  async function aliyunCredentials() {
    const out = { accessKeyId: '', accessKeySecret: '' }
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : ctx.credentials
    if (!credentials || typeof credentials.resolve !== 'function') return out
    try {
      const resolved = await credentials.resolve(CRED_ALIYUN_AK_ID)
      if (resolved && resolved.value) out.accessKeyId = String(resolved.value)
    } catch {
      // 取不到就当没配
    }
    try {
      const resolved = await credentials.resolve(CRED_ALIYUN_AK_SECRET)
      if (resolved && resolved.value) out.accessKeySecret = String(resolved.value)
    } catch {
      // 同上
    }
    return out
  }

  /** 只告诉前端「配没配 + 打了码的预览」，明文永远不出 Host。 */
  async function aliyunPayload() {
    const out = {
      couponId: state.aliyunConfig.couponId,
      subAccount: state.aliyunConfig.subAccount,
      hasAccessKeyId: false,
      hasAccessKeySecret: false,
      accessKeyIdMasked: '',
      endpoint: ALIYUN_ENDPOINT,
    }
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : ctx.credentials
    if (!credentials || typeof credentials.describe !== 'function') return out
    try {
      const info = await credentials.describe(CRED_ALIYUN_AK_ID)
      out.hasAccessKeyId = Boolean(info && info.configured)
      if (info && info.masked) out.accessKeyIdMasked = String(info.masked)
    } catch {
      // ignore
    }
    try {
      const info = await credentials.describe(CRED_ALIYUN_AK_SECRET)
      out.hasAccessKeySecret = Boolean(info && info.configured)
    } catch {
      // ignore
    }
    return out
  }

  /** AK 只进凭据库；空串 = 用户没改，跳过（凭据服务的 set 也不接受空值）。 */
  async function storeAliyunSecrets(secret) {
    const out = { accessKeyId: false, accessKeySecret: false }
    if (!secret || typeof secret !== 'object') return out
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : ctx.credentials
    if (!credentials || typeof credentials.set !== 'function') return out
    const pairs = [
      [CRED_ALIYUN_AK_ID, 'accessKeyId', 'accessKeyId'],
      [CRED_ALIYUN_AK_SECRET, 'accessKeySecret', 'accessKeySecret'],
    ]
    for (const [ref, field, flag] of pairs) {
      const value = typeof secret[field] === 'string' ? secret[field].trim() : ''
      if (!value) continue
      await credentials.set(ref, value)
      out[flag] = true
    }
    return out
  }

  async function statePayload() {
    let rows = []
    try {
      rows = await readCsvFile(CSV_PATH)
    } catch (err) {
      return fail('csv_unreadable', '读取 CSV 失败：' + messageOf(err), { csvPath: CSV_PATH })
    }
    const summary = summarize(rows)
    const dates = rows.map((row) => String(row.time || '').slice(0, 10)).filter((date) => DATE_RE.test(date))
    const firstDate = dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null
    const lastDate = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null
    let exists = true
    try {
      await fs.access(CSV_PATH)
    } catch {
      exists = false
    }
    return {
      ok: true,
      csvPath: CSV_PATH,
      exists,
      intervalMs: intervalMs(),
      intervalMinutes: state.intervalMinutes,
      intervalRange: {
        min: INTERVAL_MIN_MINUTES,
        max: INTERVAL_MAX_MINUTES,
        default: INTERVAL_DEFAULT_MINUTES,
      },
      maxDays: MAX_DAYS,
      rows: summary.count,
      days: summary.days,
      latestBalance: summary.latestBalance,
      latestTime: summary.latestTime,
      latestWb: summary.latestWb ? summary.latestWb.value : null,
      latestWbTime: summary.latestWb ? summary.latestWb.time : null,
      latestAliyun: summary.latestAliyun ? summary.latestAliyun.value : null,
      latestAliyunTime: summary.latestAliyun ? summary.latestAliyun.time : null,
      latestUt: summary.latestUt ? summary.latestUt.value : null,
      latestUtTime: summary.latestUt ? summary.latestUt.time : null,
      // ut 行是增量：当天消耗 = 今天所有 ut 行相加，总量 = 全表相加。
      utToday: todayTokenSpend(rows),
      // summarize() already walks the ut rows once; reuse it instead of a second pass.
      utTotal: summary.utTotal,
      dsCount: summary.dsCount,
      wbCount: summary.wbCount,
      aliyunCount: summary.aliyunCount,
      utCount: summary.utCount,
      // How many lines sit out of chronological order. The plugin re-sorts them
      // automatically (boot / after every sample / before charting) without
      // deleting anything, so this should read 0; a non-zero value only means the
      // next tick has not run yet.
      outOfOrder: countOutOfOrder(rows),
      // 自动整理留痕：什么时候整理的、挪了几行、因为什么触发的。
      lastTidyAt: state.lastTidyAt || null,
      lastTidyMoved: state.lastTidyMoved || 0,
      lastTidyReason: state.lastTidyReason || null,
      lastTidyError: state.lastTidyError || null,
      lastAttemptAt: state.lastAttemptAt,
      lastSampleOk: state.lastSampleOk,
      lastSampleError: state.lastSampleError,
      lastWbOk: state.lastWbOk,
      lastWbError: state.lastWbError,
      wbAccounts: state.lastWbAccounts,
      wbAccountCount: Array.isArray(state.lastWbAccounts) ? state.lastWbAccounts.length : 0,
      lastAliyunOk: state.lastAliyunOk,
      lastAliyunError: state.lastAliyunError,
      lastUtOk: state.lastUtOk,
      lastUtError: state.lastUtError,
      utSessions: state.lastUtSessions,
      utReused: state.lastUtReused,
      utRemembered: state.lastUtRemembered,
      utRememberedTokens: state.lastUtRememberedTokens,
      nextSampleAt: state.nextSampleAt,
      lastChartAt: state.lastChartAt,
      chartMeta: state.lastChartMeta,
      wbPercent: state.scales.wb,
      wbPercentRange: { min: WB_PERCENT_MIN, max: WB_PERCENT_MAX, default: WB_PERCENT_DEFAULT },
      sources: Object.assign({}, state.sources),
      scales: Object.assign({}, state.scales),
      scaleStep: SCALE_STEP,
      scaleRange: { min: SCALE_MIN, max: SCALE_MAX },
      // 四列各自的步长与上下限：ut 是 divisor（每格多少 token），与百分比不同量级。
      scaleSteps: Object.fromEntries(SOURCE_NAMES.map((name) => [name, scaleStepOf(name)])),
      scaleRanges: Object.fromEntries(SOURCE_NAMES.map((name) => [name, scaleRangeOf(name)])),
      utDivisor: {
        default: SCALES_DEFAULT.ut,
        min: UT_DIVISOR_MIN,
        max: UT_DIVISOR_MAX,
        step: UT_DIVISOR_STEP,
      },
      utBaseline: state.utBaseline,
      aliyun: await aliyunPayload(),
      theme: state.theme,
      themeOptions: THEME_NAMES.slice(),
      colorMode: state.colorMode,
      colorModeOptions: COLOR_MODES.slice(),
      range: {
        firstDate,
        lastDate,
        defaultFrom: isoDateDaysAgo(MAX_DAYS - 1),
        defaultTo: isoDateDaysAgo(0),
        maxDays: MAX_DAYS,
        limitDays: RANGE_LIMIT_DAYS,
      },
    }
  }

  async function handler(req, res) {
    try {
      const rejected =
        ctx.connection && typeof ctx.connection.requestRejection === 'function'
          ? ctx.connection.requestRejection(req)
          : undefined
      // 本机脚本旁路：带了数据目录里那份 token 的请求放行（只在本机可读），
      // 供 gugu-stock-charts skill 在生图前触发一次采样（v1.7 ③）。
      const tokenHeader = String(req.headers['x-gugu-token'] || '')
      const bypassed = Boolean(apiToken) && tokenHeader === apiToken
      if (rejected && !bypassed) {
        sendJson(res, 403, fail('forbidden', 'forbidden'))
        return
      }
      const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
      const sub = url.pathname.startsWith(ROUTE_PATH)
        ? url.pathname.slice(ROUTE_PATH.length).replace(/^\/+/, '')
        : ''
      const method = String(req.method || 'GET').toUpperCase()
      if (sub === '' || sub === 'state') {
        if (method !== 'GET' && method !== 'POST') {
          sendJson(res, 405, fail('method_not_allowed', 'state 只接受 GET/POST'))
          return
        }
        sendJson(res, 200, await statePayload())
        return
      }
      if (method !== 'POST') {
        sendJson(res, 405, fail('method_not_allowed', sub + ' 只接受 POST'))
        return
      }
      if (sub === 'sample') {
        const result = await runSampleBoth('manual')
        sendJson(res, result.ok ? 200 : 502, result)
        return
      }
      if (sub === 'normalize') {
        // 整理：只按时间把行重新排好（早的在上），一行都不删、不改格式、不改编码。
        // 用于修掉 Excel / 旧实例把行挪到顶部留下的乱序。
        const result = await withCsvLock(() => normalizeCsvFile(CSV_PATH))
        sendJson(res, 200, Object.assign({ ok: true }, result))
        return
      }
      if (sub === 'settings') {
        const body = await readJsonBody(req)
        if (body === null) {
          sendJson(res, 400, fail('bad_request', '请求体不是合法的 JSON。'))
          return
        }
        if (body.wbPercent !== undefined) state.scales.wb = clampScale('wb', body.wbPercent)
        if (body.theme !== undefined) state.theme = clampTheme(body.theme)
        if (body.colorMode !== undefined) state.colorMode = normalizeColorMode(body.colorMode)
        if (body.intervalMinutes !== undefined) {
          const next = normalizeIntervalMinutes(body.intervalMinutes)
          if (next !== state.intervalMinutes) {
            state.intervalMinutes = next
            // 改完间隔立即生效：清掉旧定时器、按新间隔重新武装。
            rearmTimer()
          }
        }
        if (body.utBaseline !== undefined) state.utBaseline = normalizeUtBaseline(body.utBaseline)
        if (body.sources !== undefined) state.sources = normalizeSources(body.sources)
        if (body.scales !== undefined) {
          state.scales = normalizeScales(Object.assign({}, state.scales, body.scales))
        }
        if (body.aliyun !== undefined) {
          state.aliyunConfig = sanitizeAliyunConfig(Object.assign({}, state.aliyunConfig, body.aliyun))
        }
        // AK 明文只写凭据库，settings.json 里永远没有它。
        const storedSecrets = await storeAliyunSecrets(body.aliyunSecret)
        saveSettings()
        sendJson(res, 200, {
          ok: true,
          wbPercent: state.scales.wb,
          wbPercentRange: { min: WB_PERCENT_MIN, max: WB_PERCENT_MAX, default: WB_PERCENT_DEFAULT },
          theme: state.theme,
          colorMode: state.colorMode,
          colorModeOptions: COLOR_MODES.slice(),
          intervalMinutes: state.intervalMinutes,
          intervalRange: {
            min: INTERVAL_MIN_MINUTES,
            max: INTERVAL_MAX_MINUTES,
            default: INTERVAL_DEFAULT_MINUTES,
          },
          sources: Object.assign({}, state.sources),
          scales: Object.assign({}, state.scales),
          scaleStep: SCALE_STEP,
          scaleRange: { min: SCALE_MIN, max: SCALE_MAX },
          scaleSteps: Object.fromEntries(SOURCE_NAMES.map((name) => [name, scaleStepOf(name)])),
          scaleRanges: Object.fromEntries(SOURCE_NAMES.map((name) => [name, scaleRangeOf(name)])),
          utDivisor: {
            default: SCALES_DEFAULT.ut,
            min: UT_DIVISOR_MIN,
            max: UT_DIVISOR_MAX,
            step: UT_DIVISOR_STEP,
          },
          utBaseline: state.utBaseline,
          aliyun: await aliyunPayload(),
          storedSecrets,
        })
        return
      }
      if (sub === 'aliyun-test') {
        // 配置页的「测试连接」：现读凭据库 + 现设置的券号，查一次就回，不写 CSV。
        try {
          const creds = await aliyunCredentials()
          const info = await queryAliyunCoupon({
            accessKeyId: creds.accessKeyId,
            accessKeySecret: creds.accessKeySecret,
            couponId: state.aliyunConfig.couponId,
            subAccount: state.aliyunConfig.subAccount,
          })
          sendJson(res, 200, {
            ok: true,
            balance: info.balance,
            couponId: info.couponId,
            couponNo: info.couponNo,
            face: info.nominalValue,
            status: info.status,
            expiry: info.expiry,
          })
        } catch (err) {
          sendJson(
            res,
            400,
            fail((err && err.code) || 'aliyun_test_failed', messageOf(err), err && err.detail ? { detail: err.detail } : undefined),
          )
        }
        return
      }
      if (sub === 'save-chart') {
        const body = await readJsonBody(req)
        if (body === null) {
          sendJson(res, 400, fail('bad_request', '请求体不是合法的 JSON。'))
          return
        }
        const result = await saveChartToDesktop(body.kind)
        sendJson(res, result.ok ? 200 : 500, result)
        return
      }
      if (sub === 'import') {
        const body = await readJsonBody(req, 8 * 1024 * 1024)
        if (body === null || typeof body.data !== 'string' || body.data === '') {
          sendJson(res, 400, fail('bad_request', '导入的内容不是合法的 CSV。'))
          return
        }
        const result = await importCsvPayload(body.data)
        sendJson(res, result.ok ? 200 : 400, result)
        return
      }
      if (sub === 'open-csv') {
        const result = await openCsvFile()
        sendJson(res, result.ok ? 200 : 500, result)
        return
      }
      if (sub === 'chart') {
        const body = await readJsonBody(req)
        if (body === null) {
          sendJson(res, 400, fail('bad_request', '请求体不是合法的 JSON。'))
          return
        }
        // 出图前也理一次：这样图上的横轴顺序总是对的。
        await autoTidy('chart')
        const result = await generateChart({
          kind: body.kind,
          from: body.from,
          to: body.to,
          wbPercent: body.wbPercent === undefined ? state.scales.wb : body.wbPercent,
          theme: body.theme === undefined ? state.theme : body.theme,
          colorMode: body.colorMode === undefined ? state.colorMode : body.colorMode,
          sources: body.sources === undefined ? state.sources : normalizeSources(body.sources),
          scales: normalizeScales(Object.assign({}, state.scales, body.scales || {})),
        })
        if (result.ok) {
          state.lastChartAt = result.generatedAt
          state.sources = result.sources
          state.scales = result.scales
          state.theme = result.theme
          if (result.colorMode) state.colorMode = result.colorMode
          // 用户选择立刻落盘，插件/DSH 重启后仍是上次的设置（v1.7 ⑨）。
          saveSettings()
          state.lastChartMeta = result.meta
            ? {
                days: result.meta.days,
                points: result.meta.points,
                ylim: result.meta.ylim,
                segments: result.meta.segments,
                firstDate: result.meta.firstDate,
                lastDate: result.meta.lastDate,
              }
            : null
        }
        const status = result.ok
          ? 200
          : ['bad_range', 'range_too_long', 'no_data'].includes(result.error && result.error.code)
            ? 400
            : 500
        sendJson(res, status, result)
        return
      }
      sendJson(res, 404, fail('not_found', '未知接口：' + sub))
    } catch (err) {
      sendJson(res, 500, fail('internal', messageOf(err)))
    }
  }

  const tick = async (trigger) => {
    if (disposed) return
    try {
      await runSampleBoth(trigger)
    } finally {
      arm()
    }
  }

  function arm() {
    if (disposed) return
    state.nextSampleAt = new Date(Date.now() + intervalMs()).toISOString()
    timer = setTimeout(() => {
      void tick('interval')
    }, intervalMs())
    if (timer && typeof timer.unref === 'function') timer.unref()
  }

  /** 采样间隔被改后立刻按新值重排下一次定时器；boot 前调用是安全的（timer 为 null）。 */
  function rearmTimer() {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = null
    arm()
  }

  // DSH Go 工具卡：经 DSH Remote 中转时，这是唯一能看到的插件界面。
  const tools = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools
  if (tools && typeof tools.register === 'function') {
    // 工具路径必须带上面板的真实设置。generateChart 是模块级函数，拿不到 apply
    // 里的 state；以前工具只传 kind/from/to，主题/颜色来源/数据源/缩放全走了内置
    // 默认（light/change/不开阿里云），还作为显式参数覆盖掉渲染器读 settings.json
    // 的兜底——表现就是「Agent 用工具出的图是白图、缩放不对、没有阿里云线」。
    // 这里把 state 的设置填成默认值再交给 generateChart，和 HTTP /skill 完全一致。
    const generateChartForTool = (chartOptions = {}) =>
      generateChart(Object.assign({}, chartOptions, {
        wbPercent: state.scales.wb,
        theme: state.theme,
        colorMode: state.colorMode,
        sources: Object.assign({}, state.sources),
        scales: Object.assign({}, state.scales),
      }))
    const definition = makeToolDefinition({
      csvPath: () => CSV_PATH,
      runSample,
      runSampleBoth,
      generateChart: generateChartForTool,
      // 出图前先自动理一次顺序；工具层与 HTTP 层共用同一个 autoTidy。
      autoTidy: () => autoTidy('chart'),
      readRows: () => readCsvFile(CSV_PATH),
    })
    const registerTool = () => tools.register(definition)
    if (typeof ctx.effect === 'function') ctx.effect(registerTool)
    else registerTool()
  }

  // Register the HTTP surface; ctx.effect owns the unregister on unload.
  /**
   * 导入一张表：整份替换数据，并把表里第一行的设置搬回内存。
   * 只认 csv（时间/来源/数值），原样落盘，之后再正常追加。
   */
  async function importCsvPayload (base64) {
    let buffer
    try {
      buffer = Buffer.from(String(base64 || ''), 'base64')
    } catch {
      return fail('bad_import', '导入的内容不是合法的 CSV。')
    }
    if (!buffer || buffer.length === 0) return fail('bad_import', '导入的内容是空的。')
    if (buffer.length > 32 * 1024 * 1024) return fail('too_large', '这张表太大了（超过 32 MB）。')
    const text = decode(buffer)
    const rows = parseCsv(text)
    if (rows.length === 0) return fail('bad_import', '这张表里没有可识别的数据行（需要「时间,来源,数值」三列）。')
    try {
      await fs.copyFile(CSV_PATH, `${CSV_PATH}.bak-before-import-${Date.now()}`)
    } catch {
      /* 没有旧文件就不用备份 */
    }
    await withCsvLock(() => writeBufferAtomic(CSV_PATH, buffer))
    const meta = readMeta(text)
    if (meta) applySettingsMeta(meta)
    // 换了表就等于换了账本：token 基线归零，下一次采样从 0 起算。
    state.utBaseline = null
    state.lastImport = { rows: rows.length, adopted: Boolean(meta), at: new Date().toISOString() }
    saveSettings()
    return { ok: true, rows: rows.length, adopted: Boolean(meta), csvPath: CSV_PATH }
  }

  const register = () =>
    ctx.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler })
  if (typeof ctx.effect === 'function') ctx.effect(register)
  else register()

  // Boot: make sure the CSV exists, top up immediately when the last sample is
  // stale, then settle into the 15-minute cadence.
  const boot = setTimeout(async () => {
    if (disposed) return
    try {
      await ensureCsvFile()
      // 启动时先理一次顺序：上次退出前可能被 Excel 之类的程序重写过。
      await autoTidy('boot')
      // 表里带着面板设置（搬表即搬设置）；没有就把当前设置写进去。
      const bootState = await readCsvFileWithMeta(CSV_PATH)
      if (bootState.meta) applySettingsMeta(bootState.meta)
      else await writeSettingsMeta()
      const rows = await readCsvFile(CSV_PATH)
      // 文件按升序排列（新的在下方）；用所有行里最大的时间戳判断最近记录，
      // 不依赖行在文件中的位置（ds/wb/aliyun 任一都可驱动刷新判断）。
      let latest = Number.NaN
      for (const row of rows) {
        const stamp = Date.parse(row.time.replace(' ', 'T'))
        if (Number.isFinite(stamp) && (!Number.isFinite(latest) || stamp > latest)) latest = stamp
      }
      const stale = !Number.isFinite(latest) || Date.now() - latest >= RECENT_ENOUGH_MS
      if (stale) await runSampleBoth('activate')
    } catch (err) {
      state.lastSampleOk = false
      state.lastSampleError = messageOf(err)
    } finally {
      if (!disposed) arm()
    }
  }, 1500)
  if (boot && typeof boot.unref === 'function') boot.unref()

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    clearTimeout(boot)
  }
}
