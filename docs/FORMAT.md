# 回路ファイル形式 (v1)

ブレッドボード上の配線を表すJSONです。人もAIも手で書けることを優先しています。
1つのファイルに、独自部品の定義 (`partDefs`) も含められます。そのため、ファイル1つを渡すだけで同じ回路を再現できます。

```json
{
  "version": 1,
  "title": "Arduino Nano で Lチカ",
  "board": "half",
  "partDefs": [],
  "parts": [
    { "id": "U1", "type": "nano", "at": "h3" },
    { "id": "R1", "type": "resistor", "value": "220", "pins": ["a17", "a21"] },
    { "id": "D1", "type": "led", "color": "red", "pins": { "A": "b21", "K": "b22" } }
  ],
  "wires": [
    { "from": "c22", "to": "T-22", "color": "black" }
  ]
}
```

## ボード (`board`)

| 値 | 内容 |
|---|---|
| `full` | 63列 + 電源レール4本 (830穴) |
| `half` | 30列 + 電源レール4本 (省略時の既定値) |
| `mini` | 17列, 電源レールなし (170穴) |

## 穴の名前

- **メインの穴**: `<行><列>`。行は `a`〜`j`、列は `1`〜。例: `a1`, `j30`
  - 同じ列の `a`〜`e` は互いにつながっています。`f`〜`j` も同様です。
  - `e` と `f` の間には中央の溝があります (0.3インチ幅なので、DIP ICがまたげます)。
- **電源レール**: `T+`, `T-` (上側), `B+`, `B-` (下側) の後ろに列番号を付けます。例: `T-22`
  - 各レールは端から端まで1本でつながっています。
  - レールの穴は5個ずつのグループになっていて、列3から始まり、6列ごとに次のグループが始まります (`3-7, 9-13, 15-19, ...`)。それ以外の列番号は存在しません。

座標の単位は **1ピッチ = 2.54mm**、yは下向きが正です。画面上では `a` が上、`j` が下になります。

## 部品 (`parts`)

| キー | 必須 | 内容 |
|---|---|---|
| `id` | ○ | 回路内で一意な名前 (`R1`, `U1` など) |
| `type` | ○ | 部品の種類。組み込み部品、または `partDefs` で定義した `type` |
| `at` | △ | 1番ピンを挿す穴。`rot` と組み合わせて使います |
| `rot` | | `0` / `90` / `180` / `270`。画面上で時計回りに、1番ピンを中心に回転します |
| `pins` | △ | 足を曲げられる部品 (`mount: "leads"`) のみ使えます。各ピンの穴を個別に指定します。配列 (ピン順) またはオブジェクト (`{"A": "b21", "K": "b22"}`) で書きます |
| `note` | | 自由なメモ |
| その他 | | 部品のパラメータ (`value`, `color`, `label` など) |

`at` と `pins` のどちらか一方を必ず指定してください。

### 組み込み部品

| type | ピン | 配置 | 主なパラメータ |
|---|---|---|---|
| `resistor` | 1, 2 | leads | `value` ("220", "4.7k", "4k7", "1M") |
| `led` | A, K | leads | `color` (red/green/blue/yellow/orange/white) |
| `diode` | A, K | leads | `model` ("1N4148", "1N4007"...) |
| `capacitor` | 1, 2 | leads | `value` |
| `electrolytic` | +, - | leads | `value` |
| `cds` | 1, 2 | leads | |
| `transistor` | `pinout` の文字 (E, C, B) | leads | `model`, `pinout` ("ECB", "EBC") |
| `regulator` | IN, GND, OUT | rigid | `model` |
| `button` | 1, 2, 3, 4 (1-2, 3-4 は内部で導通) | rigid | |
| `trimmer` | 1, 2, 3 | rigid | `value` |
| `buzzer` | +, - | rigid | |
| `header` | 1..count | rigid | `count` |
| `dip` | 1..count | rigid | `count`, `width`, `label`, `pinNames` |
| `ne555` / `lm358` / `74hc595` | データシートのピン名 | rigid | `label` |
| `nano` | TX1, RX0, ..., D13, A0..A7, 5V, VIN | rigid | |
| `pico` | GP0.., GND.., 3V3, VSYS, VBUS | rigid | |

同じ名前のピンが複数ある場合は、`GND`, `GND2`, `GND3`… のように番号を付けて区別します。
各部品の詳しい説明は、アプリの部品一覧、または `src/parts/builtin.js` を見てください。

DIPパッケージ (`dip`, `ne555` など) は、1番ピンを `f` 行に置くと中央の溝をまたぎます。
例: `"at": "f10"` とすると、ピン1〜4が `f10`〜`f13`、ピン5〜8が `e13`〜`e10` に入ります。

## 配線 (`wires`)

| キー | 必須 | 内容 |
|---|---|---|
| `from`, `to` | ○ | 両端の穴 |
| `color` | | red, black, blue, green, yellow, orange, white, purple, gray, brown、または `#rrggbb` |
| `via` | | 描画上の折れ点となる穴の配列 (電気的な意味はありません) |
| `id`, `note` | | 任意 |

1つの穴に挿せるのは、部品の足かジャンパ線の端のどちらか1本だけです。重なっているとエラーになります。

## 独自部品の定義 (`partDefs`)

組み込み部品にない部品は、宣言的なJSONで定義できます。
データシートやJLCPCB/LCSCのカタログを読んだAIが、この形式で書くことを想定しています。

```json
{
  "type": "oled-ssd1306-i2c",
  "name": "0.96インチ OLED (I2C)",
  "category": "表示",
  "description": "SSD1306 128x64 I2Cモジュール",
  "prefix": "DISP",
  "units": "mm",
  "mount": "rigid",
  "pins": [
    { "name": "GND", "x": 0, "y": 0 },
    { "name": "VCC", "x": 2.54, "y": 0 }
  ],
  "internal": [],
  "shapes": [
    { "type": "rect", "x": -9.84, "y": -2.2, "w": 27.3, "h": 27.8, "r": 1.2, "fill": "#1b3a6b" }
  ],
  "source": { "lcsc": "C000000", "datasheet": "https://..." }
}
```

| キー | 内容 |
|---|---|
| `type` | 一意な名前。組み込み部品と同じ名前は使えません |
| `units` | `"pitch"` (既定値, 1 = 2.54mm) または `"mm"` |
| `mount` | `"rigid"` (既定値) または `"leads"` |
| `pins` | `{name, x, y}` の配列。**部品を上から見た座標** (yは下向き) で書きます。最初のピンが `at` の基準になります |
| `internal` | 部品の内部でつながっているピン名のグループ。例: `[["GND", "GND2"]]` |
| `shapes` | 見た目の図形。`pins` と同じ座標系・単位で書きます。省略すると箱で表示します |
| `prefix` | アプリで部品を追加するときに付けるIDの接頭辞 |
| `source` | 出典などのメタデータ (自由形式) |

ブレッドボードに挿すピンは、2.54mmの格子上に並んでいる必要があります。
ピンが穴の位置からずれると「ピンが穴の位置に来ません」というエラーになります。
表面実装 (SMD) の部品は、変換基板に載せた状態の、2.54mmピッチのピン配置で定義してください。

### 図形 (`shapes`)

共通のキー: `fill`, `stroke`, `strokeWidth`, `opacity`

| type | キー |
|---|---|
| `rect` | `x`, `y`, `w`, `h`, `r` (角の丸み) |
| `circle` | `cx`, `cy`, `r` |
| `line` | `x1`, `y1`, `x2`, `y2` |
| `polygon` | `points: [[x, y], ...]` |
| `path` | `d` (SVGのパス記法) |
| `text` | `x`, `y`, `text`, `size`, `anchor` (start/middle/end), `bold` |

## 検証

```bash
node tools/bb.mjs check circuit.json
```

エラーと警告を表示し、ネットリスト (どのピン同士がつながっているか) を出力します。
エラーがあると、終了コード1で終了します。
