# 編集操作 (ops)

回路の編集は、すべて「操作 (op)」というJSONオブジェクトで表します。
ブラウザでのドラッグやキー操作も、内部では同じ op を使っています。
そのため、AIエージェントも人と同じ方法で回路を編集できます。

複数の op をまとめて送ると、先頭から順に適用されます。
途中で1つでも失敗すると、**どれも適用されません** (エラーメッセージに、何番目の op が失敗したかが入ります)。
ブラウザでは、まとめて送った op が1回の「元に戻す」で取り消せます。

## 使い方

**コマンドライン**

```bash
node tools/bb.mjs new circuit.json half
node tools/bb.mjs apply circuit.json '[{"op":"addPart","type":"ne555","at":"f10"},{"op":"addWire","from":"a10","to":"T-10","color":"black"}]'
node tools/bb.mjs apply circuit.json ops.json -o out.json   # ファイルから読み込み、別ファイルに書き出す
node tools/bb.mjs parts                                       # 使える部品とピン名の一覧
```

`apply` は、`-o` を付けなければ元のファイルを上書きします。
適用後に、検証のエラーと警告も表示します。

**ブラウザ** (開発者ツールやPlaywrightから)

```js
bb.apply([{ op: "addPart", type: "led", at: "a20", color: "green" }])  // → ["D1"]
bb.addPart("resistor", { pins: ["a10", "a14"], value: "1k" })          // → "R1"
bb.move("R1", "b10")
bb.addWire("c14", "T-14", "black")
bb.check()          // 検証結果とネットリスト
bb.inspect("a10")   // { hole, occupant, net }
bb.parts()          // 使える部品
bb.undo(); bb.redo()
```

## op の一覧

| op | 引数 | 内容 |
|---|---|---|
| `addPart` | `type`, (`id`), (`at`, `rot` / `pins`), パラメータ | 部品を追加します。`id` を省略すると `R1`, `U2` のように自動で付けます。位置を省略すると、空いている場所を探して置きます。足を曲げられる部品を `at` で置いた場合は、`pins` (ピンごとの穴の指定) に変換されます |
| `move` | `id`, `to` | 1番ピンが `to` に来るように、部品を平行移動します。足を曲げられる部品は、すべてのピンを同じだけずらします |
| `rotate` | `id`, (`by` = 90) | 時計回りに回転します (`by`: 90 / 180 / 270)。1番ピンが回転の中心です |
| `setPin` | `id`, `pin`, `to` | 足を曲げられる部品の、1本のピンだけを別の穴へ移します |
| `update` | `id`, `set` | 部品または配線のキーを変更します。`set` の値に `null` を指定すると、そのキーを削除します。`id` も変更できますが、`type` は変更できません |
| `remove` | `id` | 部品または配線を削除します |
| `addWire` | `from`, `to`, (`color`, `id`, `via`, `note`) | ジャンパ線を追加します。`id` を省略すると `W1`, `W2`… を自動で付けます |
| `setBoard` | `board` | ボードの種類を変更します (`full` / `half` / `mini`) |
| `setTitle` | `title` | タイトルを変更します |

配線のIDは、読み込んだ時点で自動的に付けられます (`W1`, `W2`, …)。

## おすすめの進め方 (AI向け)

1. `node tools/bb.mjs parts` で、部品の `type` とピン名を確認します。
2. `addPart` で部品を置きます。ICやモジュールは `at` で溝をまたぐように置き、抵抗やLEDは `pins` で穴を指定します。
3. `addWire` で配線します。
4. `node tools/bb.mjs check` で、ネットリストが意図どおりか確認します。
5. 必要に応じて `render -o out.png` で見た目を確認します。
