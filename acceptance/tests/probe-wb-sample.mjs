// 探针：用真实的 workbuddy 路由验证 WB 采样（写入临时目录，不动真机 CSV）。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PLUGIN } from './_plugin-path.mjs'
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-wb-probe-'));
process.env.GUGU_STOCK_DIR = tmp;
process.env.GUGU_OPEN_DRY = '1';
delete process.env.GUGU_PYTHON;

const routes = [];
const ctx = {
  effect: (fn) => fn(),
  get: (name) => {
    if (name === 'webServer') return { getOrigin: () => 'http://127.0.0.1:7080' }
    if (name === 'deepseekAccount') {
      return {
        getState: () => ({ userId: 'probe' }),
        getBalance: async () => ({
          status: 'ready',
          value: [{ currency: 'CNY', balance: 12.5 }],
          bonusWallets: [],
        }),
      }
    }
    return undefined
  },
  webServer: {
    getOrigin: () => 'http://127.0.0.1:7080',
    register(route) {
      routes.push(route);
      return () => {};
    },
  },
  connection: { requestRejection: () => undefined },
};

const mod = await import(pathToFileURL(path.join(PLUGIN, 'index.js')).href + '?' + Date.now());
const dispose = mod.apply(ctx, undefined);

async function post(sub) {
  const res = {
    statusCode: 0,
    body: '',
    headers: {},
    setHeader() {},
    end(body) {
      this.body = body;
    },
  };
  await routes[0].handler({ method: 'POST', url: '/gugu-stock/api' + sub, headers: {} }, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

const sampled = await post('/sample');
console.log('sample:', JSON.stringify(sampled));
const state = await post('/state');
console.log('state:', JSON.stringify({ rows: state.json.rows, dsCount: state.json.dsCount, wbCount: state.json.wbCount, latestWb: state.json.latestWb, latestWbTime: state.json.latestWbTime, lastWbOk: state.json.lastWbOk, lastWbError: state.json.lastWbError }));
const csv = await fs.readFile(path.join(tmp, 'balances-v2.csv'), 'utf8');
console.log('csv:\n' + csv.trim());
dispose();
await fs.rm(tmp, { recursive: true, force: true });