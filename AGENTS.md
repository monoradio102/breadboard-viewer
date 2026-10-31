# AIエージェント向けガイド

このリポジトリは、ブレッドボード配線のビューアです。回路はJSONで表します。形式は [docs/FORMAT.md](docs/FORMAT.md) を参照してください。

## 回路を書く / 直すとき

1. `docs/FORMAT.md` で、穴の名前とつながり方を確認します。`a`〜`e` と `f`〜`j` は列ごとに導通し、`T+` / `T-` / `B+` / `B-` はレール全体で導通します。
2. 編集は、JSONを直接書き換えても、編集操作 (`node tools/bb.mjs apply`, [docs/OPS.md](docs/OPS.md)) を使っても構いません。編集操作を使うと、IDの自動採番、空き場所の検索、ピンが穴から外れていないかのチェックが受けられます。部品の `type` とピン名は `node tools/bb.mjs parts` で確認できます。
3. 編集したら、必ず `node tools/bb.mjs check <file>` を実行します。エラーがなく、ネットリストが意図どおりになっていることを確認してください。
4. 見た目を確認したいときは、`node tools/bb.mjs render <file> -o out.png` で画像にします。
5. 動作を説明したいときは、アニメーション (`animation`) を付けます。書き方は `docs/FORMAT.md` の「アニメーション」、操作は `animate` / `setAnimation` です。
   部品の状態だけで表せない演出 (煙、火花、矢印、吹き出しなど) は、SVGを書いて `addOverlay` で流し込みます。SVGの中では CSS アニメーションや SMIL が使えます。
6. 動画が必要なときは、`node tools/bb.mjs frames <file> -o <dir> --fps 30 [--transparent]` で連番PNGを書き出し、表示される ffmpeg のコマンドで GIF / MP4 にします。

## 組み込みにない部品を使うとき

1. データシートやJLCPCB/LCSCのカタログで、ピン名・ピン配置・外形寸法を調べます。
2. 回路ファイルの `partDefs` に、部品定義を書きます。`units: "mm"` を使うと、データシートの寸法をそのまま書けます。
   - `pins` は部品を上から見た座標で書き、ブレッドボードに挿すピンは2.54mmの格子に乗るようにします。
   - 表面実装 (SMD) の部品は、変換基板 (DIP化モジュール) に載せた状態のピン配置にします。
   - 出典は `source` に書いておきます (例: `{"lcsc": "C2040", "datasheet": "https://..."}`)。
3. 光る・表示が変わるなどの動きがある部品は、図形に `when` を付けたり、`display` を定義したりして、アニメーションできるようにします。
4. `check` でピンが穴の位置に来ていることを確認し、`render` で見た目を確認します。

## コードを変更するとき

- 依存パッケージなし、ビルド不要の ES Modules です。`src/` はブラウザとNodeの両方で動くようにしてください (`app.js` 以外ではDOMを使わないこと)。
- 新しい組み込み部品に動きを付けるときは、`states` (状態の定義) と `animate` (状態からCSSへの変換) を書き、`render` の中で動く要素に `anim(name)` の属性を付けます (`src/parts/builtin.js` の `led` や `servo` が例です)。
- 回路を変更する処理は `src/ops.js` に op として追加し、UI (`src/app.js`)、`window.bb`、CLI (`tools/bb.mjs`) からはそれを呼ぶようにしてください。
- 部品の見た目や `examples/` を変えたら、`npm run images` で `docs/images/` を作り直してください。
- `src/` か `tools/` を変えたら、`npm install` (初回のみ) のあと `npm run build` で `dist/bb.mjs` を作り直してください。Pagesから配布している1ファイル版のCLIです。
- 使い方が変わったら `docs/agent/common.md` を更新し、`npm run build` を実行してください。そこから `llms.txt` (URLだけを渡されたAI向け) と `skill/breadboard-viewer/` (Claude のスキル) が生成されます。`llms.txt` と `skill/` は直接編集しないでください。
- `npm test` が通ることを確認してください。
