import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { PLUGIN } from './_plugin-path.mjs'
// 折叠状态只存在浏览器本地，key 由 client.js 自己定义；测试按契约直接种进假 localStorage。
const CONFIG_KEY = 'gugu-stock.configOpen'

// A deliberately tiny React: enough hook runtime to call the panel component once
// outside a browser, then walk the element tree it returns. That makes the initial
// date values and the rendered copy observable without react-dom.
// `seed.sources` 让测试能在首屏就把某个数据源打开：真实浏览器里这件事由 Host 的
// /api/state 回填（useEffect），而这个迷你 React 的 useEffect 是空实现，只能从初值种入。
function miniReact(seed = {}) {
  const isSourcesShape = (value) =>
    value &&
    typeof value === 'object' &&
    ['ds', 'wb', 'aliyun', 'ut'].every((key) => typeof value[key] === 'boolean')
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity) }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      if (seed.sources && isSourcesShape(value)) return [{ ...value, ...seed.sources }, () => {}]
      return [value, () => {}]
    },
    useRef(initial) {
      return { current: initial }
    },
    useCallback(fn) {
      return fn
    },
    useEffect() {},
    useMemo(fn) {
      return fn()
    },
  }
  return React
}

function collect(node, out) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.text.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  if (node.type) out.elements.push(node)
  if (node.children) for (const child of node.children) collect(child, out)
  return out
}

function textOf(node) {
  const out = { text: [], elements: [] }
  collect(node, out)
  return out.text.join('')
}

function loadPanelComponent(options = {}) {
  const source = fs.readFileSync(path.join(PLUGIN, 'client.js'), 'utf8')
  const registered = []
  const slots = {
    inject(owner, factory) {
      factory()
      return () => {}
    },
    register(registration, component) {
      registered.push({ registration, component })
      return () => {}
    },
  }
  const React = miniReact({ sources: options.sources })
  // 真实的 localStorage 替身：既能种入「上次是展开的」，也能观察 setItem 写了哪个 key。
  const storage = new Map()
  if (options.configOpen) storage.set(CONFIG_KEY, '1')
  const sandbox = {
    window: {},
    document: { baseURI: 'http://127.0.0.1:9527/', documentElement: { lang: 'zh' }, addEventListener() {}, removeEventListener() {} },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null
      },
      setItem(key, value) {
        storage.set(key, String(value))
      },
      removeItem(key) {
        storage.delete(key)
      },
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    URL,
    Date,
    Math,
    JSON,
    String,
    Number,
    Object,
    Array,
    Boolean,
    RegExp,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  }
  sandbox.globalThis = sandbox
  sandbox.window = sandbox
  sandbox.window.__ModuleLoader__ = {
    load(spec) {
      sandbox.__spec = spec
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  const spec = sandbox.__spec
  assert.ok(spec, 'client bundle did not call window.__ModuleLoader__.load')
  const exportsObject = spec.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  exportsObject.apply({ slots })
  const section = registered.find(
    (item) => item.registration.name === 'settings.section' && item.registration.id === 'gugu-stock',
  )
  assert.ok(section, 'settings.section registration missing')
  return { component: section.component, storage, source }
}

function renderPanel(options = {}) {
  const loaded = loadPanelComponent(options)
  const out = { text: [], elements: [] }
  collect(loaded.component({}), out)
  const inputs = out.elements.filter((el) => el.type === 'input')
  const buttons = out.elements.filter((el) => el.type === 'button')
  return {
    html: out.text.join(''),
    source: loaded.source,
    storage: loaded.storage,
    elements: out.elements,
    inputs,
    dateInputs: inputs.filter((el) => el.props.type === 'date'),
    // 采样间隔输入框（data-gugu-interval）单独归类，不混进缩放输入框断言。
    numberInputs: inputs.filter((el) => el.props.type === 'number' && !el.props['data-gugu-interval']),
    intervalInputs: inputs.filter((el) => el.props['data-gugu-interval']),
    textInputs: inputs.filter((el) => el.props.type === 'text'),
    passwordInputs: inputs.filter((el) => el.props.type === 'password'),
    buttons,
    switches: out.elements.filter((el) => el.props.role === 'switch'),
  }
}

// 默认折叠 / 上次展开过，是两套不同的首屏；多数断言需要展开后的完整结构。
const collapsedPanel = () => renderPanel()
const expandedPanel = () => renderPanel({ configOpen: true })

const pad = (value) => String(value).padStart(2, '0')
function isoDay(offset) {
  const date = new Date()
  date.setDate(date.getDate() + (offset || 0))
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

test('the two date inputs start with real ISO dates in the expanded settings block', () => {
  const { dateInputs } = expandedPanel()
  assert.equal(dateInputs.length, 2, 'expected exactly two date inputs, got ' + dateInputs.length)
  for (const input of dateInputs) {
    assert.match(String(input.props.value), /^\d{4}-\d{2}-\d{2}$/, 'date value is not ISO: ' + input.props.value)
  }
  assert.equal(dateInputs[0].props.value, isoDay(-59), 'start date should default to today-59')
  assert.equal(dateInputs[1].props.value, isoDay(0), 'end date should default to today')
  assert.equal(dateInputs[1].props.max, isoDay(0), 'end date input should cap at today')
  assert.equal(dateInputs[0].props.min, '1970-01-01', 'start date input should have a floor')
})

test('the three hint lines are gone and every generate button remains', () => {
  const collapsed = collapsedPanel()
  const expanded = expandedPanel()
  for (const html of [collapsed.html, expanded.html]) {
    for (const gone of ['默认含今天', '花费 = 当天', 'CSV 文件']) {
      assert.ok(!html.includes(gone), 'hint text still rendered: ' + gone)
    }
  }
  for (const label of ['立即采样', '余额折线图', '花费柱状图', '消耗累计图']) {
    assert.ok(collapsed.html.includes(label), 'collapsed panel is missing ' + label)
  }
  assert.ok(expanded.html.includes('重置为最近 60 天'), 'missing reset button in the settings block')
})

test('reset rewrites the local 60-day default instead of blanking the inputs', () => {
  const { source } = collapsedPanel()
  assert.match(source, /function isoDay\(offset\)/, 'isoDay helper missing')
  assert.match(source, /function defaultRange\(data\)/, 'defaultRange helper missing')
  assert.match(source, /const next = defaultRange\(data\)/, 'reset does not use defaultRange')
  assert.doesNotMatch(source, /setFrom\(''\)/, 'reset still blanks the start date')
  assert.doesNotMatch(source, /setTo\(''\)/, 'reset still blanks the end date')
})

test('the four scale inputs default to 100 / 3.25 / 12.5 / 5,000,000 with the host range and step', () => {
  const { numberInputs, html, source } = expandedPanel()
  // v1.21 起 ut 存增量，不再需要「Tokens 消耗平移值」，只剩四个缩放输入框。
  assert.equal(numberInputs.length, 4, 'expected exactly four scale inputs, got ' + numberInputs.length)
  assert.ok(
    !numberInputs.some((input) => String(input.props['aria-label']).includes('平移')),
    'the token shift row is gone',
  )
  assert.doesNotMatch(source, /utShift/, 'no utShift left in the client')
  const scalesOnly = numberInputs
  const values = scalesOnly.map((input) => String(input.props.value))
  assert.deepEqual(
    values,
    ['100', '3.25', '12.5', '12500000'],
    'scale defaults should be 100 / 3.25 / 12.5 / 12500000, got ' + values,
  )
  const labels = scalesOnly.map((input) => input.props['aria-label'])
  assert.deepEqual(
    labels,
    ['DS余额', 'WB积分', '阿里云卡券', '日Tokens 消耗'],
    'scale rows should name all four sources',
  )
  for (const input of scalesOnly.slice(0, 3)) {
    assert.equal(String(input.props.min), '0.05', 'scale min should come from scaleRange')
    assert.equal(String(input.props.max), '400', 'scale max should come from scaleRange')
    assert.equal(String(input.props.step), '0.25', 'scale step should be 0.25')
  }
  // ut 的缩放是 divisor（每格多少 token），区间与步长都和百分比不同。
  const ut = scalesOnly[3]
  assert.equal(String(ut.props.min), '1000', 'ut divisor min comes from the host')
  assert.equal(String(ut.props.max), '1000000000', 'ut divisor max comes from the host')
  assert.equal(String(ut.props.step), '100000', 'ut divisor step comes from the host')
  // 折叠时也必须能一眼看到缩放摘要（需求：折叠行带一行摘要）。
  const collapsed = collapsedPanel()
  assert.ok(collapsed.html.includes('缩放 100% / 3.25% / 12.5%'), 'collapsed summary is missing the three percent scales')
  assert.ok(collapsed.html.includes('1250万 tokens'), 'collapsed summary is missing the ut divisor')
  assert.ok(html.includes('缩放'), 'expanded scale section is missing its title')
})

test('the sample interval is a setting that defaults to 15 minutes and persists immediately', () => {
  const { intervalInputs, html, source } = expandedPanel()
  assert.equal(intervalInputs.length, 1, 'exactly one sample-interval input')
  const input = intervalInputs[0]
  assert.equal(String(input.props.value), '15', 'default interval is 15 minutes')
  assert.equal(String(input.props.min), '1', 'minimum is 1 minute')
  assert.equal(String(input.props.max), '1440', 'maximum is 1440 minutes')
  assert.equal(String(input.props.step), '1', 'step is one minute')
  assert.match(source, /intervalTouched\.current = true/, 'user edit marks the field as touched')
  assert.match(source, /persistSettings\(\{ intervalMinutes: next \}\)/, 'edit persists immediately')
  assert.match(source, /if \(!intervalTouched\.current && Number\.isFinite\(Number\(data\.intervalMinutes\)\)\)/, 'host value hydrates until touched')
  const collapsed = collapsedPanel()
  assert.ok(collapsed.html.includes('采样间隔'), 'collapsed summary shows the interval')
})

test('the scale arrows step by 0.25 and stay clamped to the reported range', () => {
  const { html, source } = expandedPanel()
  assert.equal(html.split('▲').length - 1, 4, 'expected one up arrow per scale row')
  assert.equal(html.split('▼').length - 1, 4, 'expected one down arrow per scale row')
  assert.match(source, /const SCALE_STEP_DEFAULT = 0\.25/, 'scale step default should be 0.25')
  assert.match(source, /const base = toScale\(scales\[key\], key\)/, 'arrow should start from the clamped current value')
  assert.match(source, /updateScaleValue\(key, base \+ direction \* scaleStepOf\(key\)\)/, 'arrows should move by one scaleStep')
  assert.match(
    source,
    /Math\.round\(Math\.min\(Math\.max\(n, low\), high\) \* 100\) \/ 100/,
    'clamping should also round to at most two decimals',
  )
})

test('both generate buttons send sources, scales and the resolved theme with the chart request', () => {
  const { source } = collapsedPanel()
  assert.match(source, /sources: sourcesPayload\(sources\)/, 'chart body does not carry the source switches')
  assert.match(source, /scales: scalesPayload\(scales\)/, 'chart body does not carry the three scales')
  assert.match(source, /theme: resolveTheme\(theme\)/, 'chart body does not carry the resolved theme')
  assert.match(source, /const scalesPayload = \(source\) => \(\{/, 'scales payload helper missing')
  assert.match(source, /const sourcesPayload = \(source\) => \(\{/, 'sources payload helper missing')
  // 旧的单条 WB 百分比已经退役，Host 只认 scales.wb。
  assert.doesNotMatch(source, /wbPercent: Number\(wbPercent\)/, 'chart body still carries the retired wbPercent')
  assert.doesNotMatch(source, /data\.wbPercentRange/, 'client still reads the retired wbPercentRange')
})

test('the chart theme is a three-way light/dark/auto choice', () => {
  const { html, source } = expandedPanel()
  for (const label of ['图表主题', '明', '暗', '自动']) {
    assert.ok(html.includes(label), 'theme selector is missing ' + label)
  }
  assert.match(source, /const \[theme, setTheme\] = useState\('auto'\)/, 'theme should default to auto')
  assert.match(source, /prefers-color-scheme: dark/, 'auto should follow the system preference')
  assert.match(source, /setTheme\(value\)/, 'theme buttons do not update state')
  assert.doesNotMatch(source, /wbScaleHint/, 'the removed scale hint is still referenced')
})

test('the color-source selector offers change/source and is sent with chart requests', () => {
  const { html, source } = expandedPanel()
  for (const label of ['颜色来源', '增减', '数据源']) {
    assert.ok(html.includes(label), 'color-source selector is missing ' + label)
  }
  assert.ok(!html.includes('折线颜色'), 'the old 折线颜色 label must be renamed to 颜色来源')
  assert.match(source, /const \[colorMode, setColorMode\] = useState\('change'\)/, 'color mode should default to change')
  assert.match(source, /chooseColorMode/, 'no handler for the color-mode buttons')
  assert.match(source, /persistSettings\(\{ colorMode: value \}\)/, 'color-mode choice is not persisted')
  assert.match(source, /colorModeTouched\.current = true/, 'color-mode choice is not marked as touched')
  assert.match(source, /colorMode,/, 'chart body does not carry colorMode')
  // 回填时不能被定时刷新的 state 覆盖。
  assert.match(source, /!colorModeTouched\.current && \(data\.colorMode === 'change' \|\| data\.colorMode === 'source'\)/, 'colorMode backfill guard missing')
})

test('page numbers keep two decimals while the chart labels split by series', () => {
  const source = fs.readFileSync(path.join(PLUGIN, 'client.js'), 'utf8')
  assert.match(source, /n\.toFixed\(2\)/, 'page numbers should keep two decimals')
  const chart = fs.readFileSync(path.join(PLUGIN, 'scripts/gugu_chart.py'), 'utf8')
  // v1.22.0（m12655）：粗粒度中文单位只给紫色的 Tokens 消耗；DS / WB / 阿里云
  // 三条序列回到纯阿拉伯数字，两条规则必须各走各的。
  assert.match(chart, /COARSE_UNITS = \(/, 'COARSE_UNITS missing')
  assert.match(chart, /def coarse_label\(value: float\) -> str:/, 'coarse_label missing')
  assert.match(
    chart,
    /def label_text\(value: float\) -> str:(?:[\s\S]{0,400}?)return str\(int\(math\.floor\(float\(value\) \+ 0\.5\)\)\)/,
    'label_text must stay plain Arabic digits for DS/WB/Aliyun',
  )
  assert.match(
    chart,
    /def token_label\(value: float\) -> str:(?:[\s\S]{0,400}?)return coarse_label\(value\)/,
    'token_label must use the coarse Chinese units',
  )
})

test('采样时间显示精确到秒', () => {
  const source = fs.readFileSync(path.join(PLUGIN, 'client.js'), 'utf8')
  // fmtClock 用于「最近采样」显示；必须带秒，与 CSV 落盘的 HH:mm:ss 一致。
  assert.match(
    source,
    /pad\(date\.getMinutes\(\)\) \+ ':' \+ pad\(date\.getSeconds\(\)\)/,
    'fmtClock must show seconds for the sample time',
  )
  // CSV 落盘时间也必须是带秒格式（formatTimestamp）。
  const csv = fs.readFileSync(path.join(PLUGIN, 'lib/csv.js'), 'utf8')
  assert.match(
    csv,
    /pad\(date\.getMinutes\(\)\)\}:\$\{pad\(date\.getSeconds\(\)\)\}/,
    'formatTimestamp must include seconds',
  )
})

test('the chart card offers a save-to-desktop button that names the right variant', () => {
  const source = fs.readFileSync(path.join(PLUGIN, 'client.js'), 'utf8')
  assert.match(source, /saveChart: '保存到桌面'/, 'button label missing')
  assert.match(source, /call\('save-chart'/, 'client never calls the save-chart route')
  assert.match(source, /kind: chart && chart\.kind \? chart\.kind : 'line'/, 'save must follow the displayed chart kind')
  assert.match(source, /t\('savedTo'\)/, 'no confirmation after saving')
})

test('the panel title carries v1.24.4 and makes the brand bigger and bolder', () => {
  const { html, source } = collapsedPanel()
  assert.ok(html.includes('谷谷股'), 'panel title should start with the brand')
  assert.ok(html.includes('v1.24.4 · 自用小账本'), 'panel title should carry v1.24.4')
  assert.ok(source.includes("v1.24.4 · Personal ledger"), 'English title should also carry v1.24.4')
  // 品牌名单独一个 span，字号比后缀大、字重比后缀粗（m04735 ③）。
  assert.match(source, /brand:\s*\{\s*\n\s*fontSize:\s*'19px',\s*\n\s*fontWeight:\s*800/, 'brand style should be 19px / weight 800')
  assert.match(source, /titleSuffix:\s*\{\s*\n\s*fontSize:\s*'12\.5px',\s*\n\s*fontWeight:\s*500/, 'suffix style should be 12.5px / weight 500')
  assert.match(source, /h\('span', \{ style: S\.brand \}, t\('brand'\)\)/, 'brand span missing')
  assert.match(source, /h\('span', \{ style: S\.titleSuffix \}, t\('titleSuffix'\)\)/, 'suffix span missing')
})

test('the panel renders no intro line, not even the literal key name', () => {
  const source = fs.readFileSync(path.join(PLUGIN, 'client.js'), 'utf8')
  const { html } = collapsedPanel()
  // 整行删掉：既没有 <p> 说明，也不会出现键名本身（m04917 的根因是 t() 用 || 做兜底，
  // 空串被当成「没取到」而回退成键名 'intro'）。
  assert.ok(!/t\('intro'\)/.test(source), 'the intro render line should be gone')
  assert.ok(!/intro:\s*\{/.test(source), 'the intro style should be gone')
  assert.ok(!/(^|>)intro(<|$)/.test(html), 'the panel must not print the literal word "intro"')
  // t() 必须按「有没有这个键」判断，空串要原样返回，不能掉到 || 的 fallback。
  assert.match(source, /hasOwnProperty\.call\(dict, key\)/, 't() should test key presence, not truthiness')
  for (const lang of ['zh', 'en']) {
    const dict = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'locale', lang + '.json'), 'utf8'))
    assert.equal('intro' in dict, false, lang + ' locale should no longer carry an intro key')
    // 面板里不再渲染说明行；但 DSH 读 locale meta 时要求 description 非空
    // （package-meta.js 的 textOf），空串会让 GUI 报「包元信息错误」，所以它必须有内容。
    assert.ok(dict.meta.description.trim().length > 0, lang + ' meta.description must not be blank for DSH metadata')
  }
})

test('the settings block is collapsed by default and remembers its state in localStorage', () => {
  const collapsed = collapsedPanel()
  const toggle = collapsed.buttons.find((button) => button.props['aria-controls'] === 'gugu-stock-config-body')
  assert.ok(toggle, 'collapsible settings toggle missing')
  assert.equal(toggle.props['aria-expanded'], 'false', 'settings block should start collapsed')
  assert.ok(collapsed.html.includes('配置'), 'collapsed row should still show the settings title')
  assert.ok(
    collapsed.html.includes('DS · WB · Tokens · 缩放 100% / 3.25% / 12.5%'),
    'collapsed summary should name enabled sources and all four scales',
  )
  // 折叠时配置体完全不挂载；页面里只剩日期区间那两个 date 输入框（它们住在配置块外面）。
  assert.deepEqual(
    collapsed.inputs.map((input) => String(input.props.type)),
    ['date', 'date'],
    'collapsed settings body should render no inputs besides the two date range fields',
  )
  assert.ok(!collapsed.html.includes('打开文件'), 'collapsed settings body should not render section ①')
  assert.ok(!collapsed.html.includes('读取DS余额'), 'collapsed settings body should not render the switches')
  assert.match(collapsed.source, /CONFIG_STORAGE_KEY = 'gugu-stock\.configOpen'/, 'settings should remember the open state locally')
  // 点击一次：即使 useState 是 noop，写 localStorage 的副作用也应该发生。
  toggle.props.onClick()
  assert.equal(collapsed.storage.get(CONFIG_KEY), '1', 'expanding should persist gugu-stock.configOpen=1')
  // 密钥永远不进 localStorage：整个文件只有折叠状态这一处 setItem。
  assert.equal((collapsed.source.match(/localStorage\.setItem/g) || []).length, 1, 'only the collapsed state may be written to localStorage')
})

test('expanding the settings block reveals the three required sections', () => {
  const expanded = expandedPanel()
  const toggle = expanded.buttons.find((button) => button.props['aria-controls'] === 'gugu-stock-config-body')
  assert.ok(toggle, 'collapsible settings toggle missing')
  assert.equal(toggle.props['aria-expanded'], 'true', 'seeded open state should expand the block')
  // 序号与标题是两个 span，靠 flex gap 分隔（v1.24.4 起标题字号提到 15px）。
  for (const [index, title] of [['①', '打开文件'], ['②', '数据源配置'], ['③', '缩放'], ['④', '采样间隔']]) {
    assert.ok(expanded.html.includes(index), 'expanded settings block is missing index ' + index)
    assert.ok(expanded.html.includes(title), 'expanded settings block is missing ' + title)
  }
  assert.match(expanded.source, /configGroupIndex: \{/, 'the index needs its own style span')
  assert.match(expanded.source, /gap: '8px'/, 'index and title must be separated by a gap')
  assert.match(expanded.source, /configGroupTitle: \{[^}]*fontSize: '15px'/, 'group titles must be larger than body text')
  const openButton = expanded.buttons.find((button) => textOf(button) === '打开 csv 文件')
  assert.ok(openButton, 'section ① should keep exactly the open-csv entry point')
  // 导入按钮挨着「打开 csv 文件」，选中文件后整份替换数据（表里的设置也一起搬）。
  const importButton = expanded.buttons.find((button) => textOf(button) === '导入 csv 文件')
  assert.ok(importButton, 'section ① should offer an import entry point')
  const fileInput = expanded.inputs.find((input) => input.props.type === 'file')
  assert.ok(fileInput, 'import needs a hidden file input')
  assert.ok(expanded.html.includes('—'), 'section ① should show a csv path placeholder when state is empty')
  // ③ 里还收着图表明暗与日期区间，用弱分隔线与缩放行分开。
  assert.ok(expanded.html.includes('日期区间'), 'date range rows should move into section ③')
  assert.ok(expanded.html.includes('图表主题'), 'chart theme should move into section ③')
})

test('the three data-source switches expose their labels and checked state', () => {
  const { switches, html } = expandedPanel()
  assert.equal(switches.length, 4, 'expected exactly four source switches, got ' + switches.length)
  assert.deepEqual(
    switches.map((item) => textOf(item)),
    ['读取DS余额', '读取WB积分', '读取阿里云卡券', '读取 Tokens 消耗'],
    'switch labels should match the requested copy',
  )
  assert.deepEqual(
    switches.map((item) => item.props['aria-checked']),
    ['true', 'true', 'false', 'true'],
    'DS, WB and Tokens should default on, Aliyun should default off',
  )
  for (const label of ['读取DS余额', '读取WB积分', '读取阿里云卡券', '读取 Tokens 消耗']) {
    assert.ok(html.includes(label), 'rendered copy is missing ' + label)
  }
  assert.match(html, /DS · WB/, 'collapsed summary should only name the enabled sources')
})

test('the Aliyun credential fields start empty and never echo the secret', () => {
  // v1.24.4 起阿里云整块只在数据源打开时渲染，所以这里显式把它打开。
  const { textInputs, passwordInputs, source } = renderPanel({ configOpen: true, sources: { aliyun: true } })
  assert.equal(textInputs.length, 3, 'expected sub-account, coupon ID and AccessKey ID text inputs')
  assert.equal(passwordInputs.length, 1, 'expected exactly one secret input')
  for (const input of [...textInputs, ...passwordInputs]) {
    assert.equal(input.props.value, '', 'Aliyun inputs must default to empty, got ' + JSON.stringify(input.props.value))
  }
  const placeholders = textInputs.map((input) => input.props.placeholder)
  assert.ok(placeholders.includes('gugu-readonly@<账号ID>.onaliyun.com'), 'missing sub-account placeholder')
  assert.ok(placeholders.includes('纯数字，例如 123456789012'), 'missing coupon ID placeholder')
  assert.ok(placeholders.includes('LTAI...'), 'missing AccessKey ID placeholder')
  const secret = passwordInputs[0]
  assert.equal(secret.props.type, 'password', 'AccessKey Secret must be masked')
  assert.equal(secret.props.autoComplete, 'new-password', 'secret input should not autofill from storage')
  // 需求明确要求默认值全空：占位符可以举例，value 绝不能带真实凭据。
  assert.equal(secret.props.value, '', 'secret input must start empty, not with the saved key')
  for (const field of ['subAccount', 'couponId', 'accessKeyId', 'accessKeySecret']) {
    assert.match(source, new RegExp(field + ": ''"), 'state should initialise ' + field + " to ''")
  }
  assert.match(
    source,
    /aliyunSecret: \{ accessKeyId: next\.accessKeyId, accessKeySecret: next\.accessKeySecret \}/,
    'secrets should only travel inside aliyunSecret',
  )
  assert.doesNotMatch(source, /aliyunSecret[^\n]*localStorage/, 'secrets must never be persisted in localStorage')
})

test('the Aliyun fields are hidden while the source is off and never cleared', () => {
  // 需求 m15908③：只有打开阿里云数据源时才展示这四项，但关闭不清除已填内容。
  const off = expandedPanel()
  assert.equal(off.textInputs.length, 0, 'Aliyun text inputs must not render while the source is off')
  assert.equal(off.passwordInputs.length, 0, 'Aliyun secret input must not render while the source is off')
  assert.ok(!off.html.includes('阿里云 AccessKey ID'), 'the Aliyun labels are hidden with the source')
  assert.ok(off.html.includes('阿里云卡券'), 'the Aliyun toggle itself stays visible so it can be switched on')
  // 关闭只是不渲染；aliyunForm 是独立 state，没有任何 toggle 分支去清空它。
  assert.doesNotMatch(
    off.source,
    /toggleSource[\s\S]{0,400}setAliyunForm/,
    'toggling a source must not wipe the Aliyun form',
  )
  const on = renderPanel({ configOpen: true, sources: { aliyun: true } })
  assert.ok(on.html.includes('阿里云 AccessKey ID'), 'the Aliyun block appears once the source is on')
  assert.ok(on.html.includes('阿里云 AccessKey Secret'), 'the secret label comes with the block')
})

test('the stored-AccessKey hint is green and the same size as the field labels', () => {
  const { source } = collapsedPanel()
  // 之前 S.configHint 根本没定义，这段话是用浏览器默认样式（16px 黑）渲染的。
  assert.match(source, /configHint: \{/, 'the hint style must be defined, not referenced undefined')
  const block = source.slice(source.indexOf('configHint: {'), source.indexOf('configHint: {') + 260)
  assert.match(block, /fontSize: '12\.5px'/, 'hint font size must match the 12.5px field labels')
  assert.match(block, /--dsw-alias-status-success/, 'hint colour must be the success green')
  assert.match(source, /style: S\.configHint[^\n]*t\('accessKeyStored'\)/, 'the stored-key hint should use that style')
})
test('the outer panel keeps the date range above the primary action buttons', () => {
  const collapsed = collapsedPanel()
  const mainButtons = collapsed.buttons.filter(
    (button) => button.props['aria-controls'] !== 'gugu-stock-config-body',
  )
  assert.equal(mainButtons.length, 5, 'expected date-range reset + four action buttons, got ' + mainButtons.length)
  assert.deepEqual(
    mainButtons.map((button) => textOf(button)),
    ['重置为最近 60 天', '立即采样', '余额折线图', '花费柱状图', '消耗累计图'],
    'the outer row should hold the date reset plus sample + three generate buttons (no tidy button)',
  )
  // 折叠时标题行 + 1 个重置 + 3 个主按钮 = 5 个按钮。
  assert.equal(collapsed.buttons.length, 6, 'collapsed panel should expose the toggle, the date reset and four action buttons')
  // 顺序整理是自动的（启动 / 每次采样后 / 出图前），界面上不该再出现整理按钮。
  assert.ok(!collapsed.html.includes('整理表格'), 'the tidy action must not be a button any more')
  assert.ok(!collapsed.html.includes('打开 csv 文件'), 'open-csv should live inside the settings block')
  // 日期区间必须排在生成按钮上方，而且不能出现在配置体里（折叠态仍然可见即可证）。
  const labelAt = collapsed.html.indexOf('日期区间')
  assert.ok(labelAt > -1, 'date range row should still render while the settings block is collapsed')
  assert.ok(labelAt < collapsed.html.indexOf('立即采样'), 'date range should sit above the generate buttons')

})

test('the balance cards render one per enabled source and hide disabled ones', () => {
  const { elements, source } = collapsedPanel()
  const cards = elements.filter((el) => typeof el.type === 'function' && el.props.flex === true)
  assert.deepEqual(
    cards.map((card) => card.props.label),
    ['DS余额', 'WB积分', '日Tokens 消耗', '总Tokens 消耗'],
    'Tokens 开起来会多两块（日消耗 + 总消耗），但图上仍然只有一条紫线',
  )
  assert.match(
    source,
    /SOURCES_DEFAULT = \{ ds: true, wb: true, aliyun: false, ut: true \}/,
    'Aliyun should default off, Tokens on',
  )
  assert.match(source, /display: 'flex'/, 'balance cards should sit on one flex row')
  assert.match(source, /flex: '1 1 0'/, 'enabled cards should share the row equally')
  assert.match(source, /sources\.aliyun\s*\?/, 'Aliyun card should be conditionally rendered')
  // 记录条数必须是原始行数（用户 m12388），不能走粗粒度缩写。
  assert.match(source, /value: data \? String\(data\.rows\) : '—'/, 'record count must stay the raw number')
  // v1.22.0：数值按数据源上色（与图表调色板同源），不是一律主题灰。
  assert.ok(
    cards.every((card) => typeof card.props.tone === 'string'),
    'every source card should colour its number',
  )
  assert.match(
    source,
    /TONE_LIGHT = \{ ds: '#2563c9', wb: '#3f9e73', aliyun: '#d13a10', ut: '#7c3aed' \}/,
    'card tones should reuse the chart palette',
  )
  assert.match(
    source,
    /TONE_DARK = \{ ds: '#8fbcf7', wb: '#46a87c', aliyun: '#ff8a5c', ut: '#a78bfa' \}/,
    'dark theme needs its own tone set',
  )
})

test('panel numbers are rounded to coarse Chinese units', () => {
  const { source } = collapsedPanel()
  const body = source.slice(source.indexOf('const COARSE_UNITS'), source.indexOf('const TONE_LIGHT'))
  assert.ok(body.length > 200, 'coarse formatter should be present in client.js')
  const fmtCoarse = new Function(body + '; return fmtCoarse;')()
  // 用户给的例子逐条对上：最大单位、系数向下取整、亿的余数再走一遍。
  assert.deepEqual(
    [7320000, 48760000, 115780000, 5540000, 570000, 1376, 167, 67].map((value) => fmtCoarse(value)),
    ['7百万', '4千万', '1亿1千万', '5百万', '57万', '1千', '1百', '67'],
  )
})
test('the WB stat spells out that the number is a sum when several accounts exist', () => {
  const { source } = collapsedPanel()
  // v1.18.4：state 里多回 wbAccounts/wbAccountCount，面板据此在 WB 卡片下面
  // 写「N 个账号合计 · 时间」，只有一个号时仍只显示时间。
  assert.match(source, /data\.wbAccountCount/, 'the panel must read the account count from state')
  assert.match(source, /wbAccountCount > 1/, 'the sum hint should only appear for 2+ accounts')
  assert.match(source, /wbAccountsSum/, 'the sum hint needs its own text key')
  assert.match(source, /个账号合计/, 'zh copy for the sum hint is missing')
  assert.match(source, /accounts summed/, 'en copy for the sum hint is missing')
})
