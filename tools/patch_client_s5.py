#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""客户端补丁（S5）：两行统计卡（DS余额/WB积分、记录条数/最近采样）、数值最多 1 位小数、采样提示含 WB。"""
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "client.js"
text = TARGET.read_text(encoding="utf-8")


def sub(old: str, new: str) -> None:
    global text
    assert old in text, f"未找到：\n{old[:200]}"
    text = text.replace(old, new, 1)


# ---------- 文案 ----------
sub(
    "        balance: '最新余额',\n",
    "        balance: 'DS余额',\n"
    "        wbBalance: 'WB积分',\n",
)
sub(
    "        balance: 'Latest balance',\n",
    "        balance: 'DS balance',\n"
    "        wbBalance: 'WB credits',\n",
)
sub(
    "        intro:\n"
    "          'DSH 运行时会每 15 分钟读取一次总余额',\n",
    "        intro:\n"
    "          'DSH 运行时每 15 分钟读取一次 DS 总余额和 WorkBuddy 积分',\n",
)
sub(
    "        intro:\n"
    "          'While DSH runs it reads the total balance every 15 minutes.',\n",
    "        intro:\n"
    "          'While DSH runs it reads the DS balance and WorkBuddy credits every 15 minutes.',\n",
)
sub(
    "        sampled: '已记录',\n",
    "        sampled: '已记录',\n"
    "        sampledDs: 'DS',\n"
    "        sampledWb: 'WB',\n"
    "        wbFail: 'WB 积分读取失败',\n",
)
sub(
    "        sampled: 'Recorded',\n",
    "        sampled: 'Recorded',\n"
    "        sampledDs: 'DS',\n"
    "        sampledWb: 'WB',\n"
    "        wbFail: 'WB credits unavailable',\n",
)

# ---------- 数值格式：最多 1 位小数，整数就是整数 ----------
sub(
    "    const fmtBalance = (value) => {\n"
    "      if (value === null || value === undefined || value === '') return '—'\n"
    "      const n = Number(value)\n"
    "      return Number.isFinite(n) ? '¥ ' + String(Number(n.toFixed(6))) : String(value)\n"
    "    }\n",
    "    // 界面上数字最多 1 位小数，整数就显示整数（CSV 里仍按 6 位精度落盘）\n"
    "    const fmtNumber = (value) => {\n"
    "      if (value === null || value === undefined || value === '') return '—'\n"
    "      const n = Number(value)\n"
    "      return Number.isFinite(n) ? String(Number(n.toFixed(1))) : String(value)\n"
    "    }\n"
    "\n"
    "    const fmtBalance = (value) => {\n"
    "      const text = fmtNumber(value)\n"
    "      return text === '—' ? text : '¥ ' + text\n"
    "    }\n",
)

# ---------- 统计卡：两行 ----------
sub(
    "      stats: {\n"
    "        display: 'grid',\n"
    "        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',\n"
    "        gap: '12px',\n"
    "      },\n",
    "      stats: {\n"
    "        display: 'grid',\n"
    "        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',\n"
    "        gap: '12px',\n"
    "      },\n"
    "      statsPair: {\n"
    "        display: 'grid',\n"
    "        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',\n"
    "        gap: '12px',\n"
    "      },\n",
)

sub(
    "      const latest = data ? data.latestBalance : null\n"
    "      const latestSub = data && data.latestTime ? data.latestTime : t('never')\n",
    "      const latest = data ? data.latestBalance : null\n"
    "      const latestSub = data && data.latestTime ? data.latestTime : t('never')\n"
    "      const latestWb = data ? data.latestWb : null\n"
    "      const latestWbSub = data && data.latestWbTime ? data.latestWbTime : t('never')\n"
    "      const dsCount = data && typeof data.dsCount === 'number' ? data.dsCount : null\n"
    "      const wbCount = data && typeof data.wbCount === 'number' ? data.wbCount : null\n",
)

sub(
    "          h(\n"
    "            'div',\n"
    "            { style: S.stats },\n"
    "            h(Stat, { label: t('balance'), value: fmtBalance(latest), sub: latestSub }),\n"
    "            h(Stat, { label: t('points'), value: data ? String(data.rows) : '\u2014', sub: data ? t('days') + ' ' + data.days : '' }),\n"
    "            h(Stat, { label: t('lastSample'), value: data ? fmtClock(data.lastAttemptAt) : '\u2014', sub: data && data.nextSampleAt ? t('nextSample') + ' ' + fmtClock(data.nextSampleAt) : '' }),\n"
    "          ),\n",
    "          // 第一行：两条线的当前值；第二行：记录条数与最近采样\n"
    "          h(\n"
    "            'div',\n"
    "            { style: S.statsPair },\n"
    "            h(Stat, { label: t('balance'), value: fmtBalance(latest), sub: latestSub }),\n"
    "            h(Stat, { label: t('wbBalance'), value: fmtNumber(latestWb), sub: latestWbSub }),\n"
    "          ),\n"
    "          h(\n"
    "            'div',\n"
    "            { style: S.statsPair },\n"
    "            h(Stat, {\n"
    "              label: t('points'),\n"
    "              value: data ? String(data.rows) : '\u2014',\n"
    "              sub: data\n"
    "                ? [\n"
    "                    t('days') + ' ' + data.days,\n"
    "                    dsCount === null ? null : 'DS ' + dsCount,\n"
    "                    wbCount === null ? null : 'WB ' + wbCount,\n"
    "                  ]\n"
    "                    .filter(Boolean)\n"
    "                    .join(' \u00b7 ')\n"
    "                : '',\n"
    "            }),\n"
    "            h(Stat, {\n"
    "              label: t('lastSample'),\n"
    "              value: data ? fmtClock(data.lastAttemptAt) : '\u2014',\n"
    "              sub: data && data.nextSampleAt ? t('nextSample') + ' ' + fmtClock(data.nextSampleAt) : '',\n"
    "            }),\n"
    "          ),\n",
)

TARGET.write_text(text, encoding="utf-8")
print("patched client.js (S5 stats)")
