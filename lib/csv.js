/**
 * Pure CSV helpers for the 谷谷股 plugin.
 *
 * Deliberately dependency-free (node builtins only) so the host plugin and the
 * acceptance tests can share the exact same code path. The file format is fixed
 * (v2, since 2026-11-21):
 *
 *   \uFEFF时间,来源,数值\r\n
 *   2026-11-10 01:34:00,ds,1.234567\r\n
 *   ...
 *   2026-11-22 18:39:50,al,123.45\r\n   <- newest sample at the BOTTOM
 *
 * - three columns: timestamp, kind ('ds'=DeepSeek balance, 'wb'=WorkBuddy
 *   credits, 'al'=Aliyun coupon balance), numeric value,
 * - ONE FILE ONLY. Rows are kept in ascending time order (earliest on top,
 *   newest at the bottom). The runtime sampling path ONLY APPENDS one line at
 *   the end — it never rewrites or removes an existing row,
 * - UTF-8 with BOM so Excel/WPS open it read-write by double click,
 * - CRLF line endings,
 * - one row per (second, kind) at most; a re-sample with a key that already
 *   exists is skipped (no duplicate), never used to replace/delete a row.
 *
 * A legacy 2-column file (时间,余额 — DS only) still parses: those rows come
 * back with kind='ds'. Column order was chosen with that in mind: the middle
 * cell is the kind marker, and a 2-cell line simply has none.
 *
 * NOTE: the old `<file>.sticky` sidecar has been removed. Everything — including
 * rows the user adds by hand — lives in this single CSV. There is no second
 * data source and no shadow ledger.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

export const CSV_HEADER = ['时间', '来源', '数值']
export const BOM = '\uFEFF'
// 面板设置（主题/颜色来源/数据源开关/缩放）也写进这张表里，行首固定前缀，
// 这样「搬走一个 csv」就等于搬走全部数据；parseCsv 会把它当注释行跳过。
export const META_PREFIX = '#gugu '
export const CSV_FILE_NAME = 'balances-v2.csv'
/** v1 file name. Read once for migration; never written again (see index.js). */
export const LEGACY_FILE_NAME = 'balances.csv'
/** Row kinds for column 2. */
export const KIND_DS = 'ds'
export const KIND_WB = 'wb'
/** Aliyun coupon (代金券) remaining balance, in 元. Column 2 writes the short form `al`. */
export const KIND_ALIYUN = 'al'
/**
 * Token usage (v1.19): 本机所有 DSH 会话（含已归档会话）累计消耗的 token 总量，
 * 单位是 token 原值（整数）。默认值的语义与其它三列不同 —— 它是「消耗」，不是余额。
 */
export const KIND_UT = 'ut'
/** Every kind column-2 may hold. */
export const KINDS = [KIND_DS, KIND_WB, KIND_ALIYUN, KIND_UT]
/** Older files (v1.12 pre-release) may carry the long marker; read it as the short one. */
const KIND_ALIASES = { aliyun: KIND_ALIYUN }

const RETRYABLE = new Set(['EBUSY', 'EPERM', 'EACCES'])

/** Local-time `YYYY-MM-DD HH:mm:ss` stamp, the CSV's first column. */
export function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Balance cell text: numeric, at most 6 decimals, no trailing zeros.
 * Used for the on-disk value column (exact data, not the display round).
 */
export function balanceText(value) {
  const raw = typeof value === 'string' ? value.replace(/[¥￥,\s]/g, '') : value
  const n = Number(raw)
  if (!Number.isFinite(n)) return ''
  return String(Number(n.toFixed(6)))
}

/**
 * Display rounding: at most 1 decimal, integers shown as integers.
 * 1008.40 -> "1008.4", 1008 -> "1008", 25.123456 -> "25.5".
 * Used only for chart labels and the settings page, never for the CSV value.
 */
export function displayValue(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return String(Number(n.toFixed(1)))
}

export function decode(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8').replace(/^\uFEFF/, '')
  }
  const utf8 = buffer.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  // Excel on a Chinese Windows machine may have saved the file as GBK before
  // the user pointed this plugin at it; decode it instead of dropping rows.
  for (const encoding of ['gbk', 'gb18030']) {
    try {
      return new TextDecoder(encoding).decode(buffer)
    } catch {
      /* keep trying */
    }
  }
  return utf8
}

/**
 * Parse the whole CSV into `{ time, kind, value }` rows, keeping file order.
 * Legacy 2-column lines (时间,余额) become kind='ds'. Unknown kind cells and
 * malformed rows are skipped.
 */
export function parseCsv(text) {
  const rows = []
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '') continue
    // Accept both comma- and Tab-separated cells: users pasting rows out of
    // Excel often produce `2026/11/11 14:22\tal\t300`, which split(',') alone
    // would collapse into one cell and silently drop.
    const cells = line.split(/[,\t]+/).map((cell) => cell.trim())
    if (cells.length < 2) continue
    // Skip any header line: the current (时间,来源,数值), the v2 one
    // (时间,ds/wb,数值) and the legacy (时间,余额). Matching on the first cell
    // alone is enough — `looksLikeTime` below rejects everything else anyway.
    if (cells[0] === '时间' || cells[0].toLowerCase() === 'time') continue
    if (!looksLikeTime(cells[0])) continue
    const value = Number(cells[cells.length - 1].replace(/[¥￥,\s]/g, ''))
    if (!Number.isFinite(value)) continue
    let kind = KIND_DS
    if (cells.length >= 3) {
      const raw = cells[1]
      const marker = KIND_ALIASES[raw] || raw
      if (KINDS.includes(marker)) kind = marker
      else continue // unknown kind marker — refuse to guess
    }
    rows.push({ time: normalizeTime(cells[0]), kind, value })
  }
  return rows
}

function looksLikeTime(value) {
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?/.test(value)
}

/**
 * `2026/11/21 9:05:03` -> `2026-11-21 09:05:03`;
 * `2026/11/21 9:05` -> `2026-11-21 09:05:00` so all rows share one precision
 * and ordering compares as strings.
 */
export function normalizeTime(value) {
  const m = String(value).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return String(value).trim()
  const pad = (n) => String(n).padStart(2, '0')
  const seconds = m[6] === undefined ? '00' : pad(m[6])
  return `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4])}:${m[5]}:${seconds}`
}

/** 从整份 csv 文本里读面板设置；没有这一行就返回 null。 */
export function readMeta (text) {
  for (const line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(META_PREFIX)) continue
    try {
      const parsed = JSON.parse(trimmed.slice(META_PREFIX.length))
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

/** 读 rows 与面板设置（设置行在表头之上）。 */
export async function readCsvFileWithMeta (filePath) {
  let buffer
  try {
    buffer = await fs.readFile(filePath)
  } catch (err) {
    if (err && err.code === 'ENOENT') return { rows: [], meta: null }
    throw err
  }
  const text = decode(buffer)
  return { rows: parseCsv(text), meta: readMeta(text) }
}

/**
 * 把面板设置写进现有的 csv：只替换 `#gugu {...}` 那一行，表头与所有数据行原样保留。
 * 整份重写走 writeAtomic，调用方要持 csv 锁。
 */
export async function writeMetaLine (filePath, meta) {
  let buffer
  try {
    buffer = await fs.readFile(filePath)
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, changed: false }
    throw err
  }
  const text = decode(buffer)
  const kept = String(text)
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith(META_PREFIX))
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
  await writeAtomic(filePath, `${META_PREFIX}${JSON.stringify(meta)}\r\n${kept.join('\r\n')}\r\n`)
  return { ok: true, changed: true }
}

/** Serialize rows back to the on-disk representation (BOM + meta + header + CRLF). */
export function serializeCsv(rows, meta) {
  const body = rows
    .filter(
      (row) =>
        row &&
        typeof row.time === 'string' &&
        KINDS.includes(row.kind) &&
        Number.isFinite(Number(row.value)),
    )
    .map((row) => `${row.time},${row.kind},${balanceText(row.value)}`)
    .join('\r\n')
  const head = CSV_HEADER.join(',')
  const metaLine = meta && typeof meta === 'object' ? `${META_PREFIX}${JSON.stringify(meta)}\r\n` : ''
  return `${BOM}${metaLine}${body === '' ? head : `${head}\r\n${body}`}\r\n`
}

function rowKey(row) {
  return `${row.time}\u0000${row.kind}`
}

/**
 * Minute bucket of a row, e.g. `2026-11-22 19:41\u0000ds`.
 * Excel saves CSV with minute precision, so two samples taken seconds apart
 * come back as two identical-looking rows. The live sampler uses this to keep
 * at most one row per (minute, kind); import tools ignore it on purpose.
 */
function minuteKey(row) {
  return `${String(row.time).slice(0, 16)}\u0000${row.kind}`
}

/** Validate + normalize an incoming record; null when it cannot be appended. */
function normalizeRecord(record) {
  if (!record) return null
  const time = normalizeTime(record.time)
  const kind = KIND_ALIASES[record.kind] || record.kind
  const value = Number(String(record.value).replace(/[¥￥,\s]/g, ''))
  if (!looksLikeTime(time) || !KINDS.includes(kind) || !Number.isFinite(value)) return null
  return { time, kind, value }
}

/**
 * In-memory helper: append `record` to the END of the list (ascending order).
 * A record whose (time, kind) key already exists is skipped — never replaced,
 * never removed. The runtime path uses `appendCsvRow` on disk instead.
 */
export function upsertTop(rows, record) {
  const next = Array.isArray(rows) ? rows.slice() : []
  const clean = normalizeRecord(record)
  if (!clean) return next
  if (next.some((row) => rowKey(row) === rowKey(clean))) return next
  next.push(clean)
  return next
}

/**
 * Merge a batch into an in-memory list, dedupe by (time, kind), sort ASCENDING
 * (oldest first, newest last). Existing rows are never discarded; only exact
 * key collisions are collapsed. Used by one-off import tools, not by sampling.
 */
export function upsertList(rows, records) {
  const byKey = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && typeof row.time === 'string' && KINDS.includes(row.kind)) {
      byKey.set(rowKey(row), row)
    }
  }
  for (const record of Array.isArray(records) ? records : []) {
    const clean = normalizeRecord(record)
    if (!clean) continue
    byKey.set(rowKey(clean), clean)
  }
  const all = [...byKey.values()]
  all.sort((a, b) => (a.time === b.time ? (a.kind < b.kind ? -1 : 1) : a.time < b.time ? -1 : 1))
  return all
}

/**
 * Read + parse the single CSV. A missing file is an empty CSV, not an error.
 * No sidecar, no merging — this is the only data source.
 */
export async function readCsvFile(filePath) {
  let buffer
  try {
    buffer = await fs.readFile(filePath)
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    throw err
  }
  return parseCsv(decode(buffer))
}

/** Append text at the end of a file, retrying when Excel/AV briefly locks it. */
async function appendWithRetry(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  let lastError = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.appendFile(filePath, text, 'utf8')
      return
    } catch (err) {
      lastError = err
      if (!err || !RETRYABLE.has(err.code)) break
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
    }
  }
  if (lastError && RETRYABLE.has(lastError.code)) {
    const locked = new Error(
      'CSV 文件正被其他程序占用（多半是被 Excel 打开了）：' +
        String(filePath) +
        ' —— 关掉它再采样/出图即可，已采到的数据不会丢。',
    )
    locked.code = 'csv_locked'
    locked.cause = lastError
    throw locked
  }
  throw lastError ?? new Error('append failed')
}

/** Make sure the file starts with BOM + header before the first append. */
async function ensureHeader(filePath) {
  try {
    const buffer = await fs.readFile(filePath)
    if (buffer.length === 0) await appendWithRetry(filePath, BOM + CSV_HEADER.join(',') + '\r\n')
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      await appendWithRetry(filePath, BOM + CSV_HEADER.join(',') + '\r\n')
      return
    }
    throw err
  }
}

/**
 * APPEND-ONLY write. Reads the current rows only to skip duplicates; it never
 * rewrites, reorders or deletes an existing line. New rows go at the END of
 * the file (= newest time at the bottom).
 *
 * `options.dedupeMinute` additionally skips a row when the same kind already
 * has a row in the same minute. The live sampler turns it on because Excel
 * (which the user opens the CSV with) stores minute precision, and two samples
 * seconds apart would otherwise look like duplicated rows forever.
 *
 * Returns the resulting in-memory row list. Pass `options.detail` to get
 * `{ rows, added }` instead — the sampler needs to know whether its row
 * actually landed (a same-minute duplicate is skipped on purpose).
 */
export async function appendCsvRows(filePath, records, options = {}) {
  const detail = Boolean(options && options.detail)
  const wrap = (rows, added = []) => (detail ? { rows, added } : rows)
  const incoming = (Array.isArray(records) ? records : [records])
    .map(normalizeRecord)
    .filter(Boolean)
  const existing = await readCsvFile(filePath)
  if (incoming.length === 0) return wrap(existing)
  const seen = new Set(existing.map(rowKey))
  const seenMinute = options && options.dedupeMinute ? new Set(existing.map(minuteKey)) : null
  const added = []
  for (const row of incoming) {
    const key = rowKey(row)
    if (seen.has(key)) continue
    if (seenMinute && seenMinute.has(minuteKey(row))) continue
    seen.add(key)
    if (seenMinute) seenMinute.add(minuteKey(row))
    added.push(row)
  }
  if (added.length === 0) return wrap(existing)
  await ensureHeader(filePath)
  await appendWithRetry(filePath, added.map((row) => `${row.time},${row.kind},${balanceText(row.value)}`).join('\r\n') + '\r\n')
  return wrap(existing.concat(added), added)
}

/** Append a single row (the normal sampling path). */
export async function appendCsvRow(filePath, record, options = {}) {
  return appendCsvRows(filePath, [record], options)
}

/* ------------------------------------------------------------------ *
 * 整理（re-order only）                                               *
 * ------------------------------------------------------------------ */

/** Split raw bytes on CRLF/LF. GBK trail bytes never collide with 0x0A/0x0D. */
function splitBufferLines(buffer) {
  const lines = []
  let start = 0
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0x0a) {
      let end = i
      if (end > start && buffer[end - 1] === 0x0d) end -= 1
      lines.push(buffer.subarray(start, end))
      start = i + 1
    }
  }
  if (start < buffer.length) lines.push(buffer.subarray(start))
  return lines
}

function bufferEncoding(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8-bom'
  const utf8 = buffer.toString('utf8')
  return utf8.includes('\uFFFD') ? 'gbk' : 'utf-8'
}

/**
 * How many rows sit out of chronological order (0 = perfectly ascending).
 * Read-only; used by the settings page to show "有 N 行位置不对".
 */
export function countOutOfOrder(rows) {
  let bad = 0
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1]
    const next = rows[i]
    if (!prev || !next) continue
    if (prev.time > next.time) bad += 1
  }
  return bad
}

/**
 * Put the file back in ascending time order WITHOUT deleting, formatting or
 * re-encoding anything: the original line bytes are only permuted, and the
 * header/BOM bytes are written back untouched. This is the repair for a file
 * that another program (Excel, a stale DSH instance) left in the wrong order.
 */
export async function normalizeCsvFile(filePath) {
  let buffer
  try {
    buffer = await fs.readFile(filePath)
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, rows: 0, moved: 0, encoding: 'missing', changed: false }
    throw err
  }
  const encoding = bufferEncoding(buffer)
  const rawLines = splitBufferLines(buffer)
  const kept = []
  let header = null
  let metaLine = null
  for (const line of rawLines) {
    if (line.length === 0) continue
    const text = decode(line)
    if (text.trim() === '') continue
    const firstCell = text.split(/[,\t]+/)[0].trim()
    if (!metaLine && text.trim().startsWith(META_PREFIX)) {
      metaLine = line
      continue
    }
    if (header === null && !looksLikeTime(firstCell)) {
      header = line
      continue
    }
    const cells = text.split(/[,\t]+/)
    const time = normalizeTime(firstCell)
    const rawKind = (cells[1] || '').trim()
    const kind = KIND_ALIASES[rawKind] || rawKind || KIND_DS
    kept.push({ line, ok: looksLikeTime(time), time, kind })
  }
  const parseable = kept.filter((item) => item.ok)
  const sorted = parseable
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => {
      if (a.time !== b.time) return a.time < b.time ? -1 : 1
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
      return a.index - b.index
    })
  const moved = sorted.filter((item, index) => item.index !== index).length
  const ordered = sorted.map((item) => item.line).concat(kept.filter((item) => !item.ok).map((item) => item.line))
  if (moved === 0) return { ok: true, rows: kept.length, moved: 0, encoding, changed: false }
  const head = header ?? Buffer.from(BOM + CSV_HEADER.join(','), 'utf8')
  const parts = metaLine ? [metaLine, head] : [head]
  for (const line of ordered) parts.push(line)
  const body = Buffer.concat(
    parts.flatMap((part, index) => (index === 0 ? [part] : [Buffer.from('\r\n', 'ascii'), part])).concat([Buffer.from('\r\n', 'ascii')]),
  )
  await writeBufferAtomic(filePath, body)
  return { ok: true, rows: kept.length, moved, encoding, changed: true }
}

async function writeAtomic(filePath, text) {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  await fs.writeFile(tmp, text, 'utf8')
  let lastError = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.rename(tmp, filePath)
      return
    } catch (err) {
      lastError = err
      if (!err || !RETRYABLE.has(err.code)) break
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
    }
  }
  try {
    await fs.rm(tmp, { force: true })
  } catch {
    /* best effort cleanup */
  }
  if (lastError && RETRYABLE.has(lastError.code)) {
    const locked = new Error(
      'CSV 文件正被其他程序占用（多半是被 Excel 打开了）：' +
        String(filePath) +
        ' —— 关掉它再采样/出图即可，已采到的数据不会丢。',
    )
    locked.code = 'csv_locked'
    locked.cause = lastError
    throw locked
  }
  throw lastError ?? new Error('write failed')
}

/** Same as `writeAtomic`, but takes raw bytes so the file's encoding is kept. */
export async function writeBufferAtomic(filePath, buffer) {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  await fs.writeFile(tmp, buffer)
  let lastError = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.rename(tmp, filePath)
      return
    } catch (err) {
      lastError = err
      if (!err || !RETRYABLE.has(err.code)) break
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
    }
  }
  try {
    await fs.rm(tmp, { force: true })
  } catch {
    /* best effort cleanup */
  }
  if (lastError && RETRYABLE.has(lastError.code)) {
    const locked = new Error(
      'CSV 文件正被其他程序占用（多半是被 Excel 打开了）：' +
        String(filePath) +
        ' —— 关掉它再整理/出图即可，已采到的数据不会丢。',
    )
    locked.code = 'csv_locked'
    locked.cause = lastError
    throw locked
  }
  throw lastError ?? new Error('write failed')
}

/**
 * How many data rows a CSV file currently holds (0 when it does not exist).
 * Counts lines instead of parsing so the guard below stays cheap.
 */
async function countDataRows(filePath) {
  try {
    const buffer = await fs.readFile(filePath)
    const text = decode(buffer)
    let count = 0
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      const cells = line.split(',')
      if (cells[0] === '时间' || cells[0].toLowerCase() === 'time') continue
      count += 1
    }
    return count
  } catch (err) {
    if (err && err.code === 'ENOENT') return 0
    throw err
  }
}

/**
 * Full-file rewrite, used ONLY for one-off migration / test fixtures — never
 * by the 15-minute sampling path (which uses appendCsvRow). A >40% shrink still
 * leaves a backup, but no sidecar is involved: one CSV, one source of truth.
 */
export async function writeCsvFile(filePath, rows) {
  const finalRows = Array.isArray(rows) ? rows : []
  const nextCount = finalRows.length
  const prevCount = await countDataRows(filePath)
  if (prevCount >= 20 && nextCount < prevCount * 0.6) {
    try {
      await fs.copyFile(filePath, `${filePath}.bak-shrink-${Date.now()}`)
    } catch {
      /* 备份失败也要让主写入继续：宁可丢备份，不要卡住采样 */
    }
  }
  await writeAtomic(filePath, serializeCsv(finalRows))
}

/**
 * Cheap view model for the settings page / tool card, split by kind.
 * `latestBalance`/`latestTime` keep their old meaning for the DS side so
 * existing callers that read them for "DS 余额" keep working. Order-independent:
 * the latest row per kind is chosen by max timestamp, not by array position.
 */
export function summarize(rows) {
  const list = Array.isArray(rows) ? rows : []
  const ds = list.filter((row) => row.kind === KIND_DS)
  const wb = list.filter((row) => row.kind === KIND_WB)
  const aliyun = list.filter((row) => row.kind === KIND_ALIYUN)
  const ut = list.filter((row) => row.kind === KIND_UT)
  const days = new Set(list.map((row) => row.time.slice(0, 10)))
  const latestOf = (group) => {
    let best = null
    for (const row of group) {
      if (!best || row.time > best.time) best = row
    }
    return best ? { time: best.time, value: best.value } : null
  }
  const latestDs = latestOf(ds)
  const latestWb = latestOf(wb)
  const latestAliyun = latestOf(aliyun)
  const latestUt = latestOf(ut)
  // ut 行是增量：总量 = 全表相加（不会被后来的「更小的一条」打回去）。
  const utTotal = ut.reduce((sum, row) => sum + (Number(row.value) || 0), 0)
  const overall = latestOf(list)
  return {
    count: list.length,
    days: days.size,
    dsCount: ds.length,
    wbCount: wb.length,
    aliyunCount: aliyun.length,
    utCount: ut.length,
    latestDs,
    latestWb,
    latestAliyun,
    latestUt,
    utTotal: Math.round(utTotal),
    // DS-side aliases (kept for backwards compatibility).
    latestTime: latestDs ? latestDs.time : overall ? overall.time : null,
    latestBalance: latestDs ? latestDs.value : null,
  }
}
