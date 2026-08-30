import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Storefront App Proxy endpoint: https://<store>/apps/composer/ping
// Shopify forwards it server-side to <app>/api/proxy/ping with a signature.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log("[app-proxy] ping received:", url.pathname + url.search);

  // Verifies the HMAC signature Shopify adds to proxied requests.
  // Throws a 400 response for requests that didn't come through the proxy.
  const { session } = await authenticate.public.appProxy(request);

  return Response.json({
    ok: true,
    via: "app-proxy",
    shop: session?.shop ?? url.searchParams.get("shop"),
    loggedInCustomerId: url.searchParams.get("logged_in_customer_id") || null,
    serverTime: new Date().toISOString(),
  });
};
