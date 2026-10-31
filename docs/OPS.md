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
bb.load(json)       // → { ok, errors, warnings, parts, wires }
bb.check()          // 検証結果とネットリスト ({ json: true } でオブジェクト、{ layout: true } で見た目の問題も)
bb.layout()         // 見た目の問題 (本体の重なり、隠れた配線の端など)
bb.place("xiao", { at: "h3", rot: 180 })   // 置いたときのピンの穴・覆う範囲・ぶつかり (回路は変えない)
bb.coords("h3", "U1.D3")                   // 穴やピンの座標
bb.inspect("a10")   // { hole, occupant, net }
bb.parts()          // 使える部品
bb.undo(); bb.redo()
bb.play(); bb.pause(); bb.seek(1500)   // アニメーションの再生 / 一時停止 / 時刻指定
bb.svg({ time: 1500 })                 // その瞬間の静止画SVG
bb.link()                              // この回路を開くリンク (https://…/#data=…)
await bb.png({ background: null })     // その瞬間の透過PNG (Blob)
```

## op の一覧

| op | 引数 | 内容 |
|---|---|---|
| `addPart` | `type`, (`id`), (`at`, `rot` / `pins` / `pos`), パラメータ | 部品を追加します。`id` を省略すると `R1`, `U2` のように自動で付けます。位置を省略すると、空いている場所を探して置きます。足を曲げられる部品を `at` で置いた場合は、`pins` (ピンごとの穴の指定) に変換されます |
| `move` | `id`, `to` または `pos` | `to` (穴): 1番ピンがその穴に来るように平行移動します。足を曲げられる部品は、すべてのピンを同じだけずらします。`pos` (`[x, y]`): ボードの外に置きます |
| `rotate` | `id`, (`by` = 90) | 時計回りに回転します (`by`: 90 / 180 / 270)。1番ピンが回転の中心です |
| `setPin` | `id`, `pin`, `to` | 足を曲げられる部品の、1本のピンだけを別の穴へ移します |
| `update` | `id`, `set` | 部品または配線のキーを変更します。`set` の値に `null` を指定すると、そのキーを削除します。`id` も変更できますが、`type` は変更できません |
| `remove` | `id` | 部品または配線を削除します。部品を削除すると、そのピン (`"R1.2"` など) につながった配線も削除します |
| `addWire` | `from`, `to`, (`color`, `id`, `via`, `shape`, `bend`, `note`) | ジャンパ線を追加します。`id` を省略すると `W1`, `W2`… を自動で付けます |
| `addOverlay` | `svg`, `x`, `y`, `w`, `h`, (`id`, `fit`) | 任意のSVGを演出レイヤーとして追加します (`docs/FORMAT.md` 参照)。`move` の `pos` で位置を、`update` で大きさなどを変えられます |
| `setSteps` | `steps` | 組み立て手順を設定します (`docs/FORMAT.md` の「組み立て手順」)。`null` で削除 |
| `autoSteps` | なし | 組み立て手順を自動で作って設定します (モジュール・IC → ほかの部品 → 配線) |
| `setAssembly` | `tray`, `trayOrigin`, `trayWidth`, `timing`, `introText`, `outroText`, `numbering` のうち必要なもの / `clear: true` | 組み立ての設定をマージします。`tray` と `timing` はキーごとにマージされ、値に `null` を書くとそのキーを消します |
| `definePart` | `def` | 独自部品の定義 (`partDefs` の1件) を追加します。同じ `type` があれば差し替えます |
| `animate` | `target`, `keys`, (`replace` = true) | 部品・配線・演出のアニメーションのキーを設定します。`target` はID、IDの配列、または `animation.groups` の名前 (複数のときは、状態を持つものだけに振り分けます)。`replace: false` にすると、既存のキーに追加します |
| `setAnimation` | `duration`, `loop`, `captions`, `tracks`, `groups` のうち必要なもの / `clear: true` | アニメーションの設定を上書きでマージします。`clear: true` でアニメーションを削除します |
| `setBoard` | `board` | ボードの種類を変更します (`full` / `half` / `mini`) |
| `setWireStyle` | `style` | 配線の描き方を変更します (`flex`: 曲がるジャンパ線 / `kit`: ジャンパ線キット。`docs/FORMAT.md` の「配線の描き方」)。1本だけ変えるときは `update` で `style` を設定します |
| `setTitle` | `title` | タイトルを変更します |

配線のIDは、読み込んだ時点で自動的に付けられます (`W1`, `W2`, …)。
部品や配線を削除したりIDを変えたりすると、アニメーションの `target` も自動で追従します。
部品のIDを変えると、`"R1.2"` のようにそのピンを指している配線の端も書き換わります。

## おすすめの進め方 (AI向け)

1. `node tools/bb.mjs parts` で、部品の `type` とピン名を確認します。
2. `addPart` で部品を置きます。ICやモジュールは `at` で溝をまたぐように置き、抵抗やLEDは `pins` で穴を指定します。
3. `addWire` で配線します。
4. `node tools/bb.mjs check` で、ネットリストが意図どおりか確認します。
5. 動作を見せたい場合は、`animate` でキーを、`setAnimation` で長さやキャプションを設定します。
6. 必要に応じて `render -o out.png` で見た目を確認します (PNGは時刻0の状態です)。
