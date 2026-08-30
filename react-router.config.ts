import type { Config } from "@react-router/dev/config";

// The CLI tunnel terminates at localhost, so action POSTs arrive with a
// tunnel-origin `Origin` header that doesn't match request.url. Allow the
// app's public host (react-router 7.13+ CSRF protection, remix-run/react-router#14708).
const appHost = (() => {
  try {
    return new URL(process.env.SHOPIFY_APP_URL ?? "").host;
  } catch {
    return null;
  }
})();

export default {
  allowedActionOrigins: [
    ...(appHost ? [appHost] : []),
    "**.trycloudflare.com", // dev tunnel host rotates per `shopify app dev`
    "*.fly.dev", // production host (SHOPIFY_APP_URL is absent in the Docker build)
  ],
} satisfies Config;
