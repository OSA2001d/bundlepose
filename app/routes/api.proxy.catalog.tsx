import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Storefront App Proxy endpoint: https://<store>/apps/composer/catalog
 *
 * Returns the composer catalog (stems/wraps/fees with composer.* metafields,
 * prices, inventory) plus the composition rules. Metafields are only readable
 * through the Admin API, hence this endpoint instead of /products/*.js.
 */

export interface CatalogComponent {
  variantId: string;
  productId: string;
  title: string;
  handle: string;
  price: string;
  available: number;
  role: string | null;
  color: string | null;
  meaning: string | null;
  occasions: string[];
  petSafe: boolean | null;
}

const RULES = {
  noun: "bouquet",
  unit: "stems",
  slots: [
    { key: "focal", label: "Focal flowers", min: 3, max: 15 },
    { key: "filler", label: "Filler", min: 0, max: 10 },
    { key: "greenery", label: "Greenery", min: 1, max: 8 },
  ],
  constraints: { minTotalStems: 4, maxTotalStems: 30, defaultBudget: 50 },
  leadTimeDays: 2,
  occasionValues: [
    "birthday",
    "mothers-day",
    "wedding",
    "sympathy",
    "anniversary",
    "get-well",
    "housewarming",
  ],
};

const CACHE_TTL_MS = 60_000;
let cache: { at: number; body: unknown } | null = null;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) {
    return Response.json({ error: "app_not_installed" }, { status: 503 });
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return Response.json(cache.body);
  }

  const response = await admin.graphql(
    `#graphql
    query composerCatalog {
      shop { currencyCode }
      products(first: 50, query: "tag:component OR tag:bouquet-parent") {
        nodes {
          id
          title
          handle
          tags
          metafields(namespace: "composer", first: 10) {
            nodes { key value }
          }
          variants(first: 1) {
            nodes { id price inventoryQuantity }
          }
        }
      }
    }`,
  );
  const json = (await response.json()) as { data?: any; errors?: unknown[] };
  if (!json.data) {
    return Response.json({ error: "catalog_unavailable" }, { status: 502 });
  }

  const components: CatalogComponent[] = [];
  const wraps: CatalogComponent[] = [];
  const fees: CatalogComponent[] = [];
  let parentVariantId: string | null = null;

  for (const product of json.data.products.nodes) {
    const variant = product.variants.nodes[0];
    if (!variant) continue;
    const meta = Object.fromEntries(
      product.metafields.nodes.map((node: { key: string; value: string }) => [
        node.key,
        node.value,
      ]),
    ) as Record<string, string>;
    const entry: CatalogComponent = {
      variantId: variant.id,
      productId: product.id,
      title: product.title,
      handle: product.handle,
      price: variant.price,
      available: variant.inventoryQuantity ?? 0,
      role: meta.role ?? null,
      color: meta.color ?? null,
      meaning: meta.meaning ?? null,
      occasions: meta.occasions
        ? meta.occasions.split(",").map((occasion) => occasion.trim())
        : [],
      petSafe:
        meta.pet_safe === "true" ? true : meta.pet_safe === "false" ? false : null,
    };
    const tags: string[] = product.tags;
    if (tags.includes("bouquet-parent")) {
      parentVariantId = variant.id;
    } else if (tags.includes("wrap")) {
      wraps.push(entry);
    } else if (tags.includes("fee")) {
      fees.push(entry);
    } else if (tags.includes("stem")) {
      components.push(entry);
    }
  }

  const body = {
    rules: RULES,
    currency: json.data.shop.currencyCode,
    parentVariantId,
    components,
    wraps,
    fees,
  };
  cache = { at: Date.now(), body };
  return Response.json(body);
};
