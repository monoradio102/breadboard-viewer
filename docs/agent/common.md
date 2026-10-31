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
```

1. `parts` で部品の `type` とピン名を確かめる
2. `apply` で部品を置き、配線する (操作の一覧は {{OPS}})。JSON を直接書いてもよい
3. 必ず `check` を実行し、エラーがなく、ネットリストが意図どおりか確かめる
4. `render` で画像にして、見た目を確かめる
5. 動作を説明するときは `animate` / `setAnimation` でアニメーションを付ける。部品の状態で表せない演出は SVG を書いて `addOverlay` で流し込む

SVG の出力と、parts / new / apply / check は Node.js 18 以上だけで動きます。
PNG と連番 PNG には Playwright が必要です (`npm i playwright && npx playwright install chromium`)。

## 回路を書くときの要点

- 穴: `a1`〜`j63` (行 a〜j × 列)。同じ列の a〜e、f〜j がそれぞれ導通。e と f の間が中央の溝
- 電源レール: `T+5`, `T-5` (上), `B+5`, `B-5` (下)。各レールは端から端まで導通。穴は列 3 から 5 個ずつ、6 列ごと (3-7, 9-13, 15-19, …)
- 部品の置き方: `at` (1 番ピンの穴) + `rot`、`pins` (抵抗や LED など足を曲げられる部品の穴を個別に)、`pos: [x, y]` (ボードの外)
- 配線の端: 穴の名前、または `"部品ID.ピン名"` (ボード外の部品のピン)
- DIP の IC は 1 番ピンを f 行に置くと溝をまたぐ (例: `"at": "f10"`)
- 組み込みにない部品は、データシートを調べて `partDefs` に JSON で定義する (`units: "mm"` でデータシートの寸法をそのまま書ける)
- 結果を人に渡すときは、回路の JSON か、書き出した SVG (回路データ入り) を渡す。エディタ ({{EDITOR}}) にドロップすると編集できる

## ドキュメント

- 回路ファイルの形式: {{FORMAT}} (穴、部品、配線、独自部品、アニメーション、演出 SVG)
- 編集操作 (ops): {{OPS}} (addPart, move, rotate, setPin, update, remove, addWire, addOverlay, animate, setAnimation)

## サンプル回路 (JSON)

- [Arduino Nano で Lチカ]({{BASE}}examples/blink-nano.json)
- [Pico でボタン入力と LED]({{BASE}}examples/pico-button.json)
- [トランジスタでモーター駆動 + サーボ (ボード外配置)]({{BASE}}examples/motor-servo.json)
- [HC-SR04 で距離アラーム]({{BASE}}examples/distance-alarm.json)
- [スピーカーで音を鳴らす (ボード外配置)]({{BASE}}examples/tone-speaker.json)
- [独自部品の定義例 (I2C OLED)]({{BASE}}examples/oled-custom-part.json)
- [演出 SVG の例 (抵抗なしで LED をつなぐと…)]({{BASE}}examples/led-burnout.json)

エディタで開くには `{{BASE}}?example=<名前>` (例: `?example=motor-servo`)。
