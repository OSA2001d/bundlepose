# 02. Cart Transform (Rust) で「存在しない商品」を1行の注文にする

- 検証日: 2026-08-29
- 対象: `_bundle_id` 行プロパティによる linesMerge。実装は
  `apps/private/bouquet-app/extensions/bouquet-cart-transform/`(Rust, `cart.transform.run`)
- 結論: **カートに投入した任意の実在variantの組み合わせを、Cart Transform Functionで
  「1ブーケ=1行(価格=構成品合計、任意のタイトル)」に畳めることをE2Eで実証。**

## 学び(要点)

1. **merge の設計はシンプルで良い**
   - クライアントは `/cart/add.js` の各行に `properties: { _bundle_id, _bundle_name }` を付けるだけ
     (`_`接頭辞はテーマ表示から隠れる)
   - Function側は `attribute(key: "_bundle_id")` でグルーピングし `LinesMergeOperation` を返す
   - 価格は構成品合計が自動で親行に付く(調整不要)。タイトルは `_bundle_name` で上書き
   - 親variantは `requiresComponents: true` にして単体購入を防ぐ
2. **Function設定は CartTransform オブジェクトの metafield に置く**(`$app:bouquet/config`)。
   設定が無い/壊れている場合は no-op を返してチェックアウトを壊さない
3. **有効化は deploy + `cartTransformCreate` が必要**。`shopify app dev` のdevセッションだけでは
   Cart Transformは動かない。有効化はFunction所有アプリのトークンが必須なので、
   アプリ内の管理ページ(authenticate.admin)から実行する形にした(/app/setup)
4. **テストはフィクスチャ駆動が楽**: `@shopify/shopify-function-test-helpers` + vitest で
   入力JSON→期待出力JSONを照合(4ケース)。Rustの出力で `None` のフィールドはJSONから省略される

## ハマりどころ3連発(全部再現性のある罠)

### (1) 管理画面の action が全部 400 Bad Request

- **React Router 7.13+ が action への外部オリジンPOSTを拒否するCSRF保護を追加**
  (remix-run/react-router#14708)。Shopifyのdev構成ではブラウザのOriginはトンネル
  (`*.trycloudflare.com`)、devサーバーは `localhost` なので全action が不一致で400
- loader(GET)は検査対象外 → ページは表示されるのにボタンだけ死ぬ。Shopify認証の
  問題に見えるが無関係(`shop: null` ログは赤ニシン)
- 解決: `react-router.config.ts` で `allowedActionOrigins` に `SHOPIFY_APP_URL` のホストと
  `**.trycloudflare.com` を許可。テンプレートにはこのファイル自体が無い(2026-08時点)

### (2) `inventorySetQuantities` → "not stocked at the location"

- 新規在庫アイテムは先に `inventoryActivate(inventoryItemId, locationId)` で
  ロケーションに紐付けてから数量設定する

### (3) 在庫を入れたのに `available: False`(カート追加不可)

- `locations(first: 1)` が拾ったカスタムロケーションは**オンライン注文を処理しない**
  ロケーションだった。Online Storeの在庫判定は `fulfillsOnlineOrders: true` の
  ロケーションの在庫で決まる
- 解決: シードは `locations` から `fulfillsOnlineOrders` でフィルタした全ロケーションに在庫を置く

## E2E検証結果(curl / Storefront Ajax Cart API)

```
POST /cart/add.js  (5行: Red Rose×3, Pink Tulip×4, Eucalyptus×2, Kraft Wrap, Fee
                    各行 properties: {_bundle_id:"b1", _bundle_name:"Warm Birthday Bouquet"})
GET  /cart.js →
  1x Warm Birthday Bouquet | $39.50 | handle=custom-bouquet   ← 5行が1行に

さらに _bundle_id:"b2" で2行追加 →
  1x Bouquet for a Friend   | $11.00   ← 別の親行に分離
  1x Warm Birthday Bouquet  | $39.50
  total $50.50
```

価格検算: 3×4.50 + 4×3.00 + 2×2.00 + 2.00 + 8.00 = **$39.50** ✓ / 2×4.50 + 2.00 = **$11.00** ✓

## カートUI同期問題と Storefront Events & Actions API

### 症状

WebMCPツールが素の Ajax Cart API(`/cart/add.js`)でカートを書くと、**API上は成功するのに
テーマ(Horizon)のカートUI(バッジ・ドロワー・カートページ)が手動リロードまで更新されない**。
ChatGPT検証時にツール成功→手動でカートを見ると空、リロードで反映、という紛らわしい挙動になった。

### 原因と解決

テーマのカート状態はテーマ自身が管理しており、外部のfetchを知る術がない。
Shopify標準の `update_cart` ツールがドロワーを即時更新できるのは
**Storefront Events & Actions API** を使っているため。同じ経路に乗り換えた。

```js
// 書き込み: テーマが認識していればUI即時更新、非対応テーマは自動でページリロード
// 行attributes対応なので _bundle_id もそのまま渡せる。全Liquidストアフロントで利用可
const { cart, userErrors } = await Shopify.actions.updateCart({
  lines: [{
    merchandiseId: "gid://shopify/ProductVariant/43229327556702",
    quantity: 3,
    attributes: [
      { key: "_bundle_id", value: "b1" },
      { key: "_bundle_name", value: "Warm Birthday Bouquet" },
    ],
  }],
});

// 購読: エージェント・テーマ・他アプリ、どこ発でもカート変更を拾える(標準DOMイベント)
document.addEventListener("shopify:cart:lines-update", (event) => {
  console.log(event.action, event.lines); // event.promise で結果待ちも可
});
```

### タイトル表示のトレードオフ(2026-08-29 実機確認)

- mergeの `title` 上書きは**チェックアウトでは効く**が、テーマのカートドロワーは
  親商品名(Custom Bouquet)を表示する(テーマ側は `line_item.title` を使うよう
  修正しないと反映されない、とドキュメントにも明記)
- 対応: mergeオペレーションの `attributes` に表示用プロパティ `Bouquet: <名前>` を追加
  → ドロワーでもブーケ名が見え、複数ブーケを識別できる
- 副作用: チェックアウトでは title とプロパティで**名前が二重表示**になる。
  許容範囲と判断(完全に消すならテーマ修正で `_`付きに戻す選択肢もある)

### 設計指針

- **カート書き込みは常に `Shopify.actions.updateCart` を第一経路にする**
  (本番の `bouquet_commit` も同様)。`window.Shopify?.actions?.updateCart` の
  機能検出で分岐し、無い環境のみ `/cart/add.js` フォールバック
- フォールバック時は**ツールの戻り値に `uiNote`(「画面のカート表示が古い可能性。
  リロードを案内して」)を含め、エージェント側の応対でカバー**する
- `shopify:cart:lines-update` の購読は、人間がテーマUIで行った手編集を
  エージェント側(`bouquet_get_state`)へ反映するための土台になる

参考: https://shopify.dev/docs/api/storefront-events-and-actions
(changelog: https://shopify.dev/changelog/events-and-actions-cart-attributes-support)

## チェックアウトでの入れ子表示(実機確認)

ChatGPTのWorkモードからチェックアウトまで進めた実機確認で、
親行「Bouquet for Mom $39.50」の下に構成品(1× Arrangement Fee / 1× Kraft Paper Wrap /
2× Eucalyptus / 4× Pink Tulip / 3× Red Rose)が展開表示されることを確認。
複数ブーケも別の親行として並ぶ(Subtotal: 2 items)。

![チェックアウトの入れ子表示](images/02_checkout-nested.png)

## 主要ファイル

- Function: `extensions/bouquet-cart-transform/src/cart_transform_run.rs` / `.graphql`
- テスト: `extensions/bouquet-cart-transform/tests/fixtures/*.json`
- シード+有効化: `app/routes/app.setup.tsx` + `app/lib/bouquet-catalog.server.ts`
- CSRF設定: `react-router.config.ts`
