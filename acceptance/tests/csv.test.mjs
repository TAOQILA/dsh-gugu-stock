import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import path from 'node:path'
import { PLUGIN } from './_plugin-path.mjs'
const MODULE = path.join(PLUGIN, 'lib', 'csv.js')

const {
  BOM,
  CSV_HEADER,
  KIND_ALIYUN,
  KIND_DS,
  KIND_WB,
  appendCsvRow,
  appendCsvRows,
  balanceText,
  displayValue,
  formatTimestamp,
  normalizeTime,
  parseCsv,
  readCsvFile,
  readCsvFileWithMeta,
  readMeta,
  serializeCsv,
  summarize,
  upsertList,
  upsertTop,
  writeCsvFile,
  writeMetaLine,
} = await import('file://' + MODULE)

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gugu-csv-'))
}

test('the Aliyun kind is written as `al` and the long marker still parses', () => {
  assert.equal(KIND_ALIYUN, 'al', 'column 2 should carry the short marker')
  assert.deepEqual(CSV_HEADER, ['时间', '来源', '数值'])
  const text = serializeCsv([
    { time: '2026-11-22 16:44:00', kind: KIND_ALIYUN, value: 269.03 },
    { time: '2026-11-22 16:44:00', kind: KIND_DS, value: 15.92 },
  ])
  assert.ok(text.includes('\r\n2026-11-22 16:44:00,al,269.03\r\n'), 'Aliyun rows must be written as `al`')
  // 旧文件兼容：v1.12 开发期曾写过 `aliyun`，读进来仍算阿里云卡券。
  const legacy = CSV_HEADER.join(',') + '\r\n2026-11-22 16:44:00,aliyun,269.03\r\n'
  const parsed = parseCsv(BOM + legacy)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].kind, KIND_ALIYUN, 'the long marker should be read as the Aliyun kind')
  assert.equal(parsed[0].value, 269.03)
})

test('serializeCsv writes a BOM, the三列 header and CRLF lines', () => {
  const text = serializeCsv([
    { time: '2026-11-21 14:05:09', kind: KIND_DS, value: 7.5 },
    { time: '2026-11-21 14:00:00', kind: KIND_WB, value: 1008.4 },
  ])
  assert.equal(text[0], BOM)
  const body = text.slice(1)
  assert.ok(body.startsWith(CSV_HEADER.join(',') + '\r\n'))
  assert.ok(body.includes('\r\n2026-11-21 14:05:09,ds,7.5\r\n'))
  assert.ok(body.endsWith('\r\n2026-11-21 14:00:00,wb,1008.4\r\n'))
})

test('parseCsv round-trips three columns and still reads the legacy two-column file', () => {
  const rows = [
    { time: '2026-11-21 14:05:09', kind: KIND_DS, value: 7.5 },
    { time: '2026-11-21 14:00:00', kind: KIND_WB, value: 1008.4 },
  ]
  assert.deepEqual(parseCsv(serializeCsv(rows)), rows)

  const legacy = parseCsv(BOM + '时间,余额\r\n2026-11-21 13:00,8.25\r\n')
  assert.deepEqual(legacy, [{ time: '2026-11-21 13:00:00', kind: KIND_DS, value: 8.25 }])

  assert.deepEqual(parseCsv(''), [])
  assert.deepEqual(parseCsv(BOM + '时间,ds/wb,数值\r\n'), [])
})

test('upsertTop appends at the END, skips exact duplicates and keeps same-minute kinds', () => {
  const seed = [{ time: '2026-11-21 10:00:00', kind: KIND_DS, value: 8 }]
  const newer = upsertTop(seed, { time: '2026-11-21 10:15:00', kind: KIND_DS, value: 7.5 })
  assert.deepEqual(newer.map((row) => row.time), ['2026-11-21 10:00:00', '2026-11-21 10:15:00'])

  const duplicate = upsertTop(newer, { time: '2026-11-21 10:15:00', kind: KIND_DS, value: 7.25 })
  assert.equal(duplicate.length, 2, 'an existing (time, kind) is skipped, never replaced/deleted')
  assert.equal(duplicate[1].value, 7.5, 'the original value stays untouched')

  const both = upsertTop(duplicate, { time: '2026-11-21 10:15:00', kind: KIND_WB, value: 900 })
  assert.equal(both.length, 3)
  const sameMinute = both.filter((row) => row.time === '2026-11-21 10:15:00')
  assert.deepEqual(sameMinute.map((row) => row.kind).sort(), ['ds', 'wb'])
})

test('upsertList merges a batch, dedupes by (time, kind) and sorts oldest first', () => {
  const merged = upsertList(
    [{ time: '2026-11-21 10:00:00', kind: KIND_DS, value: 8 }],
    [
      { time: '2026-11-21 09:00:00', kind: KIND_WB, value: 1000 },
      { time: '2026-11-21 10:15:00', kind: KIND_DS, value: 7.5 },
      { time: '2026-11-21 10:15:00', kind: KIND_DS, value: 7.4 },
    ],
  )
  assert.deepEqual(
    merged.map((row) => row.time + ' ' + row.kind),
    ['2026-11-21 09:00:00 wb', '2026-11-21 10:00:00 ds', '2026-11-21 10:15:00 ds'],
  )
  assert.equal(merged[2].value, 7.4)
})

test('balanceText keeps six decimals, displayValue keeps at most one', () => {
  assert.equal(balanceText(7.762564), '7.762564')
  assert.equal(balanceText(8), '8')
  assert.equal(balanceText('¥ 1,200.500000'), '1200.5')
  assert.equal(displayValue(1008.4), '1008.4')
  assert.equal(displayValue(1008), '1008')
  assert.equal(displayValue(7.762564), '7.8')
})

test('formatTimestamp carries seconds and normalizeTime pads missing ones', () => {
  assert.equal(formatTimestamp(new Date(2026, 10, 21, 14, 5, 33)), '2026-11-21 14:05:33')
  assert.equal(normalizeTime('2026-11-21 14:05'), '2026-11-21 14:05:00')
  assert.equal(normalizeTime('2026/11/21 14:05:09'), '2026-11-21 14:05:09')
})

test('writeCsvFile then readCsvFile keeps rows in the given order', async () => {
  const dir = await tmpDir()
  const file = path.join(dir, 'balances.csv')
  await writeCsvFile(file, [])
  assert.deepEqual(await readCsvFile(file), [])

  const rows = [
    { time: '2026-11-21 10:15:09', kind: KIND_DS, value: 7.5 },
    { time: '2026-11-21 10:15:09', kind: KIND_WB, value: 960.25 },
    { time: '2026-11-21 10:00:00', kind: KIND_DS, value: 8 },
  ]
  await writeCsvFile(file, rows)
  assert.deepEqual(await readCsvFile(file), rows)

  const raw = await fs.readFile(file, 'utf8')
  assert.equal(raw[0], BOM)
  assert.ok(raw.includes('\r\n'))

  const summary = summarize(await readCsvFile(file))
  assert.equal(summary.count, 3)
  assert.equal(summary.days, 1)
  assert.equal(summary.dsCount, 2)
  assert.equal(summary.wbCount, 1)
  assert.deepEqual(summary.latestDs, { time: '2026-11-21 10:15:09', value: 7.5 })
  assert.deepEqual(summary.latestWb, { time: '2026-11-21 10:15:09', value: 960.25 })
  // 旧字段是 DS 的别名，老调用方还能读
  assert.equal(summary.latestBalance, 7.5)
  assert.equal(summary.latestTime, '2026-11-21 10:15:09')
})

test('readCsvFile tolerates a GBK (Chinese ANSI) file and a missing file', async () => {
  const dir = await tmpDir()
  const file = path.join(dir, 'gbk.csv')
  const gbk = Buffer.from([0xca, 0xb1, 0xbc, 0xe4, 0x2c, 0xd3, 0xe0, 0xb6, 0xee, 0x0d, 0x0a])
  await fs.writeFile(file, gbk)
  assert.deepEqual(await readCsvFile(file), [])
  assert.equal(await fs.readFile(file).then((buffer) => buffer[0]), 0xca)

  assert.deepEqual(await readCsvFile(path.join(dir, 'nope.csv')), [])
})

test('a write that shrinks the file by more than 40% leaves a .bak-shrink copy first', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-csv-shrink-'))
  const file = path.join(dir, 'balances-v2.csv')
  const many = Array.from({ length: 100 }, (_v, i) => ({
    time: `2026-11-${String((i % 20) + 1).padStart(2, '0')} 10:00:00`,
    kind: 'ds',
    value: 10 + i,
  }))
  await writeCsvFile(file, many)
  const after = await readCsvFile(file)
  assert.equal(after.length, 100)

  // 模拟「被别的程序整片截断」：只剩 3 行。写前必须留一份 100 行的后备。
  await writeCsvFile(file, after.slice(0, 3))
  const names = await fs.readdir(dir)
  const backup = names.find((name) => name.startsWith('balances-v2.csv.bak-shrink-'))
  assert.ok(backup, 'a shrinking write must leave a .bak-shrink file behind')
  const kept = await readCsvFile(path.join(dir, backup))
  assert.equal(kept.length, 100, 'the backup must hold the pre-shrink history')
})

test('sampling is append-only: existing rows are never removed or reordered', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-csv-append-'))
  const file = path.join(dir, 'balances-v2.csv')
  const base = [
    { time: '2026-11-11 13:47:00', kind: 'ds', value: 15.12 },
    { time: '2026-11-11 14:22:00', kind: 'al', value: 300 }, // 用户手加的一行
    { time: '2026-11-22 18:00:00', kind: 'ds', value: 15 },
  ]
  await writeCsvFile(file, base)
  const before = await fs.readFile(file, 'utf8')

  // 4 次采样：一条重复 (time,kind) 会跳过，另外三条追加在末尾。
  await appendCsvRow(file, { time: '2026-11-11 14:22:00', kind: 'al', value: 999 })
  const afterDup = await fs.readFile(file, 'utf8')
  assert.equal(afterDup, before, 'a duplicate (time, kind) is skipped, file byte-identical')

  await appendCsvRow(file, { time: '2026-11-22 18:05:00', kind: 'wb', value: 900 })
  await appendCsvRows(file, [
    { time: '2026-11-22 18:05:00', kind: 'al', value: 123.45 },
    { time: '2026/11/11 14:23', kind: 'al', value: 299 }, // 斜杠日期、无秒
  ])
  const after = await fs.readFile(file, 'utf8')
  assert.ok(after.startsWith(before.trimEnd()), 'the original bytes are kept verbatim as a prefix')
  const rows = await readCsvFile(file)
  assert.equal(rows.length, 6, 'three new rows appended, duplicate skipped')
  assert.ok(
    rows.some((r) => r.time === '2026-11-11 14:22:00' && r.kind === 'al' && r.value === 300),
    'the hand-added row survives untouched',
  )
  assert.deepEqual(
    rows.slice(-3).map((r) => r.time),
    ['2026-11-22 18:05:00', '2026-11-22 18:05:00', '2026-11-11 14:23:00'],
    'new rows are appended at the bottom in arrival order (no reordering)',
  )
  // No second data source: no sidecar file exists.
  assert.equal(
    (await fs.readdir(dir)).filter((n) => n.endsWith('.sticky')).length,
    0,
    'there must be no sticky sidecar',
  )
})

test('parseCsv accepts Tab-separated cells (Excel paste)', () => {
  const rows = parseCsv(
    '\uFEFF时间,来源,数值\r\n2026/11/11 14:22\tal\t300\r\n2026-11-22 18:00:00,ds,15\r\n',
  )
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { time: '2026-11-11 14:22:00', kind: 'al', value: 300 })
})

test('normalizeCsvFile only reorders: no row lost, encoding and bytes kept', async () => {
  const { normalizeCsvFile, countOutOfOrder } = await import('file://' + MODULE)
  const dir = await tmpDir()
  const file = path.join(dir, 'gbk.csv')
  // Excel 回写的形态：GBK、斜杠日期、无秒、且 4 行 22 日被挪到了最顶部。
  const body = [
    '时间,来源,数值',
    '2026/11/22 19:41,wb,891.210007',
    '2026/11/22 19:41,ds,15.450678',
    '2026/11/22 19:41,al,123.45',
    '2026/11/10 1:34,ds,9.1',
    '2026/11/11 14:22,al,300',
  ].join('\r\n') + '\r\n'
  const gbk = Buffer.from(
    // 用 iconv 不可得，直接构造：ASCII 部分原样，中文表头用 GBK 字节
    '\u0000',
  )
  // 手工拼：表头 GBK 字节 + 纯 ASCII 数据行
  const headerGbk = Buffer.from([0xca, 0xb1, 0xbc, 0xe4, 0x2c, 0xc0, 0xb4, 0xd4, 0xb4, 0x2c, 0xca, 0xfd, 0xd6, 0xb5, 0x0d, 0x0a])
  const rest = Buffer.from(body.split('\r\n').slice(1).join('\r\n'), 'latin1')
  await fs.writeFile(file, Buffer.concat([headerGbk, rest]))

  const before = await fs.readFile(file)
  const rowsBefore = await readCsvFile(file)
  assert.equal(rowsBefore.length, 5)
  assert.equal(countOutOfOrder(rowsBefore), 1, 'the 11-22 block above 11-10 is one inversion')

  const result = await normalizeCsvFile(file)
  assert.equal(result.ok, true)
  assert.equal(result.encoding, 'gbk', 'the file stays GBK (Excel ANSI)')
  assert.equal(result.changed, true)

  const after = await fs.readFile(file)
  const rowsAfter = await readCsvFile(file)
  assert.equal(rowsAfter.length, 5, 'not a single row is dropped')
  assert.equal(countOutOfOrder(rowsAfter), 0, 'rows are now oldest-first')
  assert.deepEqual(
    rowsAfter.map((r) => r.time),
    [
      '2026-11-10 01:34:00',
      '2026-11-11 14:22:00',
      '2026-11-22 19:41:00',
      '2026-11-22 19:41:00',
      '2026-11-22 19:41:00',
    ],
  )
  assert.ok(after.subarray(0, 16).equals(before.subarray(0, 16)), 'the GBK header bytes are kept')
  assert.equal(after.length, before.length, 'same byte count: only the order changed')

  // 第二次运行应当是 no-op。
  const again = await normalizeCsvFile(file)
  assert.equal(again.changed, false, 'an already tidy file is left untouched')
})

test('dedupeMinute collapses repeat samples inside the same minute', async () => {
  const dir = await tmpDir()
  const file = path.join(dir, 'minute.csv')
  await writeCsvFile(file, [{ time: '2026-11-22 19:41:56', kind: 'ds', value: 15.45 }])

  const sameMinute = await appendCsvRow(
    file,
    { time: '2026-11-22 19:41:59', kind: 'ds', value: 15.45 },
    { dedupeMinute: true },
  )
  assert.equal(sameMinute.length, 1, 'a second ds within 19:41 is skipped')
  assert.equal((await readCsvFile(file)).length, 1)

  const otherKind = await appendCsvRow(
    file,
    { time: '2026-11-22 19:41:30', kind: 'wb', value: 891.2 },
    { dedupeMinute: true },
  )
  assert.equal(otherKind.length, 2, 'a different source in the same minute is still recorded')
  assert.equal((await readCsvFile(file)).length, 2)

  const nextMinute = await appendCsvRow(
    file,
    { time: '2026-11-22 19:42:01', kind: 'ds', value: 15.45 },
    { dedupeMinute: true },
  )
  assert.equal(nextMinute.length, 3, 'the next minute writes normally')
  assert.equal((await readCsvFile(file)).length, 3)
})

test('the panel settings live inside the csv as a `#gugu` line', async () => {
  const rows = [
    { time: '2026-11-22 10:00:00', kind: KIND_DS, value: 15.5 },
    { time: '2026-11-22 10:00:00', kind: 'ut', value: 1200 },
  ]
  const meta = { version: 1, theme: 'dark', colorMode: 'source', sources: { ds: true, ut: true }, scales: { ds: 100, ut: 5000000 } }
  const text = serializeCsv(rows, meta)
  assert.ok(text.startsWith(BOM + '#gugu '), 'the meta line comes right after the BOM')
  assert.deepEqual(readMeta(text), meta)
  // 设置那一行不会被当成数据
  assert.deepEqual(parseCsv(text).map((row) => [row.kind, row.value]), [['ds', 15.5], ['ut', 1200]])

  const dir = await tmpDir()
  const file = path.join(dir, 'balances-v2.csv')
  await fs.writeFile(file, text, 'utf8')
  const loaded = await readCsvFileWithMeta(file)
  assert.equal(loaded.rows.length, 2)
  assert.deepEqual(loaded.meta, meta)

  // 再写一次设置：数据行与表头都要原样留着，只换那一行
  const next = { ...meta, theme: 'light' }
  await writeMetaLine(file, next)
  const after = await readCsvFileWithMeta(file)
  assert.deepEqual(after.meta, next)
  assert.equal(after.rows.length, 2, 'rows survive a settings rewrite')
  assert.equal((text.match(/#gugu /g) || []).length, 1)
})
