window.__ModuleLoader__.load({
  id: 'dsh-gugu-stock',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const TEXT = {
      zh: {
        nav: '谷谷股',
        brand: '谷谷股',
        titleSuffix: 'v1.24.4 · 自用小账本',
        // 折叠配置块
        configTitle: '配置',
        configToggleAria: '展开或收起配置',
        openSection: '打开文件',
        openHint: '在谷谷股数据搬迁时，仅需搬迁此 csv 文件即可。',
        sourceSection: '数据源配置',
        scaleSection: '缩放',
        sourceDs: '读取DS余额',
        sourceWb: '读取WB积分',
        wbAutoHint: '开启后，正在自动读取 dsh-connect-workbuddy 的数据作为 WB 积分数据（未安装该插件时不会有数据）。',
        sourceAliyun: '读取阿里云卡券',
        sourceUt: '读取 Tokens 消耗',
        sourceNone: '未启用数据源',
        dsShort: 'DS',
        wbShort: 'WB',
        aliyunShort: '阿里云',
        utShort: 'Tokens',
        scaleSummary: '缩放',
        scaleUnit: '%',
        intervalLabel: '采样间隔',
        intervalUnit: '分钟',
        intervalHint: '每隔多少分钟自动采样一次，1 到 1440 分钟；改完立即生效',
        scaleUp: '上调 0.25',
        scaleDown: '下调 0.25',
        openCsv: '打开 csv 文件',
        importCsv: '导入 csv 文件',
        importDone: '已导入 {n} 条记录',
        importAdopted: '（表里的设置也一起搬过来了）',
        importFail: '导入失败',
        importHint: '用另一台机器的 csv 整份替换当前数据；表里第一行带着面板设置，会一起生效',
        aliyunBalance: '阿里云卡券',
        utBalance: '日Tokens 消耗',
        utTotalBalance: '总Tokens 消耗',
        utScaleUnit: 'tokens',
        utScaleHint: '「日Tokens 消耗」这一行不是百分比，而是「多少 tokens 折算成纵轴 1 格」：默认 12500000 表示每 1250 万 tokens 记为 1 格高度。按你实际的日消耗量调这一个数就够了——数值越小柱子越高。',
        aliyunSubAccount: '阿里云子账号',
        aliyunSubAccountHint: 'gugu-readonly@<账号ID>.onaliyun.com',
        aliyunCouponId: '阿里云卡券编号',
        aliyunCouponHint: '纯数字，例如 123456789012',
        accessKeyId: '阿里云 AccessKey ID',
        accessKeyIdHint: 'LTAI...',
        accessKeySecret: '阿里云 AccessKey Secret',
        accessKeySecretHint: 'LTAI...',
        accessKeyConfigured: '已配置（留空则不修改）',
        accessKeyStored: 'AccessKey 已保存在本机凭据库，输入框留空即沿用已保存的密钥；填新的才会覆盖。',
        aliyunTest: '测试连接',
        aliyunTesting: '正在测试…',
        aliyunTestOk: '阿里云连接成功',
        aliyunTestFail: '阿里云连接失败',
        aliyunHelp: '在阿里云 RAM 控制台创建一个只读子账号 → 授予 AliyunBSSReadOnlyAccess → 为该子账号创建 AccessKey → 把子账号、卡券编号和两项 AccessKey 填到上方。密钥只用于写入，不会回显到界面。',
        sampledAliyun: '阿里云',
        sampledUt: 'Tokens',
        aliyunFail: '阿里云卡券读取失败',
        sampleNow: '立即采样',
        sampleSkipped: '同一分钟已有记录，本次跳过',
        makeLine: '余额折线图',
        makeSpend: '花费柱状图',
        makeTotal: '消耗累计图',
        rangeLabel: '日期区间',
        rangeFrom: '起始',
        rangeTo: '结束',
        rangeReset: '重置为最近 60 天',
        wbScaleUnit: '%',
        charting: '正在用 Python 出图…',
        sampling: '正在读取余额…',
        opening: '正在打开文件…',
        balance: 'DS余额',
        wbBalance: 'WB积分',
        wbAccountsSum: ' 个账号合计',
        lastSample: '最近采样',
        nextSample: '下次采样',
        points: '记录条数',
        days: '有数据天数',
        never: '还没有采样记录',
        chartAlt: '谷谷股折线图',
        error: '操作失败',
        emptyCsv: 'CSV 还没有数据，先点一次「立即采样」。',
        opened: '已交给系统默认程序打开',
        sampled: '已记录',
        sampledDs: 'DS',
        sampledWb: 'WB',
        wbFail: 'WB 积分读取失败',
        charted: '已生成',
        failedSample: '采样失败',
        lastError: '最近一次采样失败',
        themeLabel: '图表主题',
        themeLight: '明',
        themeDark: '暗',
        themeAuto: '自动',
        colorModeLabel: '颜色来源',
        colorModeChange: '增减',
        colorModeSource: '数据源',
        saveChart: '保存到桌面',
        saving: '正在保存…',
        savedTo: '已保存',
        zoomHint: '双击图片可全屏查看',
        zoomClose: '点击任意位置或按 Esc 返回',
      },
      en: {
        nav: 'Gugu Stock',
        brand: 'Gugu Stock',
        titleSuffix: 'v1.24.4 · Personal ledger',
        // Collapsible settings block
        configTitle: 'Settings',
        configToggleAria: 'Expand or collapse settings',
        openSection: 'Open file',
        openHint: 'Only this CSV needs to be migrated when moving your Gugu Stock data.',
        sourceSection: 'Data sources',
        scaleSection: 'Scale',
        sourceDs: 'Read DS balance',
        sourceWb: 'Read WB credits',
        wbAutoHint: 'When enabled, WB credits are read automatically from dsh-connect-workbuddy (no data if that plugin is not installed).',
        sourceAliyun: 'Read Aliyun coupons',
        sourceUt: 'Read token spend',
        sourceNone: 'No source enabled',
        dsShort: 'DS',
        wbShort: 'WB',
        aliyunShort: 'Aliyun',
        utShort: 'Tokens',
        scaleSummary: 'scale',
        scaleUnit: '%',
        intervalLabel: 'Sample interval',
        intervalUnit: 'min',
        intervalHint: 'Auto-sample every N minutes, 1 to 1440; takes effect immediately',
        scaleUp: 'Increase by 0.25',
        scaleDown: 'Decrease by 0.25',
        openCsv: 'Open CSV',
        importCsv: 'Import CSV',
        importDone: 'Imported {n} rows',
        importAdopted: ' (settings came with the file)',
        importFail: 'Import failed',
        importHint: 'Replace every row with the csv from another machine; its first line carries the panel settings and is applied too',
        aliyunBalance: 'Aliyun coupons',
        utBalance: 'Token spend / day',
        utTotalBalance: 'Token spend total',
        utScaleUnit: 'tokens',
        utScaleHint: 'The "Token spend / day" row is not a percentage: it is how many tokens make one grid cell. The default 12500000 means 12.5M tokens = 1 cell; lower it to make bars taller.',
        aliyunSubAccount: 'Aliyun sub-account',
        aliyunSubAccountHint: 'gugu-readonly@<account-id>.onaliyun.com',
        aliyunCouponId: 'Aliyun coupon ID',
        aliyunCouponHint: 'Numeric, e.g. 123456789012',
        accessKeyId: 'Aliyun AccessKey ID',
        accessKeyIdHint: 'LTAI...',
        accessKeySecret: 'Aliyun AccessKey Secret',
        accessKeySecretHint: 'LTAI...',
        accessKeyConfigured: 'Configured (leave blank to keep)',
        accessKeyStored: 'The AccessKey is stored in the local credential vault. Leave the boxes blank to keep it; type a new one to replace it.',
        aliyunTest: 'Test connection',
        aliyunTesting: 'Testing…',
        aliyunTestOk: 'Aliyun connection OK',
        aliyunTestFail: 'Aliyun connection failed',
        aliyunHelp: 'In the Aliyun RAM console create a read-only sub-account → grant AliyunBSSReadOnlyAccess → create an AccessKey for it → paste the sub-account, coupon ID and both AccessKey fields above. The secret is write-only and never echoed.',
        sampledAliyun: 'Aliyun',
        sampledUt: 'Tokens',
        aliyunFail: 'Aliyun coupon read failed',
        sampleNow: 'Sample now',
        sampleSkipped: 'A row for this minute already exists — skipped',
        makeLine: 'Balance line',
        makeSpend: 'Daily spend',
        makeTotal: 'Cumulative spend',
        rangeLabel: 'Date range',
        rangeFrom: 'From',
        rangeTo: 'To',
        rangeReset: 'Reset to last 60 days',
        wbScaleUnit: '%',
        charting: 'Rendering with Python…',
        sampling: 'Reading balance…',
        opening: 'Opening file…',
        balance: 'DS balance',
        wbBalance: 'WB credits',
        wbAccountsSum: ' accounts summed',
        lastSample: 'Last sample',
        nextSample: 'Next sample',
        points: 'Rows',
        days: 'Days',
        never: 'No sample yet',
        chartAlt: 'Gugu Stock line chart',
        error: 'Action failed',
        emptyCsv: 'No rows yet — click "Sample now" first.',
        opened: 'Opened with the default application',
        sampled: 'Recorded',
        sampledDs: 'DS',
        sampledWb: 'WB',
        wbFail: 'WB credits unavailable',
        charted: 'Generated',
        failedSample: 'Sampling failed',
        themeLabel: 'Chart theme',
        themeLight: 'Light',
        themeDark: 'Dark',
        themeAuto: 'Auto',
        colorModeLabel: 'Color source',
        colorModeChange: 'By change',
        colorModeSource: 'By source',
        saveChart: 'Save to Desktop',
        saving: 'Saving…',
        savedTo: 'Saved',
        zoomHint: 'Double-click the chart for full screen',
        zoomClose: 'Click anywhere or press Esc to go back',
        lastError: 'Last sampling failed',
      },
    }

    const pickLocale = () => {
      try {
        const lang = String((document.documentElement && document.documentElement.lang) || '').toLowerCase()
        if (lang.startsWith('en')) return 'en'
        const stored = window.localStorage && window.localStorage.getItem('dsh-locale')
        if (stored && String(stored).toLowerCase().startsWith('en')) return 'en'
      } catch {
        /* default to zh */
      }
      return 'zh'
    }

    // 用 hasOwnProperty 判断「有没有这个键」，不能用 truthiness：
    // 空串是合法文案（表示「这一行不要显示」），一旦写成 || 就会掉到最后的
    // fallback 把键名本身当成文案渲染出来。
    const t = (key) => {
      const lang = pickLocale()
      const dict = TEXT[lang] || {}
      if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key]
      if (Object.prototype.hasOwnProperty.call(TEXT.zh, key)) return TEXT.zh[key]
      return key
    }

    /**
     * auto → 跟随系统：优先 prefers-color-scheme，其次看宿主页面的 data-theme /
     * documentElement.lang 之类线索，都没有就退回 light。
     */
    const resolveTheme = (value) => {
      const text = String(value || 'auto').toLowerCase()
      if (text === 'light' || text === 'dark') return text
      try {
        if (window.matchMedia) {
          const query = window.matchMedia('(prefers-color-scheme: dark)')
          if (query && typeof query.matches === 'boolean') return query.matches ? 'dark' : 'light'
        }
        const root = document && document.documentElement
        const attr = root && (root.dataset ? root.dataset.theme : root.getAttribute('data-theme'))
        if (attr === 'dark' || attr === 'light') return attr
      } catch {
        /* fall through */
      }
      return 'light'
    }

    /** Same-origin host route resolved against the page base (dsh-app:// safe). */
    const apiUrl = (sub) => new URL('gugu-stock/api/' + sub, new URL('.', document.baseURI)).toString()

    // 本地时区的 YYYY-MM-DD：默认区间与日期框初值都用它算，
    // 这样即使 Host 还没重启（state 里没有 range），两个框也显示真实日期而不是「年/月/日」。
    function isoDay(offset) {
      const date = new Date()
      date.setDate(date.getDate() + (offset || 0))
      const pad = (value) => String(value).padStart(2, '0')
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    }

    function defaultRange(data) {
      const range = (data && data.range) || {}
      return {
        from: range.defaultFrom || isoDay(-59),
        to: range.defaultTo || isoDay(0),
        today: isoDay(0),
      }
    }

    async function call(sub, options) {
      let response
      try {
        response = await fetch(apiUrl(sub), {
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          ...options,
        })
      } catch (err) {
        const network = new Error('无法连接 DSH 宿主：' + String((err && err.message) || err))
        network.code = 'network'
        throw network
      }
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok || !data || data.ok === false) {
        const detail = data && data.error ? data.error : null
        const failed = new Error((detail && detail.message) || 'HTTP ' + response.status)
        failed.code = (detail && detail.code) || 'http_' + response.status
        throw failed
      }
      return data
    }

    // t() 只做查表，带占位符的文案用这个替换。
    const tf = (key, values) =>
      t(key).replace(/\{(\w+)\}/g, (whole, name) =>
        values && values[name] !== undefined ? String(values[name]) : whole,
      )

    const pad = (n) => String(n).padStart(2, '0')

    const fmtClock = (iso) => {
      if (!iso) return '—'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return String(iso)
      return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
    }

    // 界面上数字最多 1 位小数，整数就显示整数（CSV 里仍按 6 位精度落盘）
    // 插件页面上的数值保留 2 位小数（图上另有一套：图上取整，见 gugu_chart.py）。
    const fmtNumber = (value) => {
      if (value === null || value === undefined || value === '') return '—'
      const n = Number(value)
      return Number.isFinite(n) ? n.toFixed(2) : String(value)
    }

    // token 数太大：界面按「亿 / 万」压缩（CSV 里仍是原值）。
    const fmtTokens = (value) => {
      if (value === null || value === undefined || value === '') return '—'
      const n = Number(value)
      if (!Number.isFinite(n)) return String(value)
      // 中文习惯：1亿2千万 / 6200万 / 1510万 / 1.2万 / 1234（CSV 里永远写原值）。
      const total = Math.round(Math.abs(n))
      const sign = n < 0 ? '-' : ''
      if (total < 1e4) return sign + String(total)
      if (total >= 1e8) {
        const yi = Math.floor(total / 1e8)
        const wan = Math.round((total % 1e8) / 1e4)
        if (!wan) return sign + yi + '亿'
        if (wan >= 1000 && wan % 1000 === 0) return sign + yi + '亿' + wan / 1000 + '千万'
        return sign + yi + '亿' + wan + '万'
      }
      const wanValue = total / 1e4
      const wan = Math.round(wanValue)
      if (wan >= 1000 && wan % 1000 === 0) return sign + wan / 1000 + '千万'
      if (wanValue < 100) {
        const text = wanValue.toFixed(1).replace(/\.0$/, '')
        return sign + text + '万'
      }
      return sign + wan + '万'
    }

    const fmtBalance = (value) => {
      const text = fmtNumber(value)
      return text === '—' ? text : '¥ ' + text
    }

    // 面板上的大数字按中文粗粒度显示：取「不超过数值的最大单位」，系数向下取整。
    // 7320000→7百万、48760000→4千万、115780000→1亿1千万、5540000→5百万、
    // 570000→57万、1376→1千、167→1百、67→67（小于 100 原样）。
    const COARSE_UNITS = [
      ['亿', 1e8],
      ['千万', 1e7],
      ['百万', 1e6],
      ['万', 1e4],
      ['千', 1e3],
      ['百', 1e2],
    ]
    const coarseWhole = (total) => {
      for (let index = 0; index < COARSE_UNITS.length; index += 1) {
        const unit = COARSE_UNITS[index][0]
        const scale = COARSE_UNITS[index][1]
        if (total >= scale) {
          const head = Math.floor(total / scale)
          const rest = total - head * scale
          // 亿的余数再走一遍：1亿1578万 → 1亿1千万（更细的尾数直接丢掉）
          return head + unit + (unit === '亿' && rest ? coarseWhole(rest) : '')
        }
      }
      return String(total)
    }
    const fmtCoarse = (value) => {
      if (value === null || value === undefined || value === '') return '—'
      const n = Number(value)
      if (!Number.isFinite(n)) return String(value)
      return (n < 0 ? '-' : '') + coarseWhole(Math.round(Math.abs(n)))
    }

    // 卡片数值的颜色跟数据源一致（与图表调色板同源）：DS 蓝 / WB 绿 / 阿里云橙红 / Tokens 紫。
    const TONE_LIGHT = { ds: '#2563c9', wb: '#3f9e73', aliyun: '#d13a10', ut: '#7c3aed' }
    const TONE_DARK = { ds: '#8fbcf7', wb: '#46a87c', aliyun: '#ff8a5c', ut: '#a78bfa' }
    const toneOf = (key, themeText) => (String(themeText) === 'dark' ? TONE_DARK : TONE_LIGHT)[key]

    const S = {
      section: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: '100%',
        maxWidth: '760px',
        boxSizing: 'border-box',
      },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '20px',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '16px',
        background: 'var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2))',
      },
      heading: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '8px',
        flexWrap: 'wrap',
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
      },
      brand: {
        fontSize: '19px',
        fontWeight: 800,
        letterSpacing: '0.3px',
      },
      titleSuffix: {
        fontSize: '12.5px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary))',
      },
      stats: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px',
      },
      statsPair: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '12px',
      },
      stat: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '10px 12px',
        borderRadius: '12px',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
      },
      statLabel: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))' },
      statValue: { fontSize: '16px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' },
      statSub: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      // 三个数值块按开关等宽排一行；minWidth 0 让长数字/长副标题能收缩而不是撑破布局。
      statsRow: { display: 'flex', flexWrap: 'wrap', gap: '12px' },
      statFlex: { flex: '1 1 0', minWidth: 0 },
      row: { display: 'flex', flexWrap: 'wrap', gap: '10px' },
      button: {
        padding: '8px 14px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        lineHeight: '18px',
        cursor: 'pointer',
      },
      buttonPrimary: {
        padding: '8px 14px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-label-primary, #1f2328)',
        // 用「前景/背景对调」而不是 brand-primary：后者在某些主题下解析成接近白色，
        // 白底 + 白字会让主按钮直接消失。这里两个 token 都有硬回退，深浅色主题都保证对比度。
        background: 'var(--dsw-alias-label-primary, #1f2328)',
        color: 'var(--dsw-alias-bg-base, #ffffff)',
        fontWeight: 600,
        fontSize: '13px',
        lineHeight: '18px',
        cursor: 'pointer',
      },
      buttonDisabled: { opacity: 0.55, cursor: 'not-allowed' },
      rangeRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' },
      rangeLabel: { fontSize: '12.5px', color: 'var(--dsw-alias-label-secondary)' },
      percentInput: {
        width: '72px',
        boxSizing: 'border-box',
        padding: '6px 8px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2, transparent)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '8px',
      },
      percentUnit: { fontSize: '12.5px', color: 'var(--dsw-alias-label-secondary)' },
      themeGroup: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        padding: '2px',
        borderRadius: '9px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2, transparent)',
      },
      themeOptionOff: {
        padding: '4px 10px',
        border: 'none',
        borderRadius: '7px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12.5px',
        lineHeight: '16px',
        cursor: 'pointer',
      },
      themeOptionOn: {
        padding: '4px 10px',
        border: 'none',
        borderRadius: '7px',
        background: 'var(--dsw-alias-label-primary, #1f2328)',
        color: 'var(--dsw-alias-bg-base, #ffffff)',
        fontSize: '12.5px',
        lineHeight: '16px',
        fontWeight: 600,
        cursor: 'pointer',
      },
      input: {
        padding: '6px 8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base, #ffffff)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12.5px',
        lineHeight: '18px',
        fontFamily: 'inherit',
      },
      path: {
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
        wordBreak: 'break-all',
        margin: 0,
      },
      notice: {
        padding: '10px 12px',
        borderRadius: '12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        fontSize: '12.5px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      // 折叠面板：整行是按钮，▸ 旋转 90° 表示展开；面板本身用 layer-1 与外层卡片区分。
      configPanel: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '12px',
        background: 'var(--dsw-alias-bg-layer-1)',
        overflow: 'hidden',
      },
      configToggle: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '10px 12px',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: '12.5px',
        fontWeight: 600,
        textAlign: 'left',
        cursor: 'pointer',
      },
      configChevron: {
        display: 'inline-block',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-secondary)',
        transition: 'transform 120ms ease',
      },
      configSummary: {
        marginLeft: 'auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '11.5px',
        fontWeight: 400,
        color: 'var(--dsw-alias-label-secondary)',
      },
      configBody: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '10px 12px 14px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      configGroup: { display: 'flex', flexDirection: 'column', gap: '9px' },
      // 板块标题：比正文（12.5px）明显大一档，并用序号 + 间距把「①②③」与标题分开。
      configGroupTitle: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '8px',
        fontSize: '15px',
        fontWeight: 700,
        letterSpacing: '0.2px',
        color: 'var(--dsw-alias-label-primary)',
      },
      configGroupIndex: {
        fontSize: '15px',
        fontWeight: 700,
        color: 'var(--dsw-alias-label-secondary)',
        flex: 'none',
      },
      configDivider: {
        height: '1px',
        background: 'var(--dsw-alias-border-l1)',
      },
      configRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' },
      fieldLabel: {
        minWidth: '64px',
        fontSize: '12.5px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      // 行内说明（如「AccessKey 已保存在本机凭据库」）：字号跟输入框/标签一致，绿色以示「已经好了」。
      configHint: {
        margin: '2px 0 0',
        fontSize: '12.5px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-status-success, #1a9c5b)',
      },
      fieldInput: {
        flex: '1 1 180px',
        minWidth: 0,
        padding: '6px 8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base, #ffffff)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12.5px',
        lineHeight: '18px',
        fontFamily: 'inherit',
      },
      // 自定义开关：小圆点轨道，打开时用前景色填充，避免另引入品牌色。
      toggle: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '7px',
        padding: '3px 2px',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: '12.5px',
        lineHeight: '18px',
        cursor: 'pointer',
      },
      toggleTrack: {
        position: 'relative',
        display: 'inline-block',
        flex: '0 0 auto',
        width: '32px',
        height: '18px',
        borderRadius: '999px',
        background: 'var(--dsw-alias-border-l2)',
        transition: 'background 120ms ease',
      },
      toggleTrackOn: { background: 'var(--dsw-alias-label-primary, #1f2328)' },
      toggleKnob: {
        position: 'absolute',
        top: '2px',
        left: '2px',
        width: '14px',
        height: '14px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-bg-base, #ffffff)',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
        transition: 'transform 120ms ease',
      },
      toggleKnobOn: { transform: 'translateX(14px)' },
      stepButton: {
        width: '26px',
        height: '26px',
        padding: 0,
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '10px',
        lineHeight: '24px',
        cursor: 'pointer',
      },
      hint: {
        margin: 0,
        fontSize: '11.5px',
        lineHeight: '17px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      error: {
        padding: '10px 12px',
        borderRadius: '12px',
        border: '1px solid var(--dsw-alias-state-error-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        fontSize: '12.5px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-state-error-primary)',
        whiteSpace: 'pre-wrap',
      },
      image: {
        display: 'block',
        width: '100%',
        height: 'auto',
        borderRadius: '12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: '#ffffff',
        cursor: 'zoom-in',
      },
      zoomOverlay: {
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        padding: '24px',
        boxSizing: 'border-box',
        background: 'rgba(16, 18, 22, 0.86)',
        cursor: 'zoom-out',
      },
      zoomImage: {
        display: 'block',
        maxWidth: '100%',
        maxHeight: 'calc(100vh - 96px)',
        width: 'auto',
        height: 'auto',
        borderRadius: '10px',
        background: '#ffffff',
        boxShadow: '0 18px 60px rgba(0, 0, 0, 0.45)',
        cursor: 'default',
      },
      chartActions: { display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' },
      zoomClose: {
        fontSize: '12.5px',
        lineHeight: '18px',
        color: 'rgba(255, 255, 255, 0.78)',
      },
      spinner: { fontSize: '12.5px', color: 'var(--dsw-alias-label-secondary)' },
    }

    // 折叠状态只存在浏览器本地：它是纯 UI 偏好，没必要每次开面板都打一次 Host 接口。
    const CONFIG_STORAGE_KEY = 'gugu-stock.configOpen'
    // 三条线各自的显示高度缩放（百分比），Host 端 state 里的 scales 是权威值；
    // 这里的默认值只用于 Host 还没重启/字段缺失时的首屏。
    const SCALES_DEFAULT = { ds: 100, wb: 3.25, aliyun: 12.5, ut: 12500000 }
    const SOURCES_DEFAULT = { ds: true, wb: true, aliyun: false, ut: true }
    const SCALE_RANGE_DEFAULT = { min: 0.05, max: 400 }
  // ut 的缩放不是百分比，而是「每 1 纵轴单位 = N tokens」的除数，区间/步长单独一套。
  const UT_RANGE_DEFAULT = { min: 1000, max: 1000000000, step: 100000 }
    const SCALE_STEP_DEFAULT = 0.25

    // 缩放的上下箭头可能把值带出 Host 给的范围，也允许用户键入 3. 这种中间态；
    // 统一在这里夹取并最多保留 2 位小数，保证发给 Host 的永远是合法数字。
    const clampScale = (value, range) => {
      const n = Number(value)
      if (!Number.isFinite(n)) return null
      const min = Number(range && range.min)
      const max = Number(range && range.max)
      const low = Number.isFinite(min) ? min : SCALE_RANGE_DEFAULT.min
      const high = Number.isFinite(max) ? max : SCALE_RANGE_DEFAULT.max
      return Math.round(Math.min(Math.max(n, low), high) * 100) / 100
    }

    const fmtScale = (value) => {
      const n = Number(value)
      return Number.isFinite(n) ? String(Number(n.toFixed(2))) : ''
    }

    function Stat(props) {
      // tone：数值按数据源上色（DS 蓝 / WB 绿 / 阿里云橙红 / Tokens 紫），不传就沿用主题文字色。
      const valueStyle = props.tone ? { ...S.statValue, color: props.tone } : S.statValue
      return h(
        'div',
        { style: props.flex ? { ...S.stat, ...S.statFlex } : S.stat },
        h('span', { style: S.statLabel }, props.label),
        h('span', { style: valueStyle }, props.value),
        props.sub ? h('span', { style: S.statSub }, props.sub) : null,
      )
    }

    function GuguSection(props) {
      const wide = Boolean(props && props.wide)
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState('')
      const [chart, setChart] = useState(null)
      const [zoom, setZoom] = useState(false)
      const [from, setFrom] = useState(() => isoDay(-59))
      const [to, setTo] = useState(() => isoDay(0))
      const [configOpen, setConfigOpen] = useState(() => {
        try {
          return window.localStorage.getItem(CONFIG_STORAGE_KEY) === '1'
        } catch {
          // 隐私模式/沙箱里 localStorage 可能直接抛错，折叠面板照常可用。
          return false
        }
      })
      const [sources, setSources] = useState(SOURCES_DEFAULT)
      const [scales, setScales] = useState(SCALES_DEFAULT)
      const [intervalMinutes, setIntervalMinutes] = useState(15)
      const intervalTouched = useRef(false)
      // 阿里云文本字段（子账号/卡券编号）从 Host 回填，AccessKey 两项永远从空开始：
      // 密钥只为写入而传，连「已配置的明文」都不该出现在输入框里。
      const [aliyunForm, setAliyunForm] = useState({
        subAccount: '',
        couponId: '',
        accessKeyId: '',
        accessKeySecret: '',
      })
      const [testing, setTesting] = useState(false)
      const [aliyunStatus, setAliyunStatus] = useState(null)
      // 图表主题：light / dark / auto。auto 在浏览器端解析成实际明暗再发给 Host，
      // 因为只有客户端知道当前系统的 prefers-color-scheme。
      const [theme, setTheme] = useState('auto')
      const themeTouched = useRef(false)
      // 折线颜色：change=按涨跌（涨红跌绿平灰）/ source=按数据源（蓝/绿/橙）。
      const [colorMode, setColorMode] = useState('change')
      const colorModeTouched = useRef(false)
      // 任何一个输入框被改过就不再被轮询回来的 state 覆盖（见下面的 *Touched）。
      const touched = useRef(false)
      const alive = useRef(true)
      // 沿用 wbTouched/themeTouched 的「用户改过就不再被 state 覆盖」模式：
      // 采样定时间隔会不停刷新 state，不能让服务器的旧值把用户刚输入的内容顶掉。
      const sourcesTouched = useRef(false)
      const scaleTouched = useRef({ ds: false, wb: false, aliyun: false, ut: false })
      const aliyunTouched = useRef({ subAccount: false, couponId: false })

      // 设置（WB 缩放 / 图表主题）改完立刻发给 Host 落盘，关掉面板再进来还在（v1.7 ⑨）。
      const persistTimer = useRef(null)
      const pendingSettings = useRef({})
      const fileInput = useRef(null)
      const persistSettings = useCallback((patch) => {
        pendingSettings.current = { ...pendingSettings.current, ...patch }
        if (persistTimer.current) clearTimeout(persistTimer.current)
        persistTimer.current = setTimeout(() => {
          persistTimer.current = null
          const payload = pendingSettings.current
          pendingSettings.current = {}
          call('settings', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {})
        }, 350)
      }, [])

      // 缩放范围/步长以 Host 的 state 为准，Host 还没升级时回落到常量。
      const scaleRange = (data && data.scaleRange) || SCALE_RANGE_DEFAULT
      const scaleStep = data && Number.isFinite(Number(data.scaleStep)) ? Number(data.scaleStep) : SCALE_STEP_DEFAULT
      // ut 的缩放是 divisor（每格多少 token），范围和步长都跟百分比不一样，
      // 所以按 key 取 Host 给的表（state.scaleRanges / state.scaleSteps）。
      const scaleRangeOf = (key) => {
        const fallback = key === 'ut' ? UT_RANGE_DEFAULT : scaleRange
        const own = data && data.scaleRanges ? data.scaleRanges[key] : null
        return own && Number.isFinite(Number(own.min)) && Number.isFinite(Number(own.max)) ? own : fallback
      }
      const scaleStepOf = (key) => {
        const fallback = key === 'ut' ? UT_RANGE_DEFAULT.step : scaleStep
        const own = data && data.scaleSteps ? Number(data.scaleSteps[key]) : NaN
        return Number.isFinite(own) && own > 0 ? own : fallback
      }
      const toScale = (value, key) => {
        const clamped = clampScale(value, scaleRangeOf(key))
        return clamped === null ? SCALES_DEFAULT[key] : clamped
      }
      // 图表只关心三条线的最终高度，统一在这里折算成 Host 能直接消费的数字。
      const scalesPayload = (source) => ({
        ds: toScale(source.ds, 'ds'),
        wb: toScale(source.wb, 'wb'),
        aliyun: toScale(source.aliyun, 'aliyun'),
        ut: toScale(source.ut, 'ut'),
      })
      const sourcesPayload = (source) => ({
        ds: source.ds !== false,
        wb: source.wb !== false,
        aliyun: source.aliyun === true,
        ut: source.ut !== false,
      })

      // Host 返回 range 后采用它算好的默认窗口（含今天在内的最近 60 天）；
      // 用户一旦动过日期就不再覆盖。
      useEffect(() => {
        if (!data || themeTouched.current) return
        if (typeof data.theme === 'string' && data.theme) setTheme(data.theme)
        if (!colorModeTouched.current && (data.colorMode === 'change' || data.colorMode === 'source')) {
          setColorMode(data.colorMode)
        }
      }, [data])

      // 首屏用 Host 的 sources/scales/aliyun 回填；只回填用户没动过的字段。
      useEffect(() => {
        if (!data) return
        if (data.sources && !sourcesTouched.current) {
          const next = data.sources
          setSources((prev) => ({
            ds: typeof next.ds === 'boolean' ? next.ds : prev.ds,
            wb: typeof next.wb === 'boolean' ? next.wb : prev.wb,
            aliyun: typeof next.aliyun === 'boolean' ? next.aliyun : prev.aliyun,
            ut: typeof next.ut === 'boolean' ? next.ut : prev.ut,
          }))
        }
        if (data.scales) {
          setScales((prev) => {
            const next = { ...prev }
            for (const key of ['ds', 'wb', 'aliyun', 'ut']) {
              const value = Number(data.scales[key])
              if (!scaleTouched.current[key] && Number.isFinite(value)) next[key] = value
            }
            return next
          })
        }
        if (!intervalTouched.current && Number.isFinite(Number(data.intervalMinutes))) {
          setIntervalMinutes(Number(data.intervalMinutes))
        }
        if (data.aliyun) {
          setAliyunForm((prev) => ({
            ...prev,
            subAccount: aliyunTouched.current.subAccount ? prev.subAccount : String(data.aliyun.subAccount || ''),
            couponId: aliyunTouched.current.couponId ? prev.couponId : String(data.aliyun.couponId || ''),
          }))
        }
      }, [data])

      useEffect(() => {
        if (!data || !data.range || touched.current) return
        const next = defaultRange(data)
        setFrom(next.from)
        setTo(next.to)
      }, [data])

      useEffect(() => {
        if (!zoom) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setZoom(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [zoom])

      const refresh = useCallback(async () => {
        try {
          const next = await call('state', { method: 'GET' })
          if (alive.current) {
            setData(next)
            setError(null)
          }
        } catch (err) {
          if (alive.current) setError(err)
        }
      }, [])

      useEffect(() => {
        alive.current = true
        void refresh()
        const tick = setInterval(() => {
          void refresh()
        }, 60000)
        return () => {
          alive.current = false
          clearInterval(tick)
        }
      }, [refresh])

      const toggleConfig = () => {
        const next = !configOpen
        setConfigOpen(next)
        try {
          window.localStorage.setItem(CONFIG_STORAGE_KEY, next ? '1' : '0')
        } catch {
          // 存不下就算了，本次展开仍然有效。
        }
      }

      const toggleSource = (key) => {
        sourcesTouched.current = true
        const next = { ...sources, [key]: !sources[key] }
        setSources(next)
        persistSettings({ sources: sourcesPayload(next) })
      }

      const chooseColorMode = (value) => {
        if (value !== 'change' && value !== 'source') return
        colorModeTouched.current = true
        setColorMode(value)
        persistSettings({ colorMode: value })
      }

      const updateScaleValue = (key, value) => {
        scaleTouched.current[key] = true
        const clamped = clampScale(value, scaleRange)
        if (clamped === null) return
        const next = { ...scales, [key]: clamped }
        setScales(next)
        persistSettings({ scales: scalesPayload(next) })
      }

      // 允许键入 "3." 这类中间态：输入框显示原始文本，但只把合法数字发给 Host。
      const onScaleInput = (key, raw) => {
        scaleTouched.current[key] = true
        setScales((prev) => ({ ...prev, [key]: raw }))
        if (Number.isFinite(Number(raw))) {
          persistSettings({ scales: scalesPayload({ ...scales, [key]: raw }) })
        }
      }

      const commitScale = (key) => {
        const next = toScale(scales[key], key)
        setScales((prev) => ({ ...prev, [key]: next }))
      }

      const stepScale = (key, direction) => {
        const base = toScale(scales[key], key)
        updateScaleValue(key, base + direction * scaleStepOf(key))
      }
      const setAliyunField = (name, value) => {
        const next = { ...aliyunForm, [name]: value }
        setAliyunForm(next)
        if (name === 'accessKeyId' || name === 'accessKeySecret') {
          // 只在用户真的填了密钥时提交；留空字符串在 Host 侧表示「不修改」。
          if (next.accessKeyId || next.accessKeySecret) {
            persistSettings({
              aliyunSecret: { accessKeyId: next.accessKeyId, accessKeySecret: next.accessKeySecret },
            })
          }
          return
        }
        aliyunTouched.current[name] = true
        persistSettings({ aliyun: { couponId: next.couponId, subAccount: next.subAccount } })
      }

      const testAliyun = async () => {
        if (testing) return
        setTesting(true)
        setAliyunStatus(null)
        try {
          const result = await call('aliyun-test', { method: 'POST', body: '{}' })
          if (!alive.current) return
          const details = [t('aliyunTestOk')]
          if (result && result.balance !== undefined && result.balance !== null) {
            details.push(fmtBalance(result.balance))
          }
          if (result && result.status) details.push(String(result.status))
          setAliyunStatus({ kind: 'ok', text: details.join(' · ') })
        } catch (err) {
          if (alive.current) {
            setAliyunStatus({ kind: 'err', text: t('aliyunTestFail') + '：' + ((err && err.message) || String(err)) })
          }
        } finally {
          if (alive.current) setTesting(false)
        }
      }

      /** 把用户选的 csv 整份导入（表里的设置也一起搬过来）。 */
      const importCsv = async (file) => {
        if (busy) return
        setBusy('import')
        setError(null)
        setNotice(null)
        try {
          const bytes = new Uint8Array(await file.arrayBuffer())
          let binary = ''
          const chunk = 0x8000
          for (let index = 0; index < bytes.length; index += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk))
          }
          const result = await call('import', {
            method: 'POST',
            body: JSON.stringify({ data: btoa(binary), name: file.name }),
          })
          if (alive.current) {
            setNotice(
              tf('importDone', { n: result.rows }) +
                (result.adopted ? t('importAdopted') : ''),
            )
          }
          await refresh()
        } catch (err) {
          if (alive.current) setNotice(t('importFail') + '：' + String((err && err.message) || err))
        } finally {
          if (alive.current) setBusy('')
        }
      }

      const run = async (kind) => {
        if (busy) return
        setBusy(kind)
        setError(null)
        setNotice(null)
        try {
          if (kind === 'sample') {
            const result = await call('sample', { method: 'POST', body: '{}' })
            if (alive.current) {
              // sample 现在一次最多写三条线：DS 余额、WB 积分、阿里云卡券
              const records = Array.isArray(result.records) ? result.records : []
              const dsRecord = records.find((item) => item && item.kind === 'ds')
              const wbRecord = records.find((item) => item && item.kind === 'wb')
              const aliyunRecord = records.find((item) => item && (item.kind === 'al' || item.kind === 'aliyun'))
              const utRecord = records.find((item) => item && item.kind === 'ut')
              const parts = []
              if (dsRecord) parts.push(t('sampledDs') + ' ' + fmtBalance(dsRecord.value))
              if (wbRecord) parts.push(t('sampledWb') + ' ' + fmtNumber(wbRecord.value))
              if (aliyunRecord) parts.push(t('sampledAliyun') + ' ' + fmtBalance(aliyunRecord.value))
              if (utRecord) parts.push(t('sampledUt') + ' ' + fmtTokens(utRecord.value))
              const stamp =
                (dsRecord && dsRecord.time) ||
                (wbRecord && wbRecord.time) ||
                (aliyunRecord && aliyunRecord.time) ||
                ''
              const wbFailed = result.wb && result.wb.ok === false
              const aliyunFailed = result.aliyun && result.aliyun.ok === false
              setNotice(
                t('sampled') +
                  (parts.length ? ' ' + parts.join(' · ') : '') +
                  (stamp ? ' · ' + stamp : '') +
                  (wbFailed ? '（' + t('wbFail') + '）' : '') +
                  (aliyunFailed ? '（' + t('aliyunFail') + '）' : ''),
              )
            }
          } else if (kind === 'save') {
            const result = await call('save-chart', {
              method: 'POST',
              body: JSON.stringify({ kind: chart && chart.kind ? chart.kind : 'line' }),
            })
            if (alive.current) setNotice(t('savedTo') + '：' + (result.savedPath || result.fileName || ''))
          } else if (kind === 'open') {
            await call('open-csv', { method: 'POST', body: '{}' })
            if (alive.current) setNotice(t('opened') + (data && data.csvPath ? '：' + data.csvPath : ''))
          } else if (kind === 'line' || kind === 'spend' || kind === 'total') {
            const result = await call('chart', {
              method: 'POST',
              body: JSON.stringify({
                kind,
                from,
                to,
                theme: resolveTheme(theme),
                colorMode,
                // Host 用这两个字段决定画哪几条线、每条线在图上占多高。
                sources: sourcesPayload(sources),
                scales: scalesPayload(scales),
              }),
            })
            if (alive.current) {
              setChart({ dataUrl: result.dataUrl, meta: result.meta || null, kind })
              setNotice(
                (kind === 'spend' ? t('makeSpend') : kind === 'total' ? t('makeTotal') : t('makeLine')) +
                  (result.meta
                    ? '：' + (result.meta.firstDate || '') + ' → ' + (result.meta.lastDate || '') + '，' + result.meta.days + ' 天'
                    : ''),
              )
            }
          }
          if (kind !== 'line' && kind !== 'spend' && kind !== 'total') await refresh()
        } catch (err) {
          if (alive.current) {
            setError(err)
            if (kind === 'line' || kind === 'spend' || kind === 'total') setChart(null)
          }
        } finally {
          if (alive.current) setBusy('')
        }
      }

      const disabled = busy !== ''
      const busyLabel =
        busy === 'line' || busy === 'spend' || busy === 'total'
          ? t('charting')
          : busy === 'sample'
            ? t('sampling')
            : busy === 'open'
              ? t('opening')
              : busy === 'save'
                ? t('saving')
                : ''
      const latest = data ? data.latestBalance : null
      const latestSub = data && data.latestTime ? data.latestTime : t('never')
      const latestWb = data ? data.latestWb : null
      // 多个 WB 账号时写清楚这个数是加总来的（v1.18.4，用户 m09409）。
      const wbAccountCount = data && typeof data.wbAccountCount === 'number' ? data.wbAccountCount : 0
      const latestWbTime = data && data.latestWbTime ? data.latestWbTime : t('never')
      const latestWbSub =
        wbAccountCount > 1 ? String(wbAccountCount) + t('wbAccountsSum') + ' · ' + latestWbTime : latestWbTime
      const latestAliyun = data ? data.latestAliyun : null
      const latestAliyunSub = data && data.latestAliyunTime ? data.latestAliyunTime : t('never')
      const latestUt = data ? data.latestUt : null
      const latestUtSub = data && data.latestUtTime ? data.latestUtTime : t('never')
      const latestUtDay =
        data && typeof data.utToday === 'number' ? data.utToday : null
      const utCount = data && typeof data.utCount === 'number' ? data.utCount : null
      const dsCount = data && typeof data.dsCount === 'number' ? data.dsCount : null
      const wbCount = data && typeof data.wbCount === 'number' ? data.wbCount : null
      const aliyunCount = data && typeof data.aliyunCount === 'number' ? data.aliyunCount : null
      // 折叠时的一行摘要：启用了几条线 + 三个缩放值，展开前也能一眼看到关键配置。
      const activeSourceNames =
        [
          sources.ds !== false ? t('dsShort') : null,
          sources.wb !== false ? t('wbShort') : null,
          sources.aliyun ? t('aliyunShort') : null,
          sources.ut !== false ? t('utShort') : null,
        ]
          .filter(Boolean)
          .join(' · ') || t('sourceNone')
      const scaleSummaryText =
        t('scaleSummary') +
        ' ' +
        [scales.ds, scales.wb, scales.aliyun].map((value) => fmtScale(value) + t('scaleUnit')).join(' / ') +
        ' · ' +
        fmtTokens(scales.ut) +
        ' ' +
        t('utScaleUnit') +
        ' · ' +
        t('intervalLabel') +
        ' ' +
        intervalMinutes +
        t('intervalUnit')
      const configSummaryText = activeSourceNames + ' · ' + scaleSummaryText

      return h(
        'div',
        { style: wide ? { ...S.section, maxWidth: 'none' } : S.section, className: 'gugu-stock-section' },
        h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: S.heading },
            // 「谷谷股」比版本后缀更大更粗（m04735 ③），两段共用同一行基线。
            h('span', { style: S.brand }, t('brand')),
            h('span', { style: S.titleSuffix }, t('titleSuffix')),
          ),
          // 配置块默认折叠：只渲染标题行，展开后才挂载三个板块。
          h(
            'div',
            { style: S.configPanel, className: 'gugu-stock-config' },
            h(
              'button',
              {
                type: 'button',
                style: S.configToggle,
                onClick: toggleConfig,
                'aria-expanded': configOpen ? 'true' : 'false',
                'aria-controls': 'gugu-stock-config-body',
                title: t('configToggleAria'),
              },
              h(
                'span',
                { style: { ...S.configChevron, transform: configOpen ? 'rotate(90deg)' : 'none' } },
                '▸',
              ),
              h('span', null, t('configTitle')),
              h('span', { style: S.configSummary }, configSummaryText),
            ),
            configOpen
              ? h(
                  'div',
                  { id: 'gugu-stock-config-body', style: S.configBody },
                  // ① 打开文件
                  h(
                    'div',
                    { style: S.configGroup },
                    h(
                      'div',
                      { style: S.configGroupTitle },
                      h('span', { style: S.configGroupIndex }, '①'),
                      h('span', null, t('openSection')),
                    ),
                    h(
                      'div',
                      { style: S.configRow },
                      h(
                        'button',
                        {
                          type: 'button',
                          style: disabled ? { ...S.button, ...S.buttonDisabled } : S.button,
                          disabled,
                          onClick: () => {
                            void run('open')
                          },
                        },
                        t('openCsv'),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          style: disabled ? { ...S.button, ...S.buttonDisabled } : S.button,
                          disabled,
                          title: t('importHint'),
                          onClick: () => {
                            if (fileInput.current) fileInput.current.click()
                          },
                        },
                        t('importCsv'),
                      ),
                      h('input', {
                        ref: fileInput,
                        type: 'file',
                        accept: '.csv,text/csv',
                        style: { display: 'none' },
                        onChange: (event) => {
                          const file = event.target.files && event.target.files[0]
                          event.target.value = ''
                          if (file) void importCsv(file)
                        },
                      }),
                    ),
                    h('p', { style: S.path }, data && data.csvPath ? data.csvPath : '—'),
                    h('p', { style: S.hint }, t('openHint')),
                  ),
                  h('div', { style: S.configDivider }),
                  // ② 数据源配置：三个开关 + 阿里云凭据（默认全空，绝不预填真实值）
                  h(
                    'div',
                    { style: S.configGroup },
                    h(
                      'div',
                      { style: S.configGroupTitle },
                      h('span', { style: S.configGroupIndex }, '②'),
                      h('span', null, t('sourceSection')),
                    ),
                    h(
                      'div',
                      { style: S.configRow },
                      ...[
                        ['ds', t('sourceDs')],
                        ['wb', t('sourceWb')],
                        ['aliyun', t('sourceAliyun')],
                        ['ut', t('sourceUt')],
                      ].map(([key, label]) =>
                        h(
                          'button',
                          {
                            key,
                            type: 'button',
                            role: 'switch',
                            'aria-checked': sources[key] ? 'true' : 'false',
                            style: S.toggle,
                            onClick: () => toggleSource(key),
                          },
                          h(
                            'span',
                            { style: sources[key] ? { ...S.toggleTrack, ...S.toggleTrackOn } : S.toggleTrack },
                            h('span', {
                              style: sources[key] ? { ...S.toggleKnob, ...S.toggleKnobOn } : S.toggleKnob,
                            }),
                          ),
                          h('span', null, label),
                        ),
                      ),
                    ),
                    sources.wb
                      ? h('p', { style: S.hint }, t('wbAutoHint'))
                      : null,
                    // 阿里云凭据与测试按钮只在这个数据源打开时展示；
                    // 但表单值保存在 state 里，关掉开关不清空已填内容。
                    ...(sources.aliyun
                      ? [
                    h(
                      'div',
                      { style: S.configRow },
                      h('span', { style: S.fieldLabel }, t('aliyunSubAccount')),
                      h('input', {
                        type: 'text',
                        style: S.fieldInput,
                        value: aliyunForm.subAccount,
                        placeholder: t('aliyunSubAccountHint'),
                        disabled: testing,
                        autoComplete: 'off',
                        'aria-label': t('aliyunSubAccount'),
                        onChange: (event) => setAliyunField('subAccount', event.target.value),
                      }),
                    ),
                    h(
                      'div',
                      { style: S.configRow },
                      h('span', { style: S.fieldLabel }, t('aliyunCouponId')),
                      h('input', {
                        type: 'text',
                        style: S.fieldInput,
                        value: aliyunForm.couponId,
                        placeholder: t('aliyunCouponHint'),
                        disabled: testing,
                        inputMode: 'numeric',
                        autoComplete: 'off',
                        'aria-label': t('aliyunCouponId'),
                        onChange: (event) => setAliyunField('couponId', event.target.value),
                      }),
                    ),
                    h(
                      'div',
                      { style: S.configRow },
                      h('span', { style: S.fieldLabel }, t('accessKeyId')),
                      h('input', {
                        type: 'text',
                        style: S.fieldInput,
                        value: aliyunForm.accessKeyId,
                        // 已保存的密钥不回显，但用掩码占位，避免看起来像「被清空了」。
                        placeholder:
                          data && data.aliyun && data.aliyun.hasAccessKeyId
                            ? (data.aliyun.accessKeyIdMasked || t('accessKeyConfigured'))
                            : t('accessKeyIdHint'),
                        disabled: testing,
                        autoComplete: 'off',
                        spellCheck: false,
                        'aria-label': t('accessKeyId'),
                        onChange: (event) => setAliyunField('accessKeyId', event.target.value),
                      }),
                    ),
                    h(
                      'div',
                      { style: S.configRow },
                      h('span', { style: S.fieldLabel }, t('accessKeySecret')),
                      // type=password：即便用户粘贴了密钥，也不让它在界面上明文停留；
                      // 已有密钥时只提示「已配置」，绝不回显 Host 侧保存的值。
                      h('input', {
                        type: 'password',
                        style: S.fieldInput,
                        value: aliyunForm.accessKeySecret,
                        placeholder:
                          data && data.aliyun && data.aliyun.hasAccessKeySecret
                            ? t('accessKeyConfigured')
                            : t('accessKeySecretHint'),
                        disabled: testing,
                        autoComplete: 'new-password',
                        'aria-label': t('accessKeySecret'),
                        onChange: (event) => setAliyunField('accessKeySecret', event.target.value),
                      }),
                    ),
                    data && data.aliyun && (data.aliyun.hasAccessKeyId || data.aliyun.hasAccessKeySecret)
                      ? h('p', { style: S.configHint }, t('accessKeyStored'))
                      : null,
                    h('p', { style: S.hint }, t('aliyunHelp')),
                    h(
                      'div',
                      { style: S.configRow },
                      h(
                        'button',
                        {
                          type: 'button',
                          style: testing ? { ...S.button, ...S.buttonDisabled } : S.button,
                          disabled: testing,
                          onClick: () => {
                            void testAliyun()
                          },
                        },
                        testing ? t('aliyunTesting') : t('aliyunTest'),
                      ),
                    ),
                    aliyunStatus
                      ? h('div', { style: aliyunStatus.kind === 'err' ? S.error : S.notice }, aliyunStatus.text)
                      : null,
                    data && data.lastAliyunOk === false && data.lastAliyunError
                      ? h('div', { style: S.error }, t('aliyunFail') + '：' + data.lastAliyunError)
                      : null,
                      ]
                      : []),
                  ),
                  h('div', { style: S.configDivider }),
                  // ③ 缩放：三条线各自的高度比例；图表明暗/日期区间归到同一板块的弱分隔线之后。
                  h(
                    'div',
                    { style: S.configGroup },
                    h(
                      'div',
                      { style: S.configGroupTitle },
                      h('span', { style: S.configGroupIndex }, '③'),
                      h('span', null, t('scaleSection')),
                    ),
                    ...['ds', 'wb', 'aliyun', 'ut'].map((key) => {
                      const label =
                        key === 'ds'
                          ? t('balance')
                          : key === 'wb'
                            ? t('wbBalance')
                            : key === 'aliyun'
                              ? t('aliyunBalance')
                              : t('utBalance')
                      const range = scaleRangeOf(key)
                      return h(
                        'div',
                        { key, style: S.configRow },
                        h('span', { style: { ...S.fieldLabel, minWidth: '78px' } }, label),
                        h('input', {
                          type: 'number',
                          style: S.percentInput,
                          value: scales[key],
                          min: String(range.min),
                          max: String(range.max),
                          step: String(scaleStepOf(key)),
                          'aria-label': label,
                          onChange: (event) => onScaleInput(key, event.target.value),
                          onBlur: () => commitScale(key),
                        }),
                        h(
                          'span',
                          { style: S.percentUnit },
                          key === 'ut' ? t('utScaleUnit') : t('wbScaleUnit'),
                        ),
                        h(
                          'div',
                          { style: { display: 'inline-flex', gap: '4px' } },
                          h(
                            'button',
                            {
                              type: 'button',
                              style: S.stepButton,
                              title: t('scaleUp'),
                              'aria-label': t('scaleUp'),
                              onClick: () => stepScale(key, 1),
                            },
                            '▲',
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              style: S.stepButton,
                              title: t('scaleDown'),
                              'aria-label': t('scaleDown'),
                              onClick: () => stepScale(key, -1),
                            },
                            '▼',
                          ),
                        ),
                      )
                    }),
                    h('p', { style: S.hint }, t('utScaleHint')),
                  ),
                    h('div', { style: S.configDivider }),
                    h(
                      'div',
                      { style: S.configGroup },
                      h(
                        'div',
                        { style: S.configGroupTitle },
                        h('span', { style: S.configGroupIndex }, '④'),
                        h('span', null, t('intervalLabel')),
                      ),
                      h(
                        'div',
                        { style: S.configRow },
                        h('span', { style: { ...S.fieldLabel, minWidth: '78px' } }, t('intervalLabel')),
                        h('input', {
                          type: 'number',
                          'data-gugu-interval': '1',
                          style: S.percentInput,
                          value: intervalMinutes,
                          min: '1',
                          max: '1440',
                          step: '1',
                          'aria-label': t('intervalLabel'),
                          title: t('intervalHint'),
                          onChange: (event) => {
                            const n = Math.round(Number(event.target.value))
                            if (!Number.isFinite(n)) return
                            intervalTouched.current = true
                            const next = Math.min(1440, Math.max(1, n))
                            setIntervalMinutes(next)
                            persistSettings({ intervalMinutes: next })
                          },
                        }),
                        h('span', { style: S.percentUnit }, t('intervalUnit')),
                      ),
                    ),
                    h('div', { style: S.configDivider }),
                    h(
                      'div',
                      { style: S.configRow },
                      h('span', { style: S.rangeLabel }, t('themeLabel')),
                      h(
                        'div',
                        { style: S.themeGroup, role: 'group', 'aria-label': t('themeLabel') },
                        ...[
                          ['light', t('themeLight')],
                          ['dark', t('themeDark')],
                          ['auto', t('themeAuto')],
                        ].map(([value, label]) =>
                          h(
                            'button',
                            {
                              key: value,
                              type: 'button',
                              style: theme === value ? S.themeOptionOn : S.themeOptionOff,
                              disabled,
                              'aria-pressed': theme === value ? 'true' : 'false',
                              onClick: () => {
                                themeTouched.current = true
                                setTheme(value)
                                persistSettings({ theme: resolveTheme(value) })
                              },
                            },
                            label,
                          ),
                        ),
                      ),
                    ),
                    h('div', { style: S.configDivider }),
                    h(
                      'div',
                      { style: S.configRow },
                      h('span', { style: S.rangeLabel }, t('colorModeLabel')),
                      h(
                        'div',
                        { style: S.themeGroup, role: 'group', 'aria-label': t('colorModeLabel') },
                        ...[
                          ['change', t('colorModeChange')],
                          ['source', t('colorModeSource')],
                        ].map(([value, label]) =>
                          h(
                            'button',
                            {
                              key: value,
                              type: 'button',
                              style: colorMode === value ? S.themeOptionOn : S.themeOptionOff,
                              disabled,
                              'aria-pressed': colorMode === value ? 'true' : 'false',
                              onClick: () => chooseColorMode(value),
                            },
                            label,
                          ),
                        ),
                      ),
                    ),
                )
              : null,
          ),
          // 三个数值块：只渲染启用的数据源，等宽排在同一行；窄屏自动换行。
          h(
            'div',
            { style: S.statsRow },
            sources.ds !== false
              ? h(Stat, {
                  key: 'ds',
                  flex: true,
                  label: t('balance'),
                  value: fmtBalance(latest),
                  sub: latestSub,
                  tone: toneOf('ds', resolveTheme(theme)),
                })
              : null,
            sources.wb !== false
              ? h(Stat, {
                  key: 'wb',
                  flex: true,
                  label: t('wbBalance'),
                  value: fmtNumber(latestWb),
                  sub: latestWbSub,
                  tone: toneOf('wb', resolveTheme(theme)),
                })
              : null,
            sources.aliyun
              ? h(Stat, {
                  key: 'aliyun',
                  flex: true,
                  label: t('aliyunBalance'),
                  value: fmtBalance(latestAliyun),
                  sub: latestAliyunSub,
                  tone: toneOf('aliyun', resolveTheme(theme)),
                })
              : null,
            // ut 开起来会多两块：左边「日Tokens 消耗」（今天 ut 行之和），右边「总Tokens 消耗」
            // （全表 ut 行之和）。CSV 里每行存的是「这段时间新增的 tokens」，所以两块都是求和。
            sources.ut !== false
              ? h(Stat, {
                  key: 'ut',
                  flex: true,
                  label: t('utBalance'),
                  value: fmtCoarse(latestUtDay != null ? latestUtDay : 0),
                  sub: latestUtSub,
                  tone: toneOf('ut', resolveTheme(theme)),
                })
              : null,
            sources.ut !== false
              ? h(Stat, {
                  key: 'utTotal',
                  flex: true,
                  label: t('utTotalBalance'),
                  value: fmtCoarse(data && typeof data.utTotal === 'number' ? data.utTotal : 0),
                  sub: latestUtSub,
                  tone: toneOf('ut', resolveTheme(theme)),
                })
              : null,
          ),
          h(
            'div',
            { style: S.statsPair },
            h(Stat, {
              label: t('points'),
              // 记录条数是实打实的行数，不做粗粒度缩写（用户 m12388：写实际数值）。
              value: data ? String(data.rows) : '—',
              sub: data
                ? [
                    t('days') + ' ' + data.days,
                    dsCount === null ? null : 'DS ' + dsCount,
                    wbCount === null ? null : 'WB ' + wbCount,
                    aliyunCount === null ? null : t('aliyunShort') + ' ' + aliyunCount,
                    utCount === null ? null : t('utShort') + ' ' + utCount,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : '',
            }),
            h(Stat, {
              label: t('lastSample'),
              value: data ? fmtClock(data.lastAttemptAt) : '—',
              sub: data && data.nextSampleAt ? t('nextSample') + ' ' + fmtClock(data.nextSampleAt) : '',
            }),
          ),
          // 日期区间：只影响出图的时间范围，不写进配置块，放在生成按钮正上方。
          h(
            'div',
            { style: S.rangeRow },
            h('span', { style: S.rangeLabel }, t('rangeLabel')),
            h('span', { style: S.rangeLabel }, t('rangeFrom')),
            h('input', {
              type: 'date',
              style: S.input,
              value: from,
              min: '1970-01-01',
              max: to || defaultRange(data).today,
              disabled,
              'aria-label': t('rangeFrom'),
              onChange: (event) => {
                touched.current = true
                setFrom(event.target.value)
              },
            }),
            h('span', { style: S.rangeLabel }, t('rangeTo')),
            h('input', {
              type: 'date',
              style: S.input,
              value: to,
              min: from || '1970-01-01',
              max: defaultRange(data).today,
              disabled,
              'aria-label': t('rangeTo'),
              onChange: (event) => {
                touched.current = true
                setTo(event.target.value)
              },
            }),
            h(
              'button',
              {
                type: 'button',
                style: disabled ? { ...S.button, ...S.buttonDisabled } : S.button,
                disabled,
                onClick: () => {
                  const next = defaultRange(data)
                  touched.current = false
                  setFrom(next.from)
                  setTo(next.to)
                  setNotice(t('rangeReset'))
                },
              },
              t('rangeReset'),
            ),
          ),
          // 主操作行：立即采样 + 两个生成按钮；其余入口全部收进上面的配置块。
          // 表格顺序由插件自动整理（启动 / 每次采样后 / 出图前），界面不再给按钮。
          h(
            'div',
            { style: S.row },
            h(
              'button',
              {
                type: 'button',
                style: disabled ? { ...S.button, ...S.buttonDisabled } : S.button,
                disabled,
                onClick: () => {
                  void run('sample')
                },
              },
              t('sampleNow'),
            ),
            h(
              'button',
              {
                type: 'button',
                style: disabled ? { ...S.buttonPrimary, ...S.buttonDisabled } : S.buttonPrimary,
                disabled,
                onClick: () => {
                  void run('line')
                },
              },
              t('makeLine'),
            ),
            h(
              'button',
              {
                type: 'button',
                style: disabled ? { ...S.buttonPrimary, ...S.buttonDisabled } : S.buttonPrimary,
                disabled,
                onClick: () => {
                  void run('spend')
                },
              },
              t('makeSpend'),
            ),
            h(
              'button',
              {
                type: 'button',
                style: disabled ? { ...S.buttonPrimary, ...S.buttonDisabled } : S.buttonPrimary,
                disabled,
                onClick: () => {
                  void run('total')
                },
              },
              t('makeTotal'),
            ),
            busyLabel ? h('span', { style: S.spinner }, busyLabel) : null,
          ),
          data && data.lastSampleOk === false && data.lastSampleError
            ? h('div', { style: S.error }, t('lastError') + '：' + data.lastSampleError)
            : null,
        ),
        notice ? h('div', { style: S.notice }, notice) : null,
        error ? h('div', { style: S.error }, t('error') + '：' + (error.message || String(error)) + (error.code ? '（' + error.code + '）' : '')) : null,
        data && data.rows === 0 && !chart ? h('div', { style: S.notice }, t('emptyCsv')) : null,
        chart
          ? h(
              'div',
              { style: S.card },
              h('img', {
                style: S.image,
                src: chart.dataUrl,
                alt: chart.kind === 'spend' ? t('makeSpend') : chart.kind === 'total' ? t('makeTotal') : t('chartAlt'),
                title: t('zoomHint'),
                onDoubleClick: () => setZoom(true),
              }),
              h(
                'div',
                { style: S.chartActions },
                h(
                  'button',
                  {
                    type: 'button',
                    style: disabled ? { ...S.button, ...S.buttonDisabled } : S.button,
                    disabled,
                    onClick: () => {
                      void run('save')
                    },
                  },
                  t('saveChart'),
                ),
              ),
              h('p', { style: S.path }, t('zoomHint')),
              chart.meta
                ? h('p', { style: S.path }, chart.meta.days + ' 天 · ' + chart.meta.points + ' 个节点 · ' + (chart.meta.firstDate || '') + ' → ' + (chart.meta.lastDate || ''))
                : null,
            )
          : null,
        zoom && chart
          ? h(
              'div',
              { style: S.zoomOverlay, onClick: () => setZoom(false), role: 'presentation' },
              h('img', { style: S.zoomImage, src: chart.dataUrl, alt: t('chartAlt') }),
              h('p', { style: S.zoomClose }, t('zoomClose')),
            )
          : null,
      )
    }

    const panelOuter = {
      height: '100%',
      minHeight: 0,
      overflow: 'auto',
      boxSizing: 'border-box',
      padding: '24px clamp(16px, 4vw, 48px) 32px',
      color: 'var(--dsw-alias-label-primary)',
    }

    const panelInner = { maxWidth: '920px', margin: '0 auto' }

    /** Left-rail panel: same body as the settings page, laid out page-wide. */
    function GuguPanel() {
      return h('div', { className: 'gugu-stock-panel', style: panelOuter }, h('div', { style: panelInner }, h(GuguSection, { wide: true })))
    }

    function GuguIcon(props) {
      const size = props && Number.isFinite(props.size) ? props.size : 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M3 20h18', opacity: 0.55 }),
        h('path', { d: 'M4 15.5 8.5 10l3.5 3.5L16 7l4 5.5' }),
        h('circle', { cx: 8.5, cy: 10, r: 1.6, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 16, cy: 7, r: 1.6, fill: 'currentColor', stroke: 'none' }),
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      // Central panel reached from the left rail (sidebar.panellist id must match).
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: 'gugu-stock' }, GuguPanel),
      )
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: 'gugu-stock', order: 40, label: () => t('nav') },
          (props) => h(GuguIcon, props || {}),
        ),
      )
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'gugu-stock', order: 30, label: () => t('nav') },
          GuguSection,
        ),
      )
      ctx.slots.inject('settings.section.icon', () =>
        ctx.slots.register(
          { name: 'settings.section.icon', id: 'gugu-stock', order: 30, label: () => t('nav') },
          (props) => h(GuguIcon, props || {}),
        ),
      )
    }

    return { inject, apply }
  },
})
