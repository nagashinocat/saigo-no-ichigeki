# 最後の一撃

手の中で爆発する力を使って、街をまるごと吹き飛ばす3Dゲームです（ブラウザで動きます）。制限時間は60秒。街の人は避難済みで、画面には出てきません。

## 遊び方

- 最初に開くと、黒い画面に小さな「TAP」。タップすると導入のアニメーション（音あり）が始まり、「最後の一撃」と TAP START が出ます。導入はタップで飛ばせます。リトライは導入を飛ばして題字から。
- 画面を長押ししている間だけ、手の中に力が貯まります。
- 指を離すと、貯めた力で最後の一撃を放ちます。貯めるほど大きく、最大で街の端まで届きます。放った一発の破壊額が結果です（大きな一発は1回だけ）。
- 迫ってくる軍団に掴まれると、貯めた力が減ります。軍団は時間がたつほど増えます。
- 右下の「払う」ボタン（もう片方の指で押す。PC は Space キー）で、貯めた力を少し使って主人公のまわりの軍団を払えます。
- 60秒たっても放たなければ、主人公はブラックホールになってゲームオーバーです。

## 開発

```sh
npm install
npm run dev     # 開発サーバー
npm test        # テスト
npm run build   # dist/ に公開用のビルド
```

URL に `?debug` を付けると、撮影・計測用のフック（`window.__debug` など）が使えます。公開ビルドでは付けない限り出ません。
`?debug` だけのときは導入を飛ばしてすぐ遊べます（撮影用）。`?debug&intro` で導入から（`__debug.introSeek(t)` で導入の t 秒の絵）。

- 導入の撮影: `node scripts/intro-shots.mjs <url> <outDir> name=t ...`
- 宣伝用の動画: `node scripts/record-intro.mjs --url <url>`（1080×1920、30 fps、H.264 + AAC。決まった種・決まった刻みで描き、音は OfflineAudioContext で書き出す）
- 導入の書体: Zen Old Mincho Black（SIL Open Font License 1.1。`src/assets/intro-mincho-OFL.txt`）を、使う文字だけに切り詰めて埋め込む（`python3 -I scripts/build-intro-font.py <@fontsource/zen-old-mincho の files> src/assets/intro-mincho.woff2`）

## 公開

`main` ブランチへの push で、GitHub Actions（`.github/workflows/pages.yml`）がビルドして GitHub Pages に公開します。
