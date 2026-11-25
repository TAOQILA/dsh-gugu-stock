"""ut（日 Tokens 消耗）图表断言（v1.19）。

覆盖用户 m09984 / m10385 / m11760 的硬要求：
  1) CSV 里只写一列 `ut`，值是「这次比上次多了多少 tokens」（v1.21 起是增量），
     不需要调用方手输；
  2) 折线图上 ut 是紫色，且在 change / source 两种配色模式下都保持紫色；
  3) 每天 00:00 那个点一定是 0（日消耗当天清零），当天随后每个采样点画累计值；
  4) 只有每天最后一个采样点带数字，数字用中文单位（6200万 / 1亿2000万）；
  5) 柱状图里 ut 是一根紫色柱子，柱顶数字同样用中文单位。
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
from _plugin_path import PLUGIN, SCRIPTS  # noqa: E402
PLUGIN = str(PLUGIN)
CHART = os.path.join(PLUGIN, "scripts", "gugu_chart.py")
PY = sys.executable

PURPLE_LIGHT = (124, 58, 237)   # #7c3aed
PURPLE_DARK = (167, 139, 250)   # #a78bfa


def write_csv(path):
    """两天 ds + 三天 ut。ut 行是增量，每天加起来正好 6200 万。"""
    rows = [
        ("2026-11-01 09:00:00", "ds", "20.0"),
        ("2026-11-01 23:00:00", "ds", "18.0"),
        ("2026-11-02 09:00:00", "ds", "16.0"),
        ("2026-11-02 23:00:00", "ds", "15.0"),
        # 11-04 只有 DS、没有 ut：用户 m12026 要求这天也必须画成 0。
        ("2026-11-04 09:00:00", "ds", "30.0"),
        # ut 增量：11-01 三段合计 62,000,000，11-02 两段合计 62,000,000，
        # 11-03 一段 62,000,000；11-04 没有任何 ut 采样。
        ("2026-11-01 15:00:00", "ut", "1000000"),
        ("2026-11-01 20:00:00", "ut", "30000000"),
        ("2026-11-01 23:59:00", "ut", "31000000"),
        ("2026-11-02 09:00:00", "ut", "8000000"),
        ("2026-11-02 23:59:00", "ut", "54000000"),
        ("2026-11-03 23:59:00", "ut", "62000000"),
    ]
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        handle.write("时间,来源,数值\r\n")
        for row in rows:
            handle.write(",".join(row) + "\r\n")


def render(csv_path, out, extra):
    meta_path = out + ".json"
    subprocess.run(
        [PY, CHART, "--csv", csv_path, "--out", out, "--meta", meta_path, "--no-settings", *extra],
        check=True,
        capture_output=True,
    )
    with open(meta_path, encoding="utf-8") as handle:
        return json.load(handle)


def ut_points_of(meta):
    """meta 里 utPoints 是节点数；真正的点表在 seriesLines 的 ut 行（ut 当主序列时在 points）。"""
    for line in meta.get("seriesLines") or []:
        if line.get("name") == "ut":
            return line.get("points") or []
    return meta.get("points") or []


def purpleish(png_path):
    """v1.20.3 起 ut 不画折线/节点，只画一层半透明紫面积（柱状图也是半透明柱），
    所以纯色像素几乎为零，改数「偏紫」的像素：蓝明显高于绿、红也略高于绿。"""
    from PIL import Image

    image = Image.open(png_path).convert("RGB")
    pixels = image.load()
    total = 0
    for y in range(image.size[1]):
        for x in range(image.size[0]):
            r, g, b = pixels[x, y]
            if b - g > 25 and r - g > 8 and b > r:
                total += 1
    return total


def pixel_colors(png_path, palette):
    from PIL import Image

    image = Image.open(png_path).convert("RGB")
    counts = {}
    for color in palette:
        counts[color] = 0
    pixels = image.load()
    for y in range(image.size[1]):
        for x in range(image.size[0]):
            if pixels[x, y] in counts:
                counts[pixels[x, y]] += 1
    return counts


checks = 0


def check(condition, message):
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


def main():
    tmp = tempfile.mkdtemp(prefix="gugu-ut-")
    csv_path = os.path.join(tmp, "ut.csv")
    write_csv(csv_path)

    for theme, purple, grid, text in (
        ("light", PURPLE_LIGHT, (255, 255, 255), (109, 40, 217)),
        ("dark", PURPLE_DARK, (31, 31, 31), (187, 163, 255)),
    ):
        line_png = os.path.join(tmp, f"line-{theme}.png")
        meta = render(csv_path, line_png, ["--sources", "ut", "--theme", theme, "--max-days", "5"])

        # ut 自己当主序列时也必须是紫色、纵轴标题写成 Tokens 消耗
        check(meta["drawn"] == ["ut"], f"ut-only should draw just ut, got {meta['drawn']}")
        check(meta["primary"] == "ut", f"ut should be the primary series, got {meta['primary']}")
        check(meta["utDivisor"] == 12500000, f"default divisor should be 12,500,000, got {meta['utDivisor']}")

        check(meta["utPoints"] > 0, "ut points missing")
        midnight = meta["utMidnight"]
        check(len(midnight) == 4, f"one midnight point per day, got {len(midnight)}")
        # 没有 ut 采样的 11-04 也要有一个 00:00 的 0（不是跳过这一天）。
        check(
            any(point["date"] == "2026-11-04" for point in midnight),
            "a day without ut samples still gets a midnight point",
        )
        for point in midnight:
            check(point["time"] == "00:00:00", f"{point['date']} should start at 00:00, got {point['time']}")
            check(float(point["value"]) == 0.0, f"{point['date']} 00:00 must be 0 tokens, got {point['value']}")
        last_per_day = {}
        for item in meta["utDailyLast"]:
            last_per_day[item["date"]] = item

        # 增量口径：当天所有 ut 行相加。
        check(float(last_per_day["2026-11-01"]["balance"]) == 62000000.0, "11-01 day total = 62,000,000")
        check(float(last_per_day["2026-11-02"]["balance"]) == 62000000.0, "11-02 day total = 62,000,000")
        check(float(last_per_day["2026-11-03"]["balance"]) == 62000000.0, "11-03 day total = 62,000,000")
        check(float(last_per_day["2026-11-04"]["balance"]) == 0.0, "11-04 has no ut data -> 0")
        # y = 日消耗 / divisor（每格 500 万 tokens）
        check(abs(float(last_per_day["2026-11-02"]["y"]) - 62000000.0 / 12500000) < 1e-9, "y uses the divisor")

        # 每天只有一个带数字的节点，且用中文单位
        texts = [item["text"] for item in meta["labels"]]
        # 粗粒度单位（v1.20.5 起）：62,000,000 落在「千万」这一档 → 6千万
        check(texts.count("6千万") == 3, f"Chinese unit labels wrong: {texts}")
        # 两个 0：11-01 的 00:00 起点，以及 11-04 一整天没有 ut 数据。
        check(texts.count("0") == 2, f"the ut-less day is labelled 0: {texts}")

        colors = pixel_colors(line_png, [purple])
        # 折线与节点都不画了：纯色紫应当基本消失，换成一大片半透明紫面积。
        check(colors[purple] < 400, f"{theme}: ut should draw no opaque line/nodes (legend swatch only), got {colors[purple]} px")
        # v1.20.6：ut 的每日数字搬到横轴下方（日期标签上方），所以底部这条带
        # 里必须能看到紫色文字；同时图里不再出现 ut 数字。
        from PIL import Image

        bottom = Image.open(line_png).convert("RGB")
        width, height = bottom.size
        pixels = bottom.load()
        under_axis = 0
        for y in range(int(height * 0.76), height):
            for x in range(width):
                r, g, b = pixels[x, y]
                if b - g > 15 and r - g > 4 and b > 90:
                    under_axis += 1
        check(under_axis > 150, f"ut numbers live in the band under the x-axis ({under_axis} px)")

        area = purpleish(line_png)
        check(area > 600, f"{theme}: ut area fill too small ({area} px)")

        spend_png = os.path.join(tmp, f"spend-{theme}.png")
        spend = render(
            csv_path,
            spend_png,
            ["--sources", "ut", "--kind", "spend", "--theme", theme, "--max-days", "5"],
        )
        check(spend["drawn"] == ["ut"], "spend chart should draw ut")
        check(spend["utTotal"] > 0, "spend chart should total the token spend")
        spend_colors = pixel_colors(spend_png, [purple])
        # 半透明紫柱：同样没有纯色柱面，但覆盖面要够大。
        check(spend_colors[purple] < 1500, f"{theme}: ut bar should be translucent (legend swatch only), got {spend_colors[purple]} px")
        bar_area = purpleish(spend_png)
        check(bar_area > 800, f"{theme}: ut bar area too small ({bar_area} px)")
        # ut 柱是「整日宽 + 半透明 + 垫在后面」的底色（v1.20.3）。
        for bar in spend["utBars"]:
            if bar.get("height"):
                check(float(bar.get("alpha") or 0) < 0.5, f"{theme}: ut bar should be translucent, got {bar.get('alpha')}")
                check(float(bar.get("width") or 0) > 0.7, f"{theme}: ut bar should span the whole day, got {bar.get('width')}")
                check(float(bar.get("zorder") or 0) < 3, f"{theme}: ut bar should sit behind the others, got {bar.get('zorder')}")
        bar_labels = [bar["text"] for bar in spend["utBars"]]
        # 没有 ut 数据的那天是一根 0 高柱子，柱顶写 "0"（用户 m12026）。
        check(
            all(label == "0" or "万" in label or "亿" in label for label in bar_labels),
            f"bar labels: {bar_labels}",
        )
        check("0" in bar_labels, f"a ut-less day should show a 0 bar label: {bar_labels}")

    # change 模式下 ut 也不能跟着涨跌变色
    meta = render(
        csv_path,
        os.path.join(tmp, "line-change.png"),
        ["--sources", "ds,ut", "--theme", "light", "--color-mode", "change", "--max-days", "5"],
    )
    ut_line = [line for line in meta["seriesLines"] if line["name"] == "ut"][0]
    check(ut_line["legend"] == "Tokens 消耗", f"legend should not spell out the divisor, got {ut_line['legend']}")
    check(len(meta["utDailyLast"]) >= 2, "ut labels missing in change mode")

    # 中文单位：1 亿 2 千万 这种两段写法
    sys.path.insert(0, os.path.join(PLUGIN, "scripts"))
    import gugu_chart  # noqa: E402

    cases = {
        0: "0",
        67: "67",
        167: "1百",
        1376: "1千",
        12345: "1万",
        570000: "57万",
        5540000: "5百万",
        7320000: "7百万",
        15101849: "1千万",
        48760000: "4千万",
        62000000: "6千万",
        120000000: "1亿2千万",
        100000000: "1亿",
        115780000: "1亿1千万",
    }
    for value, expected in cases.items():
        got = gugu_chart.token_label(value)
        check(got == expected, f"token_label({value}) = {got}, want {expected}")

    print(f"UT_OK {checks} assertions")


if __name__ == "__main__":
    main()
