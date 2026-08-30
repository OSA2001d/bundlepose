# 01. WebMCPツールをShopifyストアに公開し、App Proxyと通信する

- 検証日: 2026-08-29
- 環境: 開発ストア(Liquidテーマ)+ Theme App Extension / Chrome 149+(flag有効)/ ChatGPTデスクトップ
- 結論: **Theme App Extensionのapp embedからWebMCPツールを公開でき、ツール内から
  App Proxyへの同一オリジンfetchが普通に通る。Web Pixelsのようなサンドボックス制限はない。**

## 学び(要点)

1. **WebMCPツールの `execute` は通常のページコンテキストで実行される**
   - トップフレームの `window` / `document` / cookie / 同一オリジンfetchがすべて使える
   - Web Pixels(専用サンドボックスでApp Proxy不可)とはまったく別物。バックエンド通信は
     App Proxyで良い — CORS設定も公開エンドポイントも不要
2. **登録はトップレベル文書で行う必要がある**(ChatGPTブラウザはiframe内のツールを検出しない)
   → Shopifyでは Theme App Extension の app embed が正解。管理画面(iframe)やCheckout UI
   Extension(サンドボックス)では不可
3. **ChatGPTでSite toolsが見えるのは Workモード + GPT-5.6 Sol/Terra のみ**
   - 通常チャットモードやLunaでは、Shopify標準ツールごと一切表示されない
   - ChatGPTブラウザに付けたDevToolsの「WebMCP」パネルはChromeフラグ系の別実装なので
     空でも故障ではない。アドレスバーの Site tools 表示で判断する
4. **Shopify標準WebMCPツールとの共存は自動**
   - 全Liquidストアに標準ツール(`get_cart`, `get_product`, `update_cart` 等)が搭載済みで、
     自前ツールは同じ一覧に並ぶ。標準機能だけでカート追加→チェックアウト到達まで動く
   - つまり作るべきは検索/カートの再実装ではなく、その上の垂直ツール
5. App Proxyのdev環境での挙動: `shopify app dev` は `[app_proxy].url` の
   **ホストだけをトンネルURLに書き換え、パスは維持する**(CLI実装で確認)

## 構成

```
ストアフロント(トップレベル文書)
  ├─ Theme App Extension app embed
  │    └─ assets/webmcp-hello.js …… document.modelContext.registerTool()
  └─ fetch("/apps/composer/ping")  …… 同一オリジン
        │ (Shopifyがサーバー側で転送 + HMAC署名付与)
        ▼
アプリ(React Router, devはトンネル経由)
  └─ /api/proxy/ping …… authenticate.public.appProxy で署名検証
```

## サンプルコード

### 1. app embed ブロック(`extensions/composer-embed/blocks/webmcp-hello.liquid`)

```liquid
<script src="{{ 'webmcp-hello.js' | asset_url }}" defer></script>

{% schema %}
{ "name": "WebMCP Hello", "target": "body", "settings": [] }
{% endschema %}
```

テーマエディタ左下の **App embeds** で有効化が必要。

### 2. ツール登録(`extensions/composer-embed/assets/webmcp-hello.js` 抜粋)

```js
if (typeof document.modelContext?.registerTool !== "function") return; // 非対応ブラウザは素通し

const controller = new AbortController();
window.addEventListener("pagehide", () => controller.abort(), { once: true });

document.modelContext.registerTool({
  name: "ping_backend",
  description: "Calls the store's app backend through the Shopify App Proxy...",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute: async () => {
    const response = await fetch("/apps/composer/ping", {
      headers: { Accept: "application/json" },
    });
    return { status: response.status, body: await response.json() };
  },
}, { signal: controller.signal });
```

### 3. App Proxy 設定(`shopify.app.toml`)

```toml
[app_proxy]
url = "https://example.com/api/proxy"  # devではホストのみトンネルに書き換わる
subpath = "composer"
prefix = "apps"
# → https://<store>/apps/composer/* がアプリの /api/proxy/* へ転送される
```

### 4. エンドポイント(`app/routes/api.proxy.ping.tsx`)

```tsx
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Shopifyが付与するHMAC署名を検証。Proxy経由でなければ400
  const { session } = await authenticate.public.appProxy(request);
  return Response.json({
    ok: true,
    via: "app-proxy",
    shop: session?.shop,
    serverTime: new Date().toISOString(),
  });
};
```

## 検証結果

### 手動fetch(Chrome DevToolsコンソール、切り分け用)

```js
fetch("/apps/composer/ping").then(r => r.text()).then(console.log)
// → {"ok":true,"via":"app-proxy","shop":"webmcp-challenge-by-meefa.myshopify.com",
//    "loggedInCustomerId":null,"serverTime":"2026-08-29T02:22:33.100Z"}
```

![Chrome DevTools: 手動fetchで200 + 署名検証済みJSON](images/01_chrome-manual-fetch.png)

### ChatGPT(Workモード + GPT-5.6 Sol)から `ping_backend` を実行

- 「Use the ping_backend tool」と依頼 → 成功
- Status: 200 / ok: true / Connection: Shopify App Proxy / Response time: 965 ms
- Store: webmcp-challenge-by-meefa.myshopify.com

![ChatGPT: ping_backendツール実行成功](images/01_chatgpt-ping-backend.png)

コンソールでは登録・実行ログも確認:

```
[webmcp-hello] Registered tools: hello_world, get_page_info, ping_backend
```

## 本番設計への帰結

- `bouquet_*` ツールのバックエンド通信は **App Proxy経由で確定**
  (署名検証つき・同一オリジン・追加のCORS/認証基盤が不要)
- App Proxyは `logged_in_customer_id` も渡してくるので、ログイン顧客との紐付けも可能
- レイテンシは実測 ~1秒(dev トンネル経由)。本番ホスティングではさらに縮む想定だが、
  ツールのレスポンスは小さく保ち、読み取り系はページ内状態から即答する設計が望ましい
