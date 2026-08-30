# 03. WebMCPツールのカート書き込みとテーマUI同期(Horizon)

- 検証日: 2026-08-29
- 症状: ツールがカートに書き込んでも、テーマのバッジ/ドロワーが手動リロードまで更新されない
- 結論: **書き込みはActions API、UI同期は「標準イベント+空→初回のみ自動リロード」の組み合わせで解決**

## 学び

1. **`Shopify.actions` は遅延ロード** — ページ初期化時は `undefined`、load後に `function` になる。
   機能検出はツール実行時(呼ばれる頃には存在する)に行い、初期化時の判定で諦めない
2. **Horizonのカート同期の実体は `@shopify/events` の標準イベント** —
   cart-icon.js / component-cart-items.js は `StandardEvents.cartLinesUpdate`
   (`shopify:cart:lines-update`)を購読し、`event.promise` → `cart.totalQuantity` を読む。
   Ajax Cart APIで直接書いた場合も、`import("@shopify/events")`(ページのimportmap経由)で
   `CartLinesUpdateEvent` を合成発火すればバッジは同期できる
3. **「空カート→1件目」だけはイベントでは直せない** — Horizonの空ドロワーは
   「Your cart is empty」の静的表示で、カート行コンポーネント(イベント購読者)が
   DOMに存在しない。**唯一の確実な解はページ再描画**。composerはcommit前に `/cart.js` で
   空かどうか判定し、空→初回のときだけ結果返却後に `location.reload()` する
4. **他テーマの慣習は通用しない** — `cart:refresh` イベント(Maestrooo系)や
   `@theme/events` の CartUpdateEvent は Horizon には存在しない(実テーマJSをCDNから
   取得して確認)。テーマ同期の実装は必ず実物のテーマコードを読むこと
5. **経路ログを最初から仕込む** — `commit path: Shopify.actions.updateCart / ajax fallback` の
   1行があるだけで、再現しない不具合の切り分けが一瞬になる

## 実機で確認したログ(期待形)

```
[bouquet-composer] commit path: Shopify.actions.updateCart
[bouquet-composer] shopify:cart:lines-update add
[bouquet-composer] commit ok via Shopify.actions 1
[bouquet-composer] first cart item — reloading to render the drawer
```

## 最終形(2026-08-29 更新)

紆余曲折の末、**commit成功後は常に `/cart` へ遷移する**方式に一本化した。

- サーバー描画のカートページは、テーマのドロワー/バッジ実装に一切依存せず常に正しい
- 「カゴに入れた→カゴを見る」は買い物として自然で、ドロワーが閉じていて
  変化が分からない問題も同時に解消
- 空ドロワー問題・イベント合成・リロード判定のコードはすべて不要になり削除
  (上記の学び自体は他テーマ対応などで再利用価値があるため記録として残す)
- ツールはページ遷移後も再登録され、draftはlocalStorageで生存する

## 実装

- `extensions/composer-embed/assets/composer.js` — `commitDraft`(経路選択+例外フォールバック)、
  `notifyThemeCartUpdate`(合成イベント)、`reloadIfFirstItem`(空→初回リロード)
- リロードしてもWebMCPツールは再登録され、draftはlocalStorageで生存するため
  エージェントのセッションは途切れない
