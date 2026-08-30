/**
 * Landing page markup, kept server-side on purpose.
 *
 * `.server.ts` modules are stripped from the client bundle, so the content
 * below is not reachable by inspecting the page source or the JS assets
 * before the reveal time — the loader only sends it once the countdown ends.
 */

const STORE_URL = "https://webmcp-challenge-by-meefa.myshopify.com";

export const LANDING_HTML = `
<style>
  .lp { width: 100%; max-width: 780px; margin: 0 auto; }
  .lp-badge { display:inline-block; font:600 10px ui-monospace,Menlo,monospace; letter-spacing:.12em;
    background:#fffdf4; border:1px solid #cbb988; color:#6e6142; padding:5px 9px; border-radius:999px; }
  .lp h1 { font-size:clamp(28px,4.4vw,40px); line-height:1.2; font-weight:700; margin:14px 0 0; }
  .lp-tagline { font:600 clamp(14px,1.8vw,17px)/1.5 ui-monospace,Menlo,monospace; color:#6e6142;
    margin:12px 0 0; letter-spacing:.02em; }
  .lp-lede { font-size:clamp(14px,1.6vw,16.5px); line-height:1.65; color:#4a462f; margin:14px 0 0; }
  .lp-hero { display:block; width:100%; height:clamp(200px,30vw,340px); object-fit:cover;
    border-radius:16px; margin:28px 0 0; }
  .lp-section { margin-top:40px; }
  .lp h2 { font-size:clamp(18px,2.2vw,22px); line-height:1.25; font-weight:700; margin:0 0 12px; }
  .lp p { font-size:14.5px; line-height:1.7; color:#3a3e30; margin:0; }
  .lp ul { margin:0; padding:0; list-style:none; }
  .lp li { font-size:14.5px; line-height:1.7; color:#3a3e30; padding:12px 0;
    border-bottom:1px solid rgba(35,39,28,.12); }
  .lp li:last-child { border-bottom:none; }
  .lp code { font:500 12.5px ui-monospace,Menlo,monospace; background:#fffdf4;
    border:1px solid #cbb988; border-radius:4px; padding:1px 5px; }
  .lp-actions { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-top:18px; }
  .lp-btn { display:inline-block; font-size:14px; font-weight:600; background:#23271c;
    color:#f4f1ea; padding:13px 22px; border-radius:999px; text-decoration:none; }
  .lp-btn-ghost { display:inline-block; font-size:14px; font-weight:600; color:#23271c;
    border:1.5px solid #23271c; padding:11.5px 20px; border-radius:999px; text-decoration:none; }
  .lp-foot { font-size:12.5px; line-height:1.6; color:#6e6142; margin:40px 0 0;
    padding-top:20px; border-top:1px solid rgba(35,39,28,.12); }
</style>

<main class="lp">
  <span class="lp-badge">A WEBMCP CHALLENGE ENTRY</span>
  <h1>Bundlepose</h1>
  <p class="lp-tagline">Agents propose. People compose. Shopify bundles.</p>
  <p class="lp-lede">
    A Shopify app where a shopper and an AI agent compose a product that
    doesn&rsquo;t exist yet. The agent picks stems from the florist&rsquo;s live
    inventory, the shopper tweaks them by hand on the same page, and a Cart
    Transform Function turns the result into one real, purchasable bouquet
    &mdash; priced as the sum of its parts.
  </p>

  <img class="lp-hero" src="/api/proxy/guide-hero.jpeg"
    alt="Single stems on the left become one kraft-wrapped bouquet on the right">

  <section class="lp-section">
    <h2>What&rsquo;s different</h2>
    <ul>
      <li><strong>Product creation, not product discovery.</strong> Shopping agents
        are good at finding things that already exist. Here the agent and the
        shopper build something new from real variants.</li>
      <li><strong>One shared workbench.</strong> The composer panel and the agent
        read and write the same draft, so a stem removed by hand is visible to the
        agent on its next call.</li>
      <li><strong>A real order, not a note in a comment box.</strong> Stems, wrap
        and arrangement fee merge into a single bouquet line that carries its own
        recipe through checkout and fulfilment.</li>
    </ul>
  </section>

  <section class="lp-section">
    <h2>Try the demo store</h2>
    <p>
      Open the store in ChatGPT&rsquo;s built-in browser (Work mode, GPT-5.6 Sol),
      then ask for a bouquet. Once the agent drafts it, everything can be tweaked by hand.
    </p>
    <div class="lp-actions">
      <a class="lp-btn" href="${STORE_URL}/apps/composer/guide">See how it works</a>
      <a class="lp-btn-ghost" href="${STORE_URL}">Open the store</a>
    </div>
  </section>

  <p class="lp-foot">
    Built with Shopify&rsquo;s WebMCP storefront tools, a Theme App Extension that
    registers <code>bouquet_*</code> tools, and a Rust Cart Transform Function.
  </p>
</main>
`;
