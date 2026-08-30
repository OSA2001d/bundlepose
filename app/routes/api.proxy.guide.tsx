import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Storefront App Proxy page: https://<store>/apps/composer/guide
 *
 * Returns Liquid so Shopify renders it inside the theme layout (header,
 * footer — and the composer app embed, so the panel and WebMCP tools work
 * right on this page). No merchant setup needed: the page exists as soon as
 * the app is installed.
 */

const PROMPTS = [
  {
    text: "Make a warm-toned bouquet for my mother's 60th birthday, under $40.",
    note: "The composer fills with stems, within budget",
  },
  {
    text: "I removed one flower by hand — check the bouquet and rebalance it within the budget.",
    note: "Your hand edits are read and the bouquet is adjusted",
  },
  {
    text: "Which of these flowers would suit a sympathy arrangement?",
    note: "The florist's knowledge: meanings, occasions, pet safety",
  },
  {
    text: "Write a short card message based on the flowers' meanings, then add the bouquet to the cart.",
    note: "One bouquet, one line in the cart — message included",
  },
];

const GUIDE_BODY = `
<style>
  .bqg { font-family: system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #23271c; max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  .bqg-badge { display: inline-block; font: 600 10px ui-monospace, Menlo, monospace; letter-spacing: .12em; background: #fffdf4; border: 1px solid #cbb988; color: #6e6142; padding: 5px 9px; border-radius: 999px; }
  .bqg h1 { font: 700 clamp(26px, 4vw, 38px)/1.2 system-ui, sans-serif; margin: 12px 0 0; }
  .bqg-lede { font: 400 clamp(14px, 1.6vw, 17px)/1.6 system-ui, sans-serif; color: #4a462f; margin: 12px 0 0; max-width: 640px; }
  .bqg h2 { font: 700 clamp(19px, 2.4vw, 24px)/1.2 system-ui, sans-serif; margin: 44px 0 0; }
  .bqg-steps { margin-top: 8px; }
  .bqg-step { display: flex; gap: 14px; align-items: baseline; padding: 14px 0; border-bottom: 1px solid rgba(35,39,28,.12); }
  .bqg-step-n { width: 28px; height: 28px; flex: none; border: 1.5px solid #23271c; border-radius: 50%; display: flex; align-items: center; justify-content: center; font: 600 13px/1 system-ui, sans-serif; }
  .bqg-step-t { font: 400 15px/1.6 system-ui, sans-serif; }
  .bqg-step-t b { font-weight: 600; }
  .bqg-step-t small { display: block; color: #6e6142; font-size: 12.5px; margin-top: 2px; }
  .bqg-cards { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
  .bqg-card { background: #fffdf4; border: 1px solid #cbb988; box-shadow: 2px 3px 0 rgba(35,39,28,.12); padding: 14px 16px; display: flex; justify-content: space-between; gap: 14px; align-items: center; }
  .bqg-card:nth-child(odd) { transform: rotate(-.4deg); }
  .bqg-card:nth-child(even) { transform: rotate(.35deg); }
  .bqg-card-p { font: 500 13.5px/1.5 ui-monospace, Menlo, monospace; }
  .bqg-card-n { font: 400 11.5px/1.4 system-ui, sans-serif; color: #8a7d55; margin-top: 4px; }
  .bqg-copy { font: 600 12px/1 system-ui, sans-serif; background: #23271c; color: #f4f1ea; padding: 10px 16px; border: none; border-radius: 999px; cursor: pointer; flex: none; }
  .bqg-copy.copied { background: #fffdf4; color: #23271c; border: 1.5px solid #23271c; }
  .bqg-note { background: #e7d9b2; border-radius: 12px; padding: 14px 16px; margin-top: 44px; font: 400 13px/1.6 system-ui, sans-serif; color: #4a462f; }
  .bqg-under { font: 400 14px/1.7 system-ui, sans-serif; color: #3a3e30; margin-top: 8px; max-width: 680px; }
  .bqg-under li { margin-top: 6px; }
  .bqg-cta { display: inline-block; font: 600 14px/1 system-ui, sans-serif; background: #23271c; color: #f4f1ea; padding: 14px 22px; border-radius: 999px; text-decoration: none; margin-top: 28px; }
  .bqg-hero { border-radius: 16px; overflow: hidden; margin-bottom: 28px; }
  .bqg-hero img { display: block; width: 100%; height: clamp(220px, 32vw, 380px); object-fit: cover; }
</style>

<div class="bqg">
  <div class="bqg-hero">
    <img src="/apps/composer/guide-hero.jpeg" alt="Single stems on the left become one kraft-wrapped bouquet on the right" loading="eager">
  </div>
  <span class="bqg-badge">A NEW WAY TO BUY</span>
  <h1>Build a bouquet together with your AI agent.</h1>
  <p class="bqg-lede">
    {{ shop.name }} shares its workbench with your AI agent through WebMCP.
    You describe the occasion; the agent picks stems from today's flowers;
    you tweak them by hand in the composer — and it all becomes one bouquet,
    one line in the cart.
  </p>

  <h2>Start here</h2>
  <div class="bqg-steps">
    <div class="bqg-step">
      <span class="bqg-step-n">1</span>
      <span class="bqg-step-t">
        <b>Open this store in ChatGPT&rsquo;s browser.</b>
        <small>In the ChatGPT desktop app, open this page in the built-in browser, switch to Work mode and pick GPT-5.6 Sol. Site tools appear in the address bar.</small>
      </span>
    </div>
    <div class="bqg-step">
      <span class="bqg-step-n">2</span>
      <span class="bqg-step-t">
        <b>Ask for a bouquet.</b>
        <small>Copy a prompt below. The stems land in the composer — the 🌸 button at the bottom right of every page.</small>
      </span>
    </div>
    <div class="bqg-step">
      <span class="bqg-step-n">3</span>
      <span class="bqg-step-t">
        <b>Finish it by hand, then add it to the cart.</b>
        <small>Change quantities in the panel — the agent sees your edits. Checkout shows one bouquet with its recipe inside.</small>
      </span>
    </div>
  </div>

  <h2>Try asking</h2>
  <div class="bqg-cards">
    __PROMPT_CARDS__
  </div>

  <h2>What's happening underneath</h2>
  <ul class="bqg-under">
    <li>This page registers <b>bouquet_*</b> WebMCP tools (rules, today's flowers with meanings &amp; occasions, draft editing, validation, commit) alongside Shopify's standard storefront tools.</li>
    <li>You and the agent edit the <b>same draft</b> — the composer panel is the shared workbench.</li>
    <li>On &ldquo;add to cart&rdquo;, a <b>Cart Transform Function</b> merges the stems, wrap and fee into a single bouquet line, priced as the sum of its parts.</li>
  </ul>

  <div class="bqg-note">
    Testing without an agent? Run <code>bouquet_create</code> from Chrome&rsquo;s DevTools WebMCP panel — from there, everything can be finished by hand in the 🌸 composer.
  </div>

  <a class="bqg-cta" href="/">Back to the shop</a>
</div>

<script>
  document.querySelectorAll("[data-bqg-copy]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var text = button.getAttribute("data-bqg-copy");
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
        button.classList.add("copied");
        setTimeout(function () {
          button.textContent = "Copy";
          button.classList.remove("copied");
        }, 2000);
      } catch (error) {
        console.warn("clipboard unavailable", error);
      }
    });
  });
</script>
`;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const promptCards = PROMPTS.map(
  (prompt) => `
    <div class="bqg-card">
      <div>
        <div class="bqg-card-p">&quot;${escapeHtml(prompt.text)}&quot;</div>
        <div class="bqg-card-n">${escapeHtml(prompt.note)}</div>
      </div>
      <button type="button" class="bqg-copy" data-bqg-copy="${escapeHtml(prompt.text)}">Copy</button>
    </div>`,
).join("\n");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { liquid } = await authenticate.public.appProxy(request);
  return liquid(GUIDE_BODY.replace("__PROMPT_CARDS__", promptCards));
};
