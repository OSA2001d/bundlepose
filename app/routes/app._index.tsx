import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { authenticate } from "../shopify.server";

// The app has a single screen: opening it lands on the setup page.
// Search params (shop, host, embedded, session token) must survive the redirect.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  throw redirect(`/app/setup${url.search}`);
};

export default function AppIndex() {
  return null;
}
