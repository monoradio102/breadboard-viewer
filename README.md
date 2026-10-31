# Breadboard Viewer

ブレッドボード上の配線をJSONで書いて、絵として共有するための静的Webアプリです。
Claude Code や Codex などのAIエージェントが、読み書きしやすい形式を目指しています。

- 静的ページのみで動きます (GitHub Pagesにそのまま置けます)
- 秋月電子などで手に入る、定番部品を内蔵しています (抵抗、LED、DIP IC、Arduino Nano、Raspberry Pi Pico など)
- 内蔵されていない部品は、回路ファイルの中にJSONで定義できます ([形式](docs/FORMAT.md))
- 回路ファイル1つ (JSON) で、独自部品も含めて共有できます。書き出したSVGにも回路データが入っているので、SVGをドロップすれば元の回路に戻せます
- 回路の検証と、ネットリスト (どのピン同士がつながっているか) の表示ができます

## 使い方

```bash
npm run serve   # http://localhost:8000 で開く
```

- 左: 部品一覧。部品をクリックして「回路に追加」を押すと、空いている場所に置かれます
- 中央: ブレッドボード。穴にカーソルを合わせると、穴の名前とネットが表示されます
- 右: 回路のJSON。編集すると、すぐに図に反映されます
- JSON / SVG ファイルは、ページにドロップしても読み込めます

## コマンドライン (AIエージェント向け)

```bash
node tools/bb.mjs check examples/blink-nano.json             # 検証とネットリストの表示
node tools/bb.mjs render examples/blink-nano.json -o out.svg # SVGに描画
node tools/bb.mjs render examples/blink-nano.json -o out.png # PNGに描画 (Playwrightが必要)
npm test
```

ブラウザでは、`window.bb` から回路を操作できます。

```js
bb.get()        // 現在の回路 (JSON)
bb.load(json)   // 回路を読み込む
bb.check()      // 検証結果とネットリスト (テキスト)
bb.svg()        // 回路データ入りのSVG
```

## 構成

| パス | 内容 |
|---|---|
| `src/board.js` | ブレッドボードの形と、穴の名前 |
| `src/parts/builtin.js` | 組み込み部品 |
| `src/parts/registry.js` | JSONで定義した部品の読み込み |
| `src/circuit.js` | 回路の解決、検証、ネットリスト |
| `src/render.js` | SVG描画 (ブラウザとNodeの両方で動きます) |
| `src/app.js` | ブラウザのUI |
| `docs/FORMAT.md` | 回路ファイルの形式 |
| `examples/` | サンプル回路 |
