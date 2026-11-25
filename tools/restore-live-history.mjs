// 一次性修复：把多份快照并回真机 CSV（按 (time,kind) 去重，只增不删）。
// 用法：node dsh-gugu-stock/tools/restore-live-history.mjs <快照1.csv> [快照2.csv ...]
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { CSV_FILE_NAME, parseCsv, upsertList, readCsvFile, writeCsvFile, summarize } from '../lib/csv.js';

const dir = 'C:/Users/user/.dsh/data/gugu-stock';
// 数据文件已改名 balances-v2.csv（见 index.js 注释）
const live = path.join(dir, CSV_FILE_NAME);
const sources = process.argv.slice(2);

if (sources.length === 0) {
  console.error('用法：node dsh-gugu-stock/tools/restore-live-history.mjs <快照1.csv> [...]');
  process.exit(2);
}

const before = await readCsvFile(live);
let merged = before;
const report = [];
for (const source of sources) {
  const rows = parseCsv(readFileSync(source, 'utf8')).map((row) => ({
    time: row.time,
    kind: row.kind || 'ds',
    value: row.value,
  }));
  const next = upsertList(merged, rows);
  report.push({ source: path.basename(source), rows: rows.length, merged: next.length });
  merged = next;
}

await writeCsvFile(live, merged);
const summary = summarize(merged);
console.log(
  JSON.stringify(
    {
      before: before.length,
      sources: report,
      after: merged.length,
      ds: summary.dsCount,
      wb: summary.wbCount,
      latestDs: summary.latestDs,
      latestWb: summary.latestWb,
    },
    null,
    0,
  ),
);