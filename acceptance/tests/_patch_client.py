# -*- coding: utf-8 -*-
"""补丁 4：界面加日期区间、重置按钮与两个生成按钮。"""
from pathlib import Path

path = Path(__file__).resolve().parents[2] / "dsh-gugu-stock" / "client.js"
src = path.read_text(encoding="utf-8")


def swap(old: str, new: str) -> None:
    global src
    assert old in src, old[:80]
    src = src.replace(old, new, 1)


# 1) 中文文案
swap(
    """        makeChart: '生成谷谷股图',
        charting: '正在用 Python 出图…',""",
    """        makeLine: '生成 · 余额折线图',
        makeSpend: '生成 · 花费柱状图',
        rangeLabel: '日期区间',
        rangeFrom: '起始',
        rangeTo: '结束',
        rangeReset: '重置为最近 60 天',
        rangeHint: '默认含今天在内的最近 60 天；改完日期直接点生成即可。',
        spendNote: '花费 = 当天余额下降的总额；充值和赠金上涨不计入当天花费。',
        charting: '正在用 Python 出图…',""",
)

# 2) 英文文案
swap(
    """        makeChart: 'Generate chart',
        charting: 'Rendering with Python…',""",
    """        makeLine: 'Generate · balance line',
        makeSpend: 'Generate · daily spend',
        rangeLabel: 'Date range',
        rangeFrom: 'From',
        rangeTo: 'To',
        rangeReset: 'Reset to last 60 days',
        rangeHint: 'Defaults to the last 60 days including today; change the dates, then generate.',
        spendNote: 'Spend = the total of intraday balance drops; top-ups are ignored.',
        charting: 'Rendering with Python…',""",
)

# 3) 样式：日期输入与区间行
swap(
    "      buttonDisabled: { opacity: 0.55, cursor: 'not-allowed' },",
    """      buttonDisabled: { opacity: 0.55, cursor: 'not-allowed' },
      rangeRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' },
      rangeLabel: { fontSize: '12.5px', color: 'var(--dsw-alias-label-secondary)' },
      input: {
        padding: '6px 8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base, #ffffff)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12.5px',
        lineHeight: '18px',
        fontFamily: 'inherit',
      },""",
)

# 4) 组件状态
swap(
    """      const [zoom, setZoom] = useState(false)
      const alive = useRef(true)""",
    """      const [zoom, setZoom] = useState(false)
      const [from, setFrom] = useState('')
      const [to, setTo] = useState('')
      const alive = useRef(true)

      // 区间默认值由 Host 计算（含今天在内的最近 60 天），只在还没填过的时候写入。
      useEffect(() => {
        if (!data || !data.range) return
        if (from === '' && to === '') {
          setFrom(data.range.defaultFrom || '')
          setTo(data.range.defaultTo || '')
        }
      }, [data, from, to])""",
)

# 5) run：line / spend 两个生成分支
swap(
    """          } else if (kind === 'chart') {
            const result = await call('chart', { method: 'POST', body: '{}' })
            if (alive.current) {
              setChart({ dataUrl: result.dataUrl, meta: result.meta || null })
              setNotice(
                t('charted') + (result.meta ? '：' + result.meta.days + ' 天 / ' + result.meta.points + ' 个节点' : ''),
              )
            }
          }
          if (kind !== 'chart') await refresh()""",
    """          } else if (kind === 'line' || kind === 'spend') {
            const result = await call('chart', {
              method: 'POST',
              body: JSON.stringify({ kind, from, to }),
            })
            if (alive.current) {
              setChart({ dataUrl: result.dataUrl, meta: result.meta || null, kind })
              setNotice(
                (kind === 'spend' ? t('makeSpend') : t('makeLine')) +
                  (result.meta
                    ? '：' + (result.meta.firstDate || '') + ' → ' + (result.meta.lastDate || '') + '，' + result.meta.days + ' 天'
                    : ''),
              )
            }
          }
          if (kind !== 'line' && kind !== 'spend') await refresh()""",
)

# 6) 出错时清掉图表，改为按 kind 判断
swap(
    """            if (kind === 'chart') setChart(null)""",
    """            if (kind === 'line' || kind === 'spend') setChart(null)""",
)

# 7) busyLabel 与禁用态
swap(
    "      const busyLabel = busy === 'chart' ? t('charting') : busy === 'sample' ? t('sampling') : busy === 'open' ? t('opening') : ''",
    "      const busyLabel =\n        busy === 'line' || busy === 'spend'\n          ? t('charting')\n          : busy === 'sample'\n            ? t('sampling')\n            : busy === 'open'\n              ? t('opening')\n              : ''",
)

# 8) 按钮区：日期区间 + 重置 + 两个生成按钮
swap(
    """            h(
              'button',
              {
                type: 'button',
                style: disabled ? { ...S.buttonPrimary, ...S.buttonDisabled } : S.buttonPrimary,
                disabled,
                onClick: () => {
                  void run('chart')
                },
              },
              t('makeChart'),
            ),
            busyLabel ? h('span', { style: S.spinner }, busyLabel) : null,
          ),""",
    """            busyLabel ? h('span', { style: S.spinner }, busyLabel) : null,
          ),
          h(
            'div',
            { style: S.rangeRow },
            h('span', { style: S.rangeLabel }, t('rangeLabel')),
            h('span', { style: S.rangeLabel }, t('rangeFrom')),
            h('input', {
              type: 'date',
              style: S.input,
              value: from,
              disabled,
              'aria-label': t('rangeFrom'),
              onChange: (event) => setFrom(event.target.value),
            }),
            h('span', { style: S.rangeLabel }, t('rangeTo')),
            h('input', {
              type: 'date',
              style: S.input,
              value: to,
              disabled,
              'aria-label': t('rangeTo'),
              onChange: (event) => setTo(event.target.value),
            }),
            h(
              'button',
              {
                type: 'button',
                style: disabled ? { ...S.button, ...S.buttonDisabled } : S.button,
                disabled,
                onClick: () => {
                  const range = (data && data.range) || {}
                  setFrom(range.defaultFrom || '')
                  setTo(range.defaultTo || '')
                  setNotice(t('rangeReset'))
                },
              },
              t('rangeReset'),
            ),
          ),
          h('p', { style: S.path }, t('rangeHint')),
          h(
            'div',
            { style: S.row },
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
          ),
          h('p', { style: S.path }, t('spendNote')),""",
)

# 9) 图表卡片：折线/柱状分别给 alt
swap(
    """                alt: t('chartAlt'),""",
    """                alt: chart.kind === 'spend' ? t('makeSpend') : t('chartAlt'),""",
)

path.write_text(src, encoding="utf-8")
print("patched client.js")
