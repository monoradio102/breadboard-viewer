## 注意 (免責事項)

内蔵の部品データ (ピン配置、寸法など) やサンプルは参考情報で、誤りを含む可能性があります。`check` が確認するのは配線の構造だけで、電気的な正しさは保証しません。
**ユーザーに回路を渡すときは、実際に配線する前にデータシートで確認するよう一言添えてください。** 詳細: {{BASE}}DISCLAIMER.md

## できること

- 回路 (ブレッドボード、部品、ジャンパ線) を JSON で書き、検証してネットリストを得る
- SVG (アニメーション付き)、PNG (透過可・時刻指定)、連番 PNG (→ ffmpeg で GIF / MP4) に描画する
- 動作の台本 (LED 点灯、モーター回転、サーボ角度、信号の流れ、キャプション) を付ける
- 組み込みにない部品を JSON で定義する。煙・矢印などの演出は任意の SVG アニメーションとして流し込む

## 進め方

```bash
{{CLI}} parts                      # 使える部品の type とピン名
{{CLI}} new circuit.json half      # 空の回路 (full / half / mini)
{{CLI}} apply circuit.json '[{"op":"addPart","type":"nano","at":"h3"},{"op":"addPart","type":"led","pins":{"A":"b21","K":"b22"}}]'
{{CLI}} check circuit.json         # エラー / 警告 / ネットリスト。エラーがあると終了コード 1
{{CLI}} render circuit.json -o circuit.svg                          # アニメーション付き SVG (回路データ入り)
{{CLI}} render circuit.json -o f.png --time 1500 --transparent      # 1.5 秒時点の透過 PNG
{{CLI}} frames circuit.json -o frames --fps 30 --transparent        # 1 周分の連番 PNG と ffmpeg のコマンド
{{CLI}} render circuit.json -o step3.png --step 3                   # 組み立て手順 3 の状態 (0 = 部品を並べたところ)
{{CLI}} frames circuit.json -o asm --assembly --fps 30              # 組み立て手順のアニメーションを連番 PNG に
```

1. `parts` で部品の `type` とピン名を確かめる。`{{CLI}} parts --json --type xiao` でピンの相対位置と本体の範囲もわかる
   置く前に `{{CLI}} place xiao --at h3 --rot 180 --in circuit.json` で、各ピンの穴・本体が覆う範囲・ぶつかりを確かめる
2. `apply` で部品を置き、配線する (操作の一覧は {{OPS}})。JSON を直接書いてもよい
3. 必ず `check` を実行し、エラーがなく、ネットリストが意図どおりか確かめる。`NOTE` (参考) は電気的なよくあるミス (電源どうしのショート、抵抗なしの LED、GND 未接続、電圧の過不足など) なので、意図したものでなければ直す
4. `{{CLI}} check circuit.json --layout` で見た目の問題 (本体の重なり、本体の下に隠れた配線の端、ほかの穴の真上を通る配線、ラベルの重なり、大きすぎる bend、ボードの外にはみ出す配線) を文字で確かめ、最後に `render` で画像にして確かめる。
   結果を機械的に読むときは `check --json`。静止画を確かめるだけなら、SVG を `rsvg-convert -o out.png circuit.svg` で PNG にしてもよい (アニメーションは止まった状態)
5. 動作を説明するときは `animate` / `setAnimation` でアニメーションを付ける。複数の部品・配線をまとめて動かすときは `target` に配列か、`animation.groups` の名前を使う (`target: ["D3", "WL"]` に `{"on": true, "flow": true}` と書くと、LED には on、配線には flow が振り分けられる)。
   部品の状態で表せない演出は SVG を書いて `addOverlay` で流し込む。1 回きりの動きは `restart: true` (表示された時刻から SVG の時計が始まる)、消し方は `fadeOut` (ミリ秒) で指定する
6. 組み方を説明するときは `setSteps` で組み立て手順を書く (`autoSteps` で自動生成もできる)。部品を並べたところから順に配置していく様子を描ける。
   トレイの位置や時間は `setAssembly` で指定し、`{{CLI}} plan circuit.json` で各手順の時刻・トレイの位置と重なりを確かめる

SVG の出力と、parts / new / apply / check は Node.js 18 以上だけで動きます。
PNG と連番 PNG には Playwright が必要です (`npm i playwright && npx playwright install chromium`)。
インストール済みの Google Chrome を使うなら `--chrome`、ほかのブラウザなら `--browser-path <実行ファイル>` (このときブラウザのダウンロードは不要で、`npm i playwright-core` だけで動きます)。
`render` / `frames` は `--viewbox "x y w h"` か `--focus U1,MIC1 [--margin 2]` で表示範囲を絞れます。`frames --jobs 4` で並列に書き出します。
知らないオプションはエラーになります。

## 回路を書くときの要点

- 穴: `a1`〜`j63` (行 a〜j × 列)。同じ列の a〜e、f〜j がそれぞれ導通。e と f の間が中央の溝
- 電源レール: `T+5`, `T-5` (上), `B+5`, `B-5` (下)。各レールは端から端まで導通。穴は列 3 から 5 個ずつ、6 列ごと (3-7, 9-13, 15-19, …)
- 部品の置き方: `at` (1 番ピンの穴) + `rot`、`pins` (抵抗や LED など足を曲げられる部品の穴を個別に)、`pos: [x, y]` (ボードの外)
- 座標: 列 n の x = n + 1。行の y は a=4 … e=8、f=11 … j=15。レールの y は T+=1, T-=2, B+=17, B-=18 (`{{CLI}} coords h3 T-5 --in circuit.json` でも確かめられる。`--in` か `--board` がないと full ボードとして計算する)
- 配線の `bend` は線の長さに対する割合 (マスの数ではない。0.1〜0.3 くらいが目安)。正の値で from → to の向きに対して右側 (画面上) に膨らむ
- 配線の描き方は回路の `"wireStyle"` で選ぶ: `"flex"` (既定値。曲がるジャンパ線) / `"kit"` (市販のジャンパ線キット。板に沿って直角に折れ、色は長さで決まる)。
  キットで描くと `check` の最後に、使う線が長さごとに出る。整理された組み方を見せたいときは、縦か横にまっすぐつなげる穴を選ぶ
- 配線の端: 穴の名前、または `"部品ID.ピン名"` (ボード外の部品のピンや、端子)
- 独自部品のピンに `"role"` (`gnd` / `supply` + `volts` / `vin` + `vmax` など) を書くと、電気的なチェックに使われる
- 独自部品のピンに `"insert": false` を付けると、ボードに挿さない端子 (端子台、パッド、リード線) になる。ボードに挿した部品のスピーカー端子などに使う
- 部品IDのラベルが重なるときは、部品に `"idLabel": {"dx": 1, "dy": -0.5}` (ずらす) か `"idLabel": false` (隠す) を付ける
- DIP の IC は 1 番ピンを f 行に置くと溝をまたぐ (例: `"at": "f10"`)
- 組み込みにない部品は、データシートを調べて `partDefs` に JSON で定義する (`units: "mm"` でデータシートの寸法をそのまま書ける)
- 定義した部品は、ライブラリにまとめて使い回せる: `{{CLI}} lib my-parts.json circuit.json` で集め、`{{CLI}} apply c.json ops.json --lib my-parts.json` で使う
- 結果を人に渡すときは、回路の JSON か、書き出した SVG (回路データ入り) を渡す。エディタ ({{EDITOR}}) にドロップすると編集できる

## ドキュメント

- 回路ファイルの形式: {{FORMAT}} (穴、部品、配線、独自部品、アニメーション、演出 SVG)
- 編集操作 (ops): {{OPS}} (addPart, move, rotate, setPin, update, remove, addWire, addOverlay, animate, setAnimation)

## サンプル回路 (JSON)

- [Arduino Nano で Lチカ]({{BASE}}examples/blink-nano.json)
- [Pico でボタン入力と LED (ジャンパ線キットの描き方)]({{BASE}}examples/pico-button.json)
- [トランジスタでモーター駆動 + サーボ (ボード外配置)]({{BASE}}examples/motor-servo.json)
- [HC-SR04 で距離アラーム]({{BASE}}examples/distance-alarm.json)
- [スピーカーで音を鳴らす (ボード外配置)]({{BASE}}examples/tone-speaker.json)
- [独自部品の定義例 (I2C OLED)]({{BASE}}examples/oled-custom-part.json)
- [演出 SVG の例 (抵抗なしで LED をつなぐと…)]({{BASE}}examples/led-burnout.json)
- [XIAO ESP32S3 で音声入出力 (I2S マイク + アンプ + WS2812B + OLED)]({{BASE}}examples/xiao-voice.json)
- [トランジスタ2個で LED を交互に点滅 (ジャンパ線キットの描き方、組み立て手順つき)]({{BASE}}examples/flasher-kit.json)

エディタで開くには `{{BASE}}?example=<名前>` (例: `?example=motor-servo`)。
