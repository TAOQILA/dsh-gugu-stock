#!/usr/bin/env node
/**
 * Migrate the 谷谷股 balances CSV to the 3-column format (v2):
 *
 *   时间,ds/wb,数值
 *
 * and merge the WorkBuddy history from wb-import.csv into it.
 *
 * - The CSV lives at %DSH_HOME%\data\gugu-stock\balances-v2.csv by default
 *   (the v1 name balances.csv is only read once, for migration);
 *   override with GUGU_STOCK_DIR or --dir.
 * - A 2-column legacy file (时间,余额, DS only) is upgraded in place; rows
 *   become kind='ds'.
 * - wb-import.csv sits next to this script and uses the same 3-column shape.
 * - Merging is upsert-by-(time,kind): rows that already exist are replaced
 *   with the import value (so re-runs are idempotent), everything else is
 *   inserted; the file is re-sorted oldest-first (ascending) at the end.
 * - A backup of the pre-migration file is written next to it unless --no-backup.
 * - --dry-run only prints what would change without touching the file.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  CSV_FILE_NAME,
  KIND_DS,
  KIND_WB,
  parseCsv,
  serializeCsv,
  upsertList,
} from '../lib/csv.js'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const IMPORT_FILE = path.join(ROOT, 'tools', 'wb-import.csv')

function usage() {
  console.log(`用法: node tools/migrate-3col.mjs [--dir <dataDir>] [--dry-run] [--no-backup] [--quiet]`)
}

async function main() {
  const args = process.argv.slice(2)
  let dir = process.env.GUGU_STOCK_DIR || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'data', 'gugu-stock')
  let dryRun = false
  let backup = true
  let quiet = false
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--dir') dir = args[++i]
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--no-backup') backup = false
    else if (arg === '--quiet') quiet = true
    else if (arg === '-h' || arg === '--help') return usage()
    else {
      console.error(`未知参数: ${arg}`)
      return usage()
    }
  }

  const csvPath = path.join(dir, CSV_FILE_NAME)
  const log = (msg) => {
    if (!quiet) console.log(msg)
  }

  const existing = await fs.readFile(csvPath, 'utf8').then(
    (text) => parseCsv(text),
    (err) => (err && err.code === 'ENOENT' ? [] : Promise.reject(err)),
  )

  let importRows = []
  try {
    importRows = parseCsv(await fs.readFile(IMPORT_FILE, 'utf8'))
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      log(`未找到 ${IMPORT_FILE}，仅做列格式迁移。`)
    } else {
      throw err
    }
  }

  const dsBefore = existing.filter((r) => r.kind === KIND_DS).length
  const wbBefore = existing.filter((r) => r.kind === KIND_WB).length
  const merged = upsertList(existing, importRows)
  const dsAfter = merged.filter((r) => r.kind === KIND_DS).length
  const wbAfter = merged.filter((r) => r.kind === KIND_WB).length

  const changed = dsAfter + wbAfter !== existing.length || JSON.stringify(merged) !== JSON.stringify(existing)

  log(`现有: ${existing.length} 行 (ds=${dsBefore}, wb=${wbBefore})`)
  log(`导入: ${importRows.length} 行 wb 历史 (${IMPORT_FILE})`)
  log(`迁移后: ${merged.length} 行 (ds=${dsAfter}, wb=${wbAfter})`)

  if (!changed) {
    log('无变化，文件已是最新 3 列格式。')
    return
  }

  if (dryRun) {
    log('[dry-run] 未写盘。预览前 5 行：')
    for (const row of merged.slice(0, 5)) log(`  ${row.time},${row.kind},${row.value}`)
    return
  }

  await fs.mkdir(dir, { recursive: true })
  if (backup) {
    const stamp = new Date().toISOString().replace(/[-:TZ]/g, '').slice(0, 14)
    const bak = path.join(dir, `${CSV_FILE_NAME}.bak-3col-${stamp}`)
    await fs.copyFile(csvPath, bak)
    log(`备份: ${bak}`)
  }

  await fs.writeFile(csvPath, serializeCsv(merged), 'utf8')
  log(`已写 ${csvPath} (${merged.length} 行) — v2 三列格式`)
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err && err.stack ? err.stack : String(err))
    process.exit(1)
  },
)