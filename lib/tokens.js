/**
 * 「ut」数据源 — 把本机 DSH 所有会话（含已归档会话）的 token 消耗加总。
 *
 * 会话日志在 `~/.dsh/sessions/<workspace>/<session>/session.v4.jsonl.zstd`。
 * 这些 `.zstd` 文件是**多帧追加**的（每写一批就 append 一个新帧），Node 的
 * `zlib.zstdDecompressSync()` 与流式解压都只吐第一帧，所以这里先扫帧魔数
 * `28 b5 2f fd` 把文件切成若干段，再逐帧解压拼起来。
 *
 * 计数口径：只认 `assistant/message` 行里的 `data.usage`，按 `(turn, step)`
 * 去重（同一步可能因为流式/重写出现多条，取最后一条），单步总量 =
 * inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
 * （`inputTokens` 是未命中缓存的输入，缓存命中的在 cacheReadTokens 里）。
 *
 * 全量解 71MB 太浪费，所以按「文件大小 + mtime」做缓存，只重解变过的会话。
 */
import fsSync from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const LOG_NAME = 'session.v4.jsonl.zstd'
const CACHE_VERSION = 2

function numberOrZero(value) {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

/** 一条 assistant/message 的 usage → 这一步消耗的 token 总数。 */
export function stepTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0
  const sum =
    numberOrZero(usage.inputTokens) +
    numberOrZero(usage.outputTokens) +
    numberOrZero(usage.cacheReadTokens) +
    numberOrZero(usage.cacheWriteTokens)
  if (sum > 0) return sum
  return numberOrZero(usage.totalTokens)
}

/**
 * 扫出多帧 zstd 里每一帧的起始偏移。
 * 魔数只有 4 字节，理论上可能在压缩数据里偶然出现；但每一帧都以魔数开头，
 * 且 `zstdDecompressSync` 对坏帧会抛错——这里遇到坏帧就跳过该候选偏移，
 * 继续找下一个，保证一个坏帧不会让整个会话读不出来。
 */
export function frameOffsets(buffer) {
  const offsets = []
  let index = buffer.indexOf(FRAME_MAGIC, 0)
  while (index >= 0) {
    offsets.push(index)
    index = buffer.indexOf(FRAME_MAGIC, index + FRAME_MAGIC.length)
  }
  if (offsets.length === 0 || offsets[0] !== 0) offsets.unshift(0)
  return offsets
}

/** 解压多帧 zstd 文件 → 一段完整文本（各帧内容按顺序拼接）。 */
export function decodeFrames(buffer) {
  const offsets = frameOffsets(buffer)
  const chunks = []
  let frames = 0
  let failed = 0
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i]
    const end = i + 1 < offsets.length ? offsets[i + 1] : buffer.length
    const slice = buffer.subarray(start, end)
    if (slice.length === 0) continue
    try {
      chunks.push(zlib.zstdDecompressSync(slice))
      frames += 1
    } catch {
      failed += 1
    }
  }
  return { text: Buffer.concat(chunks).toString('utf8'), frames, failed }
}

/** 解析日志文本 → 该会话的 token 总量。 */
export function sumSessionTokens(text) {
  const perStep = new Map()
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.length < 20 || line.indexOf('assistant/message') < 0) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!row || row.type !== 'assistant/message') continue
    const data = row.data
    if (!data || typeof data !== 'object') continue
    const tokens = stepTokens(data.usage)
    if (tokens <= 0) continue
    const key = String(data.turn) + ':' + String(data.step)
    perStep.set(key, tokens)
  }
  let total = 0
  for (const value of perStep.values()) total += value
  return { total, steps: perStep.size }
}

function fileStat(filePath) {
  try {
    const info = fsSync.statSync(filePath)
    return { size: info.size, mtimeMs: Math.round(info.mtimeMs) }
  } catch {
    return null
  }
}

function cacheIdentity(logPath) {
  // <sessions>/<workspace>/<session>/session.v4.jsonl.zstd → "workspace/session"：
  // 用相对身份而不是完整路径，工作区根目录搬家了也不会把同一个会话算成两个。
  const sessionDir = path.dirname(logPath)
  return path.basename(path.dirname(sessionDir)) + '/' + path.basename(sessionDir)
}

function readCache(cachePath) {
  try {
    const raw = JSON.parse(fsSync.readFileSync(cachePath, 'utf8'))
    if (!raw || typeof raw.files !== 'object' || !raw.files) return {}
    // 版本 1 的键是完整路径，版本 2 起是 "workspace/session"，两种都认。
    const legacy = raw.version !== CACHE_VERSION
    if (!legacy && raw.version !== CACHE_VERSION) return {}
    const out = {}
    for (const [key, entry] of Object.entries(raw.files)) {
      if (!entry || typeof entry !== 'object') continue
      const id = legacy ? cacheIdentity(key) : key
      const tokens = numberOrZero(entry.tokens)
      const seen = out[id]
      if (!seen || tokens > numberOrZero(seen.tokens)) {
        out[id] = {
          path: entry.path || (legacy ? key : ''),
          size: entry.size,
          mtimeMs: entry.mtimeMs,
          tokens,
          steps: entry.steps,
        }
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeCache(cachePath, files) {
  try {
    fsSync.mkdirSync(path.dirname(cachePath), { recursive: true })
    fsSync.writeFileSync(cachePath, JSON.stringify({ version: CACHE_VERSION, files }, null, 0), 'utf8')
  } catch {
    // 缓存写不进去不影响本次结果，下次重新算一遍就是了。
  }
}

/** 列出所有会话日志（含已归档会话：它们也在同一个 sessions 目录里）。 */
export function listSessionLogs(sessionsDir) {
  const out = []
  let workspaces
  try {
    workspaces = fsSync.readdirSync(sessionsDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue
    const workspaceDir = path.join(sessionsDir, workspace.name)
    let sessions
    try {
      sessions = fsSync.readdirSync(workspaceDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const logPath = path.join(workspaceDir, session.name, LOG_NAME)
      if (fsSync.existsSync(logPath)) out.push(logPath)
    }
  }
  return out
}

let inFlight = null

/**
 * 汇总所有会话的 token 总量。同一时刻只跑一次（15 分钟一次采样，重复调用罕见，
 * 但 `/state` 与 `/sample` 可能同时到）。
 *
 * @param {{sessionsDir?: string, cachePath?: string, force?: boolean}} options
 */
export async function totalTokens(options = {}) {
  if (inFlight && !options.force) return inFlight
  const run = (async () => {
    const sessionsDir = options.sessionsDir || ''
    const cachePath = options.cachePath || ''
    const previous = cachePath ? readCache(cachePath) : {}
    const kept = {}
    const logs = sessionsDir ? listSessionLogs(sessionsDir) : []
    let total = 0
    let redecoded = 0
    let reused = 0
    let remembered = 0
    let rememberedTokens = 0
    for (const logPath of logs) {
      const stat = fileStat(logPath)
      if (!stat) continue
      const id = cacheIdentity(logPath)
      const cached = previous[id]
      if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
        kept[id] = Object.assign({}, cached, { path: logPath })
        total += numberOrZero(cached.tokens)
        reused += 1
        continue
      }
      let buffer
      try {
        buffer = fsSync.readFileSync(logPath)
      } catch {
        continue
      }
      const { text } = decodeFrames(buffer)
      const { total: sessionTotal, steps } = sumSessionTokens(text)
      // 日志被截断/重写过时不要比上次记下的更少，否则总量会假下降。
      const tokens = Math.max(sessionTotal, numberOrZero(cached && cached.tokens))
      kept[id] = { path: logPath, size: stat.size, mtimeMs: stat.mtimeMs, tokens, steps }
      total += tokens
      redecoded += 1
    }
    // 以前统计过、这次却找不到的会话（被删掉、日志读不出来）：按最后一次记下的量继续计入。
    for (const [id, entry] of Object.entries(previous)) {
      if (kept[id]) continue
      kept[id] = entry
      const tokens = numberOrZero(entry.tokens)
      total += tokens
      if (tokens > 0) {
        remembered += 1
        rememberedTokens += tokens
      }
    }
    if (cachePath) writeCache(cachePath, kept)
    return {
      tokens: Math.round(total),
      sessions: logs.length,
      counted: Object.keys(kept).length,
      redecoded,
      reused,
      remembered,
      rememberedTokens: Math.round(rememberedTokens),
    }
  })()
  inFlight = run
  try {
    return await run
  } finally {
    inFlight = null
  }
}