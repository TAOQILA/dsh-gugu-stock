import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { PLUGIN } from './_plugin-path.mjs'
const read = (name) => fs.readFile(path.join(PLUGIN, name), 'utf8')
const json = async (name) => JSON.parse(await read(name))
const exists = async (name) => {
  try {
    await fs.access(path.join(PLUGIN, name))
    return true
  } catch {
    return false
  }
}

test('package.json declares a bundle patch plus a web client entry', async () => {
  const manifest = await json('package.json')
  assert.equal(manifest.name, 'dsh-gugu-stock')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['.'], './index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./icon'], './icon.svg')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'))
  assert.deepEqual(manifest.files, ['index.js', 'client.js', 'lib/', 'scripts/', 'locale/', 'icon.svg', 'docs/', 'README.md', 'cordis.patch.yml'])
  assert.ok(!manifest.engines, 'no engines gate that could block installation')
  assert.ok(!manifest.peerDependencies, 'no peer dependency gate')
})

test('cordis.patch.yml inserts exactly one entry named dsh-gugu-stock', async () => {
  const patch = await read('cordis.patch.yml')
  assert.match(patch, /^-\s*insert:/m)
  assert.match(patch, /id:\s*gugu-stock/)
  assert.match(patch, /name:\s*dsh-gugu-stock/)
  assert.equal((patch.match(/insert:/g) || []).length, 1)
})

test('every runtime file exists and stays inside the limit', async () => {
  for (const name of ['index.js', 'client.js', 'lib/csv.js', 'scripts/gugu_chart.py', 'locale/zh.json', 'locale/en.json', 'icon.svg', 'docs/DETAIL.md', 'README.md', 'cordis.patch.yml']) {
    assert.ok(await exists(name), name + ' is present')
  }
  const detail = await fs.stat(path.join(PLUGIN, 'docs/DETAIL.md'))
  assert.ok(detail.size < 1024 * 1024, 'DETAIL.md stays under 1 MiB')
  const icon = await fs.stat(path.join(PLUGIN, 'icon.svg'))
  assert.ok(icon.size < 256 * 1024, 'icon.svg stays under 256 KiB')
})

test('locale files carry the plugin meta plus the page strings', async () => {
  for (const lang of ['zh', 'en']) {
    const dict = await json('locale/' + lang + '.json')
    assert.equal(typeof dict.meta.title, 'string')
    assert.equal(typeof dict.meta.description, 'string')
    assert.equal(typeof dict.meta.detail, 'string')
    assert.equal(dict.meta.title.length > 0, true)
  }
})

// DSH reads locale meta without evaluating plugin code: package-meta.js requires a
// non-empty title/description, and plugin-detail document.js requires meta.detail to be
// a '/'-separated Markdown path inside the package that actually exists. Both failures
// surface in the GUI as “包元信息错误” / “插件声明的详细介绍文件无效”.
test('locale meta passes the DSH display-metadata rules', async () => {
  for (const lang of ['zh', 'en']) {
    const dict = await json('locale/' + lang + '.json')
    assert.ok(dict.meta.title.trim().length > 0, lang + ' meta.title must not be blank')
    assert.ok(dict.meta.description.trim().length > 0, lang + ' meta.description must not be blank')

    const detail = dict.meta.detail
    assert.ok(typeof detail === 'string' && detail.trim().length > 0, lang + ' meta.detail must be a non-empty string')
    assert.ok(!detail.includes('\\'), lang + ' meta.detail must use forward slashes')
    assert.ok(!/^[A-Za-z][A-Za-z\d+.-]*:/u.test(detail), lang + ' meta.detail must be a relative path')
    assert.ok(!detail.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'), lang + ' meta.detail must stay inside the package')
    assert.ok(/\.(?:md|markdown)$/iu.test(detail), lang + ' meta.detail must name a Markdown file')
    assert.ok(await exists(detail), lang + ' meta.detail file ' + detail + ' must exist')

    const markdown = await read(detail)
    assert.ok(markdown.trim().length > 0, lang + ' detail document must not be empty')
    assert.ok(!markdown.startsWith('\uFEFF'), lang + ' detail document must not start with a byte order mark')
  }
})

test('host module only exports apply/inject and no default', async () => {
  const source = await read('index.js')
  const exportsFound = [...source.matchAll(/^export\s+(?:const|function|default|class)\s+(\w+)/gm)].map((m) => m[1])
  assert.deepEqual(exportsFound.sort(), ['apply', 'inject'])
  assert.ok(!/^export default/m.test(source))
})

test('client bundle is a ModuleLoader factory that only requires react', async () => {
  const source = await read('client.js')
  assert.match(source, /^window\.__ModuleLoader__\.load\(/m)
  assert.match(source, /id:\s*'dsh-gugu-stock'/)
  const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(requires)], ['react'])
  assert.match(source, /name:\s*'settings\.section'/)
  assert.match(source, /name:\s*'settings\.section\.icon'/)
  assert.match(source, /id:\s*'gugu-stock'/)
  assert.match(source, /order:\s*30/)
  assert.ok(!/\bfetch\(\s*['"]\//.test(source), 'host calls are page-relative, never root-absolute')
  assert.ok(source.includes("new URL('.', document.baseURI)"))
})
