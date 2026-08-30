# 04. WebMCPを「呼べるクライアント」は何か — Gemini in Chromeは未対応、審査要件との整合

- 調査日: 2026-08-30(Chrome 151時点)
- 症状: ChatGPTブラウザでは動くのに、Chrome + Gemini in Chrome ではWebMCPツールが使えない
- 結論: **Gemini in ChromeはWebMCPクライアント未実装(公式は "will soon support" のまま)。
  実装バグではない。主催者のルールもGeminiを要求していないので、要件は既に満たしている。**

## 学び(要点)

1. **WebMCPの「提供側(ページ)」と「消費側(エージェント)」は完全に別問題**
   - `chrome://flags/#enable-webmcp-testing` はページ側APIを生やすだけ。
     フラグを立てても、ツールを呼ぶクライアントが対応していなければ何も起きない
   - 切り分けは「DevTools > Application > WebMCP パネルにツールが並ぶか」で提供側を確定させ、
     並ぶのに動かないなら消費側の問題、と機械的に判断する
2. **Gemini in ChromeはWebMCPを消費しない(2026-08時点)**
   - Chrome公式ドキュメント7本を全文grepしても、Gemini in ChromeがWebMCPを呼ぶ記述はゼロ。
     唯一のヒットはInspector拡張の説明にある
     **"Note: This is separate from the Gemini in Chrome features."**(＝別物という注記)
   - I/O 2026ブログ / Chrome 149 origin trialブログとも
     「Gemini in Chrome will soon support WebMCP APIs」＝未対応。Chrome 150/151の
     リリース情報にも対応告知なし
   - Chromium ML(chrome-ai-dev-preview-discuss)に同症状の報告あり。投稿者の解決は
     "Solved by US VPN" — これはWebMCP対応ではなく**Gemini in Chrome自体の提供地域制限**の話
3. **Gemini Spark の auto browse も別経路** — Chrome 150で入った
   「クリック・フォーム入力を代行する」機能はactuation型で、WebMCPのツール呼び出しではない
4. **Chromeで実際にツールを呼べる手段は現状これだけ**
   | 手段 | 何をするか | 必要なもの |
   |---|---|---|
   | DevTools > Application > WebMCP | 登録確認・手動実行 | フラグのみ |
   | Model Context Tool Inspector 拡張 | 自然言語チャット→ツール連鎖実行 | 拡張 + Gemini APIキー |
   - 拡張は**Chromeウェブストア配布の単体拡張**(発行元 François Beaufort / Google Ireland、
     ただしリポジトリに "unofficial project not supported by Google" と明記)。
     Geminiアプリでも Gemini in Chrome でもない
   - 中身は `sidebar.js` が `localStorage.apiKey` のキーで `@google/genai` を初期化し、
     ブラウザから直接 `generativelanguage.googleapis.com` を叩くだけ。
     デフォルトモデルは `gemini-3.6-flash`。**APIキー未設定ならチャットボタンはdisabled**
   - ストア要件が Chrome 150.0.7861.0 以上。検証時はChromeバージョンも確認する
5. **Gemini in Chrome はシークレットモードでは使えない** — ストアパスワードの都合で
   シークレットで検証していると、それだけで不発になる

## 審査要件との整合(Devpost公式ルールを確認)

- ルール本文: 「Chrome 149以降をDLし `chrome://flags/#enable-webmcp-testing` を有効化して再起動」
  「Judges may test WebMCP tools using ChatGPT's in-app browser or Google Chrome with WebMCP enabled」
  → **Geminiへの言及は一切ない。「フラグを立てたChrome」であればよい**
- ルールには
  「Judges are not required to test the Project and may choose to judge based solely on the
  text description, images, and video」ともある。
  **審査員が実機を触らない可能性が公式に認められている＝動画と説明文が実質最重要**
- `AGENTS.md` の「I tested this in an incognito window」は
  **GitHubリポジトリがpublicかをログアウト状態で確認しろ**という意味であり、
  アプリがシークレットで動く要件ではない(ルール側にもincognitoの記載なし)

## 提出物への反映事項

- テスト手順は2経路で書く
  1. **経路A(確実)**: ChatGPTブラウザ → Workモード + GPT-5.6 Sol
  2. **経路B(ルール準拠)**: Chrome 149+ でフラグ有効化 →
     DevTools WebMCPパネルで登録確認 / Inspector拡張で実行
- 「**Gemini in Chromeは2026年8月時点でWebMCP未対応のため対象外**」と一行明記する。
  審査員がGeminiで試して「動かない」と誤判定するリスクを潰すため
- Inspector拡張はGemini APIキーの取得が要るので、審査員向けの主導線にはしない

## 出典

- https://developer.chrome.com/docs/ai/webmcp (`refs/docs/chrome-webmcp-get-started.html` にスナップショット)
- https://developer.chrome.com/blog/chrome-at-io26
- https://developer.chrome.com/blog/ai-webmcp-origin-trial (`refs/docs/chrome-webmcp-origin-trial.html`)
- https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/3CT8hvDH_kU
- https://support.google.com/chrome/answer/17140089 (Gemini in Chrome 提供条件)
- https://webmcp.devpost.com/rules
- https://github.com/beaufortfrancois/model-context-tool-inspector (`sidebar.js` / `PRIVACY.md`)
