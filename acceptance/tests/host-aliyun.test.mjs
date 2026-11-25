// 阿里云卡券这一路：密钥只进凭据库、不进 settings.json、不回显；/aliyun-test 的错误码与成功路径。
// 全程不联网：fetch 被替换成桩函数，凭据服务用内存假实现。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PLUGIN } from './_plugin-path.mjs'

async function freshModule(dataDir) {
  process.env.GUGU_STOCK_DIR = dataDir
  process.env.GUGU_OPEN_DRY = '1'
  delete process.env.GUGU_PYTHON
  const url = new URL('file://' + PLUGIN.replace(/\\/g, '/') + '/index.js?' + Date.now() + Math.random())
  return import(url.href)
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(body) {
      this.body = body
    },
  }
}

async function request(routes, method, pathname, body) {
  const res = fakeRes()
  const req = { method, url: pathname, headers: { 'content-type': 'application/json' } }
  if (body !== undefined) {
    const payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
    req[Symbol.asyncIterator] = async function* iterate() {
      yield payload
    }
  }
  await routes[0].handler(req, res)
  let json = null
  try {
    json = JSON.parse(res.body)
  } catch {
    json = null
  }
  return { status: res.statusCode, headers: res.headers, json, raw: res.body }
}

// DSH 凭据服务的最小替身：契约见 docs/DETAIL.md「凭据服务」。
function fakeCredentials() {
  const values = new Map()
  const writes = []
  return {
    values,
    writes,
    service: {
      async resolve(ref) {
        return values.has(ref) ? { value: values.get(ref), source: 'test' } : undefined
      },
      async describe(ref) {
        return { configured: values.has(ref), writable: true, masked: values.has(ref) ? 'LTAI****' : '' }
      },
      async set(ref, value) {
        if (!value) throw new Error('empty value')
        values.set(ref, value)
        writes.push(ref)
      },
      async unset(ref) {
        values.delete(ref)
      },
    },
  }
}

async function boot({ creds = fakeCredentials(), fetchImpl } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-aliyun-'))
  const mod = await freshModule(dir)
  const routes = []
  const ctx = {
    effect: (fn) => fn(),
    get(key) {
      if (key === 'credentials') return creds.service
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
  const savedFetch = globalThis.fetch
  if (fetchImpl) globalThis.fetch = fetchImpl
  const dispose = mod.apply(ctx, undefined)
  dispose() // 掐掉启动定时器，测试绝不碰网络
  const restore = () => {
    globalThis.fetch = savedFetch
  }
  return { dir, routes, creds, restore }
}

function couponPayload(items) {
  return {
    ok: true,
    // 真实 BSS 响应就长这样：成功时 Code 也是 "Success"、Message 是 "Successful!"。
    text: async () =>
      JSON.stringify({
        Code: 'Success',
        Success: true,
        Message: 'Successful!',
        RequestId: 'RID-SUCCESS',
        Data: { CashCoupon: items },
      }),
  }
}

test('settings stores the access key in the credentials service and never in settings.json', async () => {
  const { dir, routes, creds, restore } = await boot()
  try {
    const saved = await request(routes, 'POST', '/gugu-stock/api/settings', {
      aliyun: { couponId: '123456789012', subAccount: 'gugu-readonly@x.onaliyun.com' },
      aliyunSecret: { accessKeyId: 'LTAI_TEST_ID', accessKeySecret: 'SECRET_TEST_VALUE' },
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.json.ok, true)
    assert.deepEqual(creds.writes.sort(), ['ALIYUN_ACCESS_KEY_ID', 'ALIYUN_ACCESS_KEY_SECRET'])
    assert.equal(creds.values.get('ALIYUN_ACCESS_KEY_ID'), 'LTAI_TEST_ID')

    const settingsRaw = await fs.readFile(path.join(dir, 'settings.json'), 'utf8')
    assert.ok(!settingsRaw.includes('SECRET_TEST_VALUE'), 'settings.json 不得包含 AccessKey Secret')
    assert.ok(!settingsRaw.includes('LTAI_TEST_ID'), 'settings.json 不得包含 AccessKey ID')
    assert.ok(settingsRaw.includes('123456789012'), 'settings.json 应该记住卡券编号')

    const state = await request(routes, 'GET', '/gugu-stock/api/state')
    assert.equal(state.json.aliyun.hasAccessKeyId, true)
    assert.equal(state.json.aliyun.hasAccessKeySecret, true)
    assert.equal(state.json.aliyun.couponId, '123456789012')
    assert.ok(!state.raw.includes('SECRET_TEST_VALUE'), 'state 不得回显 Secret')
    assert.ok(!state.raw.includes('LTAI_TEST_ID'), 'state 不得回显 AccessKey ID 明文')
  } finally {
    restore()
  }
})

test('aliyun-test complains about the missing AccessKey first', async () => {
  const { routes, restore } = await boot()
  try {
    const res = await request(routes, 'POST', '/gugu-stock/api/aliyun-test', {})
    assert.equal(res.status, 400)
    assert.equal(res.json.ok, false)
    assert.equal(res.json.error.code, 'aliyun_credentials_missing')
  } finally {
    restore()
  }
})

test('aliyun-test asks for the coupon id once the key is in place', async () => {
  const { routes, restore } = await boot()
  try {
    await request(routes, 'POST', '/gugu-stock/api/settings', {
      aliyunSecret: { accessKeyId: 'LTAI_TEST_ID', accessKeySecret: 'SECRET_TEST_VALUE' },
    })
    const res = await request(routes, 'POST', '/gugu-stock/api/aliyun-test', {})
    assert.equal(res.status, 400)
    assert.equal(res.json.error.code, 'aliyun_coupon_missing')
  } finally {
    restore()
  }
})

test('aliyun-test reports missing credentials when only the coupon id is configured', async () => {
  const { routes, restore } = await boot()
  try {
    await request(routes, 'POST', '/gugu-stock/api/settings', {
      aliyun: { couponId: '123456789012', subAccount: 'gugu-readonly@x.onaliyun.com' },
    })
    const res = await request(routes, 'POST', '/gugu-stock/api/aliyun-test', {})
    assert.equal(res.status, 400)
    assert.equal(res.json.error.code, 'aliyun_credentials_missing')
  } finally {
    restore()
  }
})

test('aliyun-test reads the coupon balance with a signed QueryCashCoupons call', async () => {
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(String(url))
    return couponPayload([
      { CashCouponId: 123456789012, CashCouponNo: 'Q-abc', Balance: '269.03', NominalValue: '300.00', Status: 'Available', ExpiryTime: '2027-11-11T12:00:00Z' },
    ])
  }
  const { routes, restore } = await boot({ fetchImpl })
  try {
    const ok = await request(routes, 'POST', '/gugu-stock/api/settings', {
      aliyun: { couponId: '123456789012', subAccount: 'gugu-readonly@x.onaliyun.com' },
      aliyunSecret: { accessKeyId: 'LTAI_TEST_ID', accessKeySecret: 'SECRET_TEST_VALUE' },
    })
    assert.equal(ok.status, 200)

    const res = await request(routes, 'POST', '/gugu-stock/api/aliyun-test', {})
    assert.equal(res.status, 200, res.raw)
    assert.equal(res.json.ok, true)
    assert.equal(res.json.balance, 269.03)
    assert.equal(res.json.couponId, '123456789012')
    assert.equal(res.json.status, 'Available')
    assert.equal(seen.length, 1)
    const url = new URL(seen[0])
    assert.equal(url.hostname, 'business.aliyuncs.com')
    assert.equal(url.searchParams.get('Action'), 'QueryCashCoupons')
    assert.equal(url.searchParams.get('Version'), '2017-12-14')
    assert.equal(url.searchParams.get('SignatureMethod'), 'HMAC-SHA1')
    assert.ok(url.searchParams.get('Signature'), '必须带签名')
  } finally {
    restore()
  }
})

test('aliyun-test turns a NotAuthorized reply into actionable permission advice', async () => {
  const fetchImpl = async () => ({
    ok: false,
    text: async () => JSON.stringify({ Code: 'NotAuthorized', Message: 'This API is not authorized for caller.', RequestId: 'RID' }),
  })
  const { routes, restore } = await boot({ fetchImpl })
  try {
    await request(routes, 'POST', '/gugu-stock/api/settings', {
      aliyun: { couponId: '123456789012', subAccount: 'gugu-readonly@x.onaliyun.com' },
      aliyunSecret: { accessKeyId: 'LTAI_TEST_ID', accessKeySecret: 'SECRET_TEST_VALUE' },
    })
    const res = await request(routes, 'POST', '/gugu-stock/api/aliyun-test', {})
    assert.equal(res.status, 400)
    assert.equal(res.json.error.code, 'aliyun_api_error')
    assert.match(res.json.error.message, /AliyunBSSReadOnlyAccess/)
  } finally {
    restore()
  }
})