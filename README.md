# Breadboard Viewer

ブレッドボード上の配線をJSONで書いて、絵として共有するための静的Webアプリです。
Claude Code や Codex などのAIエージェントが、読み書きしやすい形式を目指しています。

- 静的ページのみで動きます (GitHub Pagesにそのまま置けます)
- 秋月電子などで手に入る、定番部品を内蔵しています (抵抗、LED、DIP IC、Arduino Nano、Raspberry Pi Pico など)
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
  - `R` で回転 (`Shift+R` で逆回転)、`Delete` で削除、矢印キーで1マス移動、`Ctrl+Z` / `Ctrl+Shift+Z` で元に戻す / やり直し
  - 穴にカーソルを合わせると、その穴と導通している穴が光り、穴の名前とネットが表示されます
- ツールバー: 元に戻す / やり直し、ボードの種類、配線の色、アニメーションの再生・一時停止・シーク (`Space` でも再生 / 一時停止)、拡大・縮小
- 右: 選択中の部品のプロパティと、回路のJSON。JSONを編集すると、すぐに図に反映されます
- JSON / SVG ファイルは、ページにドロップしても読み込めます

## コマンドライン (AIエージェント向け)

編集操作 (ops) の詳細は [docs/OPS.md](docs/OPS.md) を参照してください。

```bash
node tools/bb.mjs parts                                      # 使える部品とピン名の一覧
node tools/bb.mjs new my.json half                           # 空の回路を作る
node tools/bb.mjs apply my.json '[{"op":"addPart","type":"led","at":"a10"}]'  # 編集操作を適用する
node tools/bb.mjs check examples/blink-nano.json             # 検証とネットリストの表示
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
