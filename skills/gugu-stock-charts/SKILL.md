---
name: gugu-stock-charts
description: "谷谷股：一条命令生成三张图：DS 余额折线图、WB 积分花费柱状图、消耗累计图（含 Tokens 日消耗、阿里云卡券线），并把 PNG 作为附件发到当前会话。当用户说「谷谷股」「看我的余额图」「出折线图/柱状图/消耗累计图」「把谷谷股图发我」或任何会话里想直接拿到这三张图时使用。图的样子严格跟随面板设置，不接受任何自定义参数。会话里无法执行 shell 时，可用插件工具 gugu_stock（kind=both）直接出三张图。"
---

# 谷谷股图表通道

**你只需要做两件事：跑一条命令，然后把命令最后打印的两个路径发出去。** 不要读 CSV、不要算时间窗、不要拼参数、不要改脚本。

```bash
bash ~/.dsh/skills/gugu-stock-charts/scripts/gugu-charts.sh
```

（这条命令在任意目录都能跑；相对写法 `bash scripts/gugu-charts.sh` 只在 skill 目录内可用。）

- **纯只读：出图绝不采样、绝不写 CSV**。要新数据请到面板点「立即采样」或等 15 分钟定时。数据 + 设置没变时直接复用上次渲染。
- 默认耗时 0.6–1.5 秒；输出目录默认 `<当前工作目录>/gugu-charts/<YYYYMMDD-HHMMSS>/`。
- 最后两行就是你要的东西：

```
CHART_FILES C:\...\line.png|C:\...\spend.png|C:\...\total.png|C:\...\result.json
SEND C:\...\line.png|C:\...\spend.png|C:\...\total.png
```

## 发回当前会话（唯一要做的第二步）

拿 `SEND` 那行的三个路径直接发，**三张都发**：Web / Desktop 用 `present`，IM 用 `dsh_im_return_file`。

```
present files: <SEND 的第 1 个路径>, <SEND 的第 2 个路径>, <SEND 的第 3 个路径>
```

再补一句话范围即可（脚本已打印 `SUMMARY {...}` 里的 `firstDate` / `lastDate`，直接用它，不要贴 JSON）：

> 最近 60 天（2026-09-25 → 2026-11-23）：依次是每日最终余额折线图、每日花费柱状图、消耗累计图。

如果工具调用失败，就把 `SEND` 那三个 Windows 路径原样贴给用户，让他直接打开。

## 会话里无法执行 shell 时：改用插件工具

如果这个会话里没有可用的 shell 通道（Windows 上没有名为 `bash` 的工具；PTC 会话要经 `run_code` 调 `tools.ops_bash`），不要改脚本、不要自己拼 matplotlib，直接用谷谷股插件自带的工具，它跑的是同一套渲染器、同一份 `settings.json`：

```
gugu_stock(action="chart", kind="both")
```

- 返回 `charts[]`：每项有 `kind`（line / spend / total）、`chartPath`（Windows 绝对路径）、`days`、`points`；三张都要发。
- 然后照旧发那两个 `chartPath`：Web / Desktop 用 `present`，IM 用 `dsh_im_return_file`。
- 只要一张就用 `kind="line"` 或 `kind="spend"`；工具里没有 shell 也能用，不需要任何命令。
- 想让图「更好看」？同样只能让用户去面板改，工具不接受主题 / 时间窗以外的自定义参数。

## 唯一允许的三个参数（都不影响图形内容）

| 参数 | 作用 | 默认 |
|---|---|---|
| `--out DIR` | 换输出目录 | 工作目录下 `gugu-charts/<时间戳>` |
| `--only line` / `--only spend` | 只出一张（用户只要折线图时用，更快） | 三张都出 |
| `--no-sample` | 兼容保留，现在默认就不采样 | 无效果（本身就是只读） |

## 硬规则：图的样子完全由面板决定

主题、颜色来源（涨红跌绿 / 按数据源）、数据源开关、四条线缩放。时间窗，全部从插件写的 `settings.json` 读取，**与面板上点「生成折线图 / 生成柱状图」逐字节相同**。

第四个数据源 `ut` 是「Tokens 日消耗」：插件每 15 分钟把 DSH 全部会话（含已归档）累计 tokens 追加进同一个 CSV，图上是一条紫色线，每天 00:00 从 0 起、数字写成「6200万 / 1亿2000万」，柱子也是紫色。它的缩放是「多少 tokens 折 1 格」，面板里单独一行。

- ❌ 不要传 `--days / --from / --to / --theme / --wb-percent / --sources / --color-mode / --scale-*`，传了脚本直接 `GUGU_FIXED_SETTINGS` 退出 64。
- ❌ 不要为了「更好看」改脚本或绕开脚本直接调 `gugu_chart.py`。
- ✅ 用户说「换成亮色」「WB 调高一点」→ 让他去谷谷股设置面板改，改完再跑一次本命令。

## 出错时

| 输出 | 含义 | 处理 |
|---|---|---|
| `GUGU_FIXED_SETTINGS` | 你传了已停用的参数 | 去掉参数重跑 |
| `GUGU_NO_SETTINGS` | 读不到面板设置 | 让用户打开一次谷谷股面板 |
| `GUGU_NO_SOURCE` | 四个数据源都关着 | 让用户去设置页打开至少一个 |
| `GUGU_NO_CSV` | 还没有数据文件 | 让用户点「立即采样」或等 15 分钟 |
| `GUGU_EMPTY` | 区间内没有节点 | 说明还没数据，别硬画 |
| `GUGU_NO_MATPLOTLIB` | 缺 matplotlib | 脚本会自动装；仍失败就 `py -3.12 -m pip install --user matplotlib` |
| `GUGU_NO_PYTHON` | 找不到解释器 | 用 `GUGU_PYTHON` 指定 python.exe |

## 其它

1. **只读**：绝不采样、绝不写 `balances-v2.csv`，也绝不删行。脚本里没有任何 POST /api/sample 调用（v1.23.2 起彻底移除）。
2. 图里的数字、颜色、网格都跟面板一致，不要描述成「另一个版本」。
3. 用户没提时间范围时，不要自己说「最近 7 天」——就是面板的最近 60 天。