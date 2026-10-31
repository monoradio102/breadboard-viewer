# Breadboard Viewer

ブレッドボード上の配線をJSONで書いて、絵として共有するための静的Webアプリです。
Claude Code や Codex などのAIエージェントが、読み書きしやすい形式を目指しています。

**エディタ: https://monoradio102.github.io/breadboard-viewer/**

| | |
|---|---|
| ![トランジスタでモーター駆動 + サーボ](docs/images/motor-servo.svg) | ![HC-SR04 で距離アラーム](docs/images/distance-alarm.svg) |
| [モーター + サーボ](examples/motor-servo.json) ([エディタで開く](https://monoradio102.github.io/breadboard-viewer/?example=motor-servo)) | [HC-SR04 で距離アラーム](examples/distance-alarm.json) ([エディタで開く](https://monoradio102.github.io/breadboard-viewer/?example=distance-alarm)) |
| ![Pico でボタン入力とLED](docs/images/pico-button.svg) | ![カスタム部品の例: I2C OLED](docs/images/oled-custom-part.svg) |
| [Pico でボタン入力とLED](examples/pico-button.json) ([エディタで開く](https://monoradio102.github.io/breadboard-viewer/?example=pico-button)) | [独自部品 (OLED) の定義例](examples/oled-custom-part.json) ([エディタで開く](https://monoradio102.github.io/breadboard-viewer/?example=oled-custom-part)) |

上の画像は、それぞれ1つのSVGファイルです。アニメーションはSVGの中のCSSで動いていて、回路データも埋め込まれています。
SVGを保存してエディタにドロップすると、そのまま回路を編集できます。
画像は `npm run images` で `examples/` から作り直せます。

- 静的ページのみで動きます (GitHub Pagesにそのまま置けます)
- 秋月電子などで手に入る、定番部品を28種類内蔵しています (抵抗、LED、フルカラーLED、DIP IC、7セグ、LCD1602、DHT11、HC-SR04、リレー、モーター、サーボ、Arduino Nano、Raspberry Pi Pico、ESP32 など)
- 内蔵されていない部品は、回路ファイルの中にJSONで定義できます ([形式](docs/FORMAT.md))
- 回路ファイル1つ (JSON) で、独自部品も含めて共有できます。書き出したSVGにも回路データが入っているので、SVGをドロップすれば元の回路に戻せます
- 回路の検証と、ネットリスト (どのピン同士がつながっているか) の表示ができます
- 動作のアニメーション (LEDの点滅、モーターの回転、サーボ、ボタン操作、信号の流れ、キャプション) を台本として書けます。書き出したSVGは、ファイル単体でもアニメーションします

## 使い方

```bash
npm run serve   # http://localhost:8000 で開く
```

- 左: 部品一覧。ボードにドラッグして置くか、部品をクリックして「回路に追加」を押します
- 中央: ブレッドボード
  - 部品をクリックで選択、ドラッグで移動します。LEDや抵抗などは、選択すると出る丸いハンドルで、足を1本ずつ動かせます
  - 空いている穴からドラッグすると、ジャンパ線を引けます (色はツールバーで選びます)
  - 線を選ぶと出る「＋」をドラッグすると、経由点が増えて線がなめらかに曲がります。経由点はドラッグで移動、ダブルクリックで削除できます
  - `R` で回転 (`Shift+R` で逆回転)、`Delete` で削除、矢印キーで1マス移動、`Ctrl+Z` / `Ctrl+Shift+Z` で元に戻す / やり直し
  - 穴にカーソルを合わせると、その穴と導通している穴が光り、穴の名前とネットが表示されます
- ツールバー: 元に戻す / やり直し、ボードの種類、配線の色、アニメーションの再生・一時停止・シーク (`Space` でも再生 / 一時停止)、拡大・縮小
- 右: 選択中の部品のプロパティと、回路のJSON。JSONを編集すると、すぐに図に反映されます
- JSON / SVG ファイルは、ページにドロップしても読み込めます
- 「共有URL」ボタンで、回路を埋め込んだURLをコピーできます。回路データはURLの `#` 以降に圧縮して入るので、サーバーには送られません (サンプル回路で500〜1400文字程度)

## コマンドライン (AIエージェント向け)

編集操作 (ops) の詳細は [docs/OPS.md](docs/OPS.md) を参照してください。

```bash
node tools/bb.mjs parts                                      # 使える部品とピン名の一覧
node tools/bb.mjs new my.json half                           # 空の回路を作る
node tools/bb.mjs apply my.json '[{"op":"addPart","type":"led","at":"a10"}]'  # 編集操作を適用する
node tools/bb.mjs check examples/blink-nano.json             # 検証とネットリストの表示
node tools/bb.mjs url examples/blink-nano.json               # 共有URLを作る (--base で公開先を変更)
node tools/bb.mjs render examples/blink-nano.json -o out.svg # SVGに描画
node tools/bb.mjs render examples/blink-nano.json -o out.png # PNGに描画 (Playwrightが必要)
npm test
```

ブラウザでは、`window.bb` から回路を操作できます。

```js
bb.get()        // 現在の回路 (JSON)
bb.load(json)   // 回路を読み込む
bb.apply(ops)   // 編集操作を適用する (docs/OPS.md)
bb.check()      // 検証結果とネットリスト (テキスト)
bb.inspect(hole)// 穴にあるものとネット
bb.svg()        // 回路データ入りのSVG
bb.shareUrl()   // 共有URL (Promise)
bb.help()
```

## 構成

| パス | 内容 |
|---|---|
| `src/board.js` | ブレッドボードの形と、穴の名前 |
| `src/parts/builtin.js` | 組み込み部品 |
| `src/parts/registry.js` | JSONで定義した部品の読み込み |
| `src/circuit.js` | 回路の解決、検証、ネットリスト |
| `src/ops.js` | 編集操作 (UI・API・CLIで共通) |
| `src/render.js` | SVG描画 (ブラウザとNodeの両方で動きます) |
| `src/animation.js` | アニメーションの台本をCSSキーフレームに変換 |
| `src/app.js` | ブラウザのUI |
| `docs/FORMAT.md` | 回路ファイルの形式 |
| `docs/OPS.md` | 編集操作 |
| `examples/` | サンプル回路 |
| `docs/images/` | README用の画像 (`npm run images` で生成) |
| `tools/bb.mjs` | コマンドライン |
