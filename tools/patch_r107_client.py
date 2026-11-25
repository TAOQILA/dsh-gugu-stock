"""一次性补丁：v1.7 客户端改动（client.js）。

④⑧ 版本号 1.5 -> 1.7（标题）
⑨ WB 缩放默认 2.5；用户改完即时提交（不用等生成图）并回读服务端 settings
⑪ 删除面板顶部文案「DSH 运行时每 15 分钟读取一次 DS 总余额和 WorkBuddy 积分」
"""
from pathlib import Path

CLIENT = Path(__file__).resolve().parent.parent / "client.js"
text = CLIENT.read_text(encoding="utf-8")
original = text


def apply(name: str, old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f"PATCH FAILED [{name}]: pattern not found")
    if text.count(old) > 1:
        raise SystemExit(f"PATCH FAILED [{name}]: {text.count(old)} matches")
    text = text.replace(old, new, 1)
    print(f"ok [{name}]")


# ---- 版本号 ----
apply("zh title v1.7", "title: '谷谷股 v1.5 · 自用小账本',", "title: '谷谷股 v1.7 · 自用小账本',")
apply(
    "en title v1.7",
    "title: 'Gugu Stock v1.5 · Personal ledger',",
    "title: 'Gugu Stock v1.7 · Personal ledger',",
)

# ---- ⑪ 删除 intro 文案（键改空串，渲染处再跳过空串）----
apply(
    "zh intro removed",
    """        intro:
          'DSH 运行时每 15 分钟读取一次 DS 总余额和 WorkBuddy 积分',
""",
    """        intro: '',
""",
)
apply(
    "en intro removed",
    """        intro:
          'While DSH runs it reads the DS balance and WorkBuddy credits every 15 minutes.',
""",
    """        intro: '',
""",
)
apply(
    "skip empty intro render",
    """        h('p', { style: S.intro }, t('intro')),
""",
    """        t('intro') ? h('p', { style: S.intro }, t('intro')) : null,
""",
)

# ---- ⑨ 默认 2.5 ----
apply("client default percent 2.5", "const WB_PERCENT_DEFAULT = 1.5", "const WB_PERCENT_DEFAULT = 2.5")

CLIENT.write_text(text, encoding="utf-8")
print(f"patched client.js ({len(original)} -> {len(text)})")