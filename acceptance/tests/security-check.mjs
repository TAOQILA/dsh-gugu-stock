// C29 的安全断言：用户填进面板的阿里云 AccessKey 只能落进 DSH 凭据库，
// 绝不能出现在 settings.json，也不能被 /state 回显。
// 用内存凭据服务 + 临时数据目录，全程不联网。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { PLUGIN } from './_plugin-path.mjs'

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-sec-'))
  process.env.GUGU_STOCK_DIR = dir
  process.env.GUGU_OPEN_DRY = '1'
  delete process.env.GUGU_PYTHON

  const url = new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/index.js?' + Date.now())
  const mod = await import(url.href)

  const values = new Map()
  const credentials = {
    async resolve(ref) {
      return values.has(ref) ? { value: values.get(ref), source: 'test' } : undefined
    },
    async describe(ref) {
      return { configured: values.has(ref), writable: true, masked: values.has(ref) ? 'LTAI****' : '' }
    },
    async set(ref, value) {
      if (!value) throw new Error('empty')
      values.set(ref, value)
    },
    async unset(ref) {
      values.delete(ref)
    },
  }

  const routes = []
  const ctx = {
    effect: (fn) => fn(),
    get(key) {
      if (key === 'credentials') return credentials
      if (key === 'webServer') return ctx.webServer
      return undefined
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
      getOrigin: () => 'http://127.0.0.1:0',
    },
    connection: { requestRejection: () => undefined },
  }
  mod.apply(ctx, undefined)()

  async function call(method, pathname, body) {
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader() {},
      end(chunk) {
        this.body = chunk
      },
    }
    const req = { method, url: pathname, headers: { 'content-type': 'application/json' } }
    if (body !== undefined) {
      const payload = Buffer.from(JSON.stringify(body), 'utf8')
      req[Symbol.asyncIterator] = async function* iterate() {
        yield payload
      }
    }
    await routes[0].handler(req, res)
    return { status: res.statusCode, raw: res.body, json: JSON.parse(res.body) }
  }

  const saved = await call('POST', '/gugu-stock/api/settings', {
    aliyun: { couponId: '123456789012', subAccount: 'gugu-readonly@x.onaliyun.com' },
    aliyunSecret: { accessKeyId: 'AKID_PLAIN', accessKeySecret: 'AKSECRET_PLAIN' },
  })
  assert.equal(saved.status, 200, saved.raw)

  const settingsRaw = await fs.readFile(path.join(dir, 'settings.json'), 'utf8')
  assert.ok(!settingsRaw.includes('AKID_PLAIN'), 'settings.json must not contain the AccessKey ID')
  assert.ok(!settingsRaw.includes('AKSECRET_PLAIN'), 'settings.json must not contain the AccessKey Secret')
  assert.equal(values.get('ALIYUN_ACCESS_KEY_ID'), 'AKID_PLAIN', 'the key must land in the credentials store')
  assert.equal(values.get('ALIYUN_ACCESS_KEY_SECRET'), 'AKSECRET_PLAIN')

  const state = await call('GET', '/gugu-stock/api/state')
  assert.ok(!state.raw.includes('AKID_PLAIN'), 'state must not echo the AccessKey ID')
  assert.ok(!state.raw.includes('AKSECRET_PLAIN'), 'state must not echo the AccessKey Secret')
  assert.equal(state.json.aliyun.hasAccessKeyId, true)
  assert.equal(state.json.aliyun.hasAccessKeySecret, true)

  console.log('SECRETS_SAFE=true')
}

main().catch((err) => {
  console.error('SECRETS_SAFE=false', err && err.message)
  process.exit(1)
})