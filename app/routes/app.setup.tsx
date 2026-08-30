import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import fs from "node:fs";
import path from "node:path";
import { authenticate } from "../shopify.server";
import {
  ALL_ITEMS,
  COMPOSER_NAMESPACE,
  PARENT,
  type CatalogItem,
} from "../lib/bouquet-catalog.server";

type AdminClient = Awaited<
  ReturnType<typeof authenticate.admin>
>["admin"];

const CONFIG_NAMESPACE = "$app:bouquet";
const CONFIG_KEY = "config";

// Local folder holding the generated product images (dev machine only).
const IMAGE_DIR = path.resolve(process.cwd(), "../../../temp/from_image_agent");

/** Image filename for a catalog item; overrides where the slug differs. */
const IMAGE_OVERRIDES: Record<string, string> = {
  "Baby's Breath": "babys-breath.jpeg",
  "Scented Soy Candle — Fresh Peony": "scented-soy-candle.jpeg",
};
const imageFileFor = (item: CatalogItem) =>
  IMAGE_OVERRIDES[item.title] ??
  `${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.jpeg`;

async function gql(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
) {
  const response = await admin.graphql(query, variables ? { variables } : {});
  const json = (await response.json()) as {
    data?: Record<string, any>;
    errors?: unknown[];
  };
  if (json.errors?.length) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data!;
}

async function findProductByTitle(admin: AdminClient, title: string) {
  const data = await gql(
    admin,
    `#graphql
    query findProduct($query: String!) {
      products(first: 1, query: $query) {
        nodes {
          id
          title
          variants(first: 1) { nodes { id inventoryItem { id } } }
        }
      }
    }`,
    { query: `title:'${title.replace(/'/g, "\\'")}'` },
  );
  return data.products.nodes[0] ?? null;
}

async function setInventory(
  admin: AdminClient,
  inventoryItemId: string,
  locationIds: string[],
  quantity: number,
) {
  const tracked = await gql(
    admin,
    `#graphql
    mutation trackInventory($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        userErrors { field message }
      }
    }`,
    { id: inventoryItemId, input: { tracked: true } },
  );
  const trackedErrors = tracked.inventoryItemUpdate.userErrors;
  if (trackedErrors?.length) throw new Error(JSON.stringify(trackedErrors));

  // Stock the item at each location first; inventorySetQuantities requires it.
  for (const locationId of locationIds) {
    await gql(
      admin,
      `#graphql
      mutation stockAtLocation($inventoryItemId: ID!, $locationId: ID!) {
        inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
          inventoryLevel { id }
          userErrors { field message }
        }
      }`,
      { inventoryItemId, locationId },
    );
  }

  const set = await gql(
    admin,
    `#graphql
    mutation setQuantities($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        userErrors { field message }
      }
    }`,
    {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        quantities: locationIds.map((locationId) => ({
          inventoryItemId,
          locationId,
          quantity,
        })),
      },
    },
  );
  const setErrors = set.inventorySetQuantities.userErrors;
  if (setErrors?.length) throw new Error(JSON.stringify(setErrors));
}

// Components and the merge parent sell only through the composer: UNLISTED
// hides them from browsing while keeping direct variant references working.
// Regular merchandise stays ACTIVE (normally listed).
const targetStatus = (item: CatalogItem) =>
  item.tags.includes("component") || item.tags.includes("bouquet-parent")
    ? "UNLISTED"
    : "ACTIVE";

async function seedProduct(
  admin: AdminClient,
  item: CatalogItem,
  locationIds: string[],
) {
  const existing = await findProductByTitle(admin, item.title);
  if (existing) {
    // Already seeded: refresh inventory and metafields instead.
    if (item.inventory != null && locationIds.length) {
      const inventoryItemId = existing.variants.nodes[0]?.inventoryItem?.id;
      if (inventoryItemId) {
        await setInventory(admin, inventoryItemId, locationIds, item.inventory);
      }
    }
    if (item.metafields) {
      const set = await gql(
        admin,
        `#graphql
        mutation refreshMetafields($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }`,
        {
          metafields: Object.entries(item.metafields).map(([key, value]) => ({
            ownerId: existing.id,
            namespace: COMPOSER_NAMESPACE,
            key,
            type: "single_line_text_field",
            value,
          })),
        },
      );
      const errors = set.metafieldsSet.userErrors;
      if (errors?.length) throw new Error(`${item.title}: ${JSON.stringify(errors)}`);
    }
    const statusUpdate = await gql(
      admin,
      `#graphql
      mutation refreshStatus($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          userErrors { field message }
        }
      }`,
      { product: { id: existing.id, status: targetStatus(item) } },
    );
    const statusErrors = statusUpdate.productUpdate.userErrors;
    if (statusErrors?.length) {
      throw new Error(`${item.title}: ${JSON.stringify(statusErrors)}`);
    }
    return { title: item.title, id: existing.id, skipped: true };
  }

  const variant: Record<string, unknown> = {
    optionValues: [{ optionName: "Title", name: "Default Title" }],
    price: item.price,
  };
  if (item.inventory != null && locationIds.length) {
    variant.inventoryItem = { tracked: true };
    variant.inventoryQuantities = locationIds.map((locationId) => ({
      locationId,
      name: "available",
      quantity: item.inventory,
    }));
  }
  const productInput: Record<string, unknown> = {
    title: item.title,
    tags: item.tags,
    // Components sell only as part of a bouquet: UNLISTED keeps them
    // purchasable via direct variant reference (required for the merge)
    // but hides them from search, collections, and recommendations.
    status: targetStatus(item),
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [variant],
  };
  if (item.metafields) {
    productInput.metafields = Object.entries(item.metafields).map(
      ([key, value]) => ({
        namespace: COMPOSER_NAMESPACE,
        key,
        type: "single_line_text_field",
        value,
      }),
    );
  }

  const data = await gql(
    admin,
    `#graphql
    mutation seedProduct($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product {
          id
          variants(first: 1) { nodes { id } }
        }
        userErrors { field message }
      }
    }`,
    { input: productInput },
  );
  const errors = data.productSet.userErrors;
  if (errors?.length) {
    throw new Error(`${item.title}: ${JSON.stringify(errors)}`);
  }
  return { title: item.title, id: data.productSet.product.id, skipped: false };
}

async function getStockLocationIds(admin: AdminClient): Promise<string[]> {
  const data = await gql(
    admin,
    `#graphql
    query stockLocations {
      locations(first: 10) { nodes { id name fulfillsOnlineOrders } }
    }`,
  );
  const nodes: { id: string; fulfillsOnlineOrders: boolean }[] =
    data.locations.nodes;
  // Online Store availability comes from locations that fulfill online
  // orders — stocking only a custom location leaves products unavailable.
  const fulfilling = nodes.filter((node) => node.fulfillsOnlineOrders);
  return (fulfilling.length ? fulfilling : nodes).map((node) => node.id);
}

async function publishAll(admin: AdminClient, productIds: string[]) {
  // Publication.catalog is null for sales-channel publications on this store,
  // so we can't match "Online Store" by name. Publish to every sales channel
  // instead — fine (and useful) for a demo store. Idempotent.
  const publications = await gql(
    admin,
    `#graphql
    query publications {
      publications(first: 25) { nodes { id } }
    }`,
  );
  const publicationIds: string[] = publications.publications.nodes.map(
    (node: { id: string }) => node.id,
  );
  if (!publicationIds.length) return { published: 0, note: "No publications found" };

  let published = 0;
  const failures: string[] = [];
  for (const id of productIds) {
    const data = await gql(
      admin,
      `#graphql
      mutation publish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }`,
      { id, input: publicationIds.map((publicationId) => ({ publicationId })) },
    );
    const errors = data.publishablePublish.userErrors;
    if (errors?.length) failures.push(`${id}: ${JSON.stringify(errors)}`);
    else published += 1;
  }
  return {
    published,
    note: failures.length ? `publish failures: ${failures.join("; ")}` : null,
  };
}

async function setRequiresComponents(admin: AdminClient) {
  const parent = await findProductByTitle(admin, PARENT.title);
  if (!parent) throw new Error("Custom Bouquet product not found");
  const variantId = parent.variants.nodes[0].id;
  const data = await gql(
    admin,
    `#graphql
    mutation requireComponents($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }`,
    {
      productId: parent.id,
      variants: [{ id: variantId, requiresComponents: true }],
    },
  );
  const errors = data.productVariantsBulkUpdate.userErrors;
  if (errors?.length) throw new Error(JSON.stringify(errors));
  return variantId as string;
}

async function uploadProductImages(admin: AdminClient) {
  if (!fs.existsSync(IMAGE_DIR)) {
    throw new Error(
      `Image folder not found: ${IMAGE_DIR} (this action only works on the dev machine)`,
    );
  }

  // Products with their current media, in one query.
  const data = await gql(
    admin,
    `#graphql
    query productsForImages {
      products(first: 50, query: "tag:component OR tag:bouquet-parent OR tag:merch") {
        nodes {
          id
          title
          media(first: 1) { nodes { id } }
        }
      }
    }`,
  );

  const results: string[] = [];
  let uploaded = 0;
  for (const product of data.products.nodes) {
    const item = ALL_ITEMS.find((entry) => entry.title === product.title);
    if (!item) continue;
    if (product.media.nodes.length > 0) {
      results.push(`${product.title}: already has an image (skipped)`);
      continue;
    }
    const filePath = path.join(IMAGE_DIR, imageFileFor(item));
    if (!fs.existsSync(filePath)) {
      results.push(`${product.title}: file missing (${path.basename(filePath)})`);
      continue;
    }
    const buffer = fs.readFileSync(filePath);

    const staged = await gql(
      admin,
      `#graphql
      mutation stage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters { name value }
          }
          userErrors { field message }
        }
      }`,
      {
        input: [
          {
            filename: path.basename(filePath),
            mimeType: "image/jpeg",
            httpMethod: "POST",
            resource: "IMAGE",
            fileSize: String(buffer.length),
          },
        ],
      },
    );
    const stageErrors = staged.stagedUploadsCreate.userErrors;
    if (stageErrors?.length) {
      results.push(`${product.title}: staging failed ${JSON.stringify(stageErrors)}`);
      continue;
    }
    const target = staged.stagedUploadsCreate.stagedTargets[0];

    const form = new FormData();
    for (const parameter of target.parameters) {
      form.append(parameter.name, parameter.value);
    }
    form.append(
      "file",
      new Blob([buffer], { type: "image/jpeg" }),
      path.basename(filePath),
    );
    const uploadResponse = await fetch(target.url, { method: "POST", body: form });
    if (!uploadResponse.ok) {
      results.push(
        `${product.title}: upload failed HTTP ${uploadResponse.status}`,
      );
      continue;
    }

    const media = await gql(
      admin,
      `#graphql
      mutation attach($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { ... on MediaImage { id } }
          mediaUserErrors { field message }
        }
      }`,
      {
        productId: product.id,
        media: [
          {
            originalSource: target.resourceUrl,
            mediaContentType: "IMAGE",
            alt: product.title,
          },
        ],
      },
    );
    const mediaErrors = media.productCreateMedia.mediaUserErrors;
    if (mediaErrors?.length) {
      results.push(`${product.title}: attach failed ${JSON.stringify(mediaErrors)}`);
      continue;
    }
    uploaded += 1;
  }
  return { uploaded, notes: results };
}

async function activateCartTransform(admin: AdminClient) {
  const functions = await gql(
    admin,
    `#graphql
    query cartTransformFunctions {
      shopifyFunctions(first: 25, apiType: "cart_transform") {
        nodes { id title }
      }
    }`,
  );
  const fn = functions.shopifyFunctions.nodes[0];
  if (!fn) {
    throw new Error(
      "No cart_transform function found. Run `shopify app deploy` first.",
    );
  }

  // Already activated? cartTransformCreate errors if a transform exists.
  const existing = await gql(
    admin,
    `#graphql
    query cartTransforms {
      cartTransforms(first: 10) { nodes { id functionId } }
    }`,
  );
  let transformId = existing.cartTransforms.nodes.find(
    (node: { functionId: string }) => node.functionId === fn.id,
  )?.id as string | undefined;

  if (!transformId) {
    const created = await gql(
      admin,
      `#graphql
      mutation activate($functionId: String!) {
        cartTransformCreate(functionId: $functionId, blockOnFailure: false) {
          cartTransform { id }
          userErrors { field message }
        }
      }`,
      { functionId: fn.id },
    );
    const errors = created.cartTransformCreate.userErrors;
    if (errors?.length) throw new Error(JSON.stringify(errors));
    transformId = created.cartTransformCreate.cartTransform.id;
  }

  const parent = await findProductByTitle(admin, PARENT.title);
  if (!parent) throw new Error("Custom Bouquet product not found — seed first");
  const parentVariantId = parent.variants.nodes[0].id;

  const config = JSON.stringify({ templates: { bouquet: parentVariantId } });
  const set = await gql(
    admin,
    `#graphql
    mutation setConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    {
      metafields: [
        {
          ownerId: transformId,
          namespace: CONFIG_NAMESPACE,
          key: CONFIG_KEY,
          type: "json",
          value: config,
        },
      ],
    },
  );
  const errors = set.metafieldsSet.userErrors;
  if (errors?.length) throw new Error(JSON.stringify(errors));

  return { transformId, parentVariantId, config };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const data = await gql(
    admin,
    `#graphql
    query setupStatus {
      components: products(first: 50, query: "tag:component") {
        nodes { id title }
      }
      parent: products(first: 1, query: "title:'Custom Bouquet'") {
        nodes { id }
      }
      cartTransforms(first: 10) { nodes { id functionId } }
    }`,
  );
  return {
    componentCount: data.components.nodes.length,
    parentSeeded: data.parent.nodes.length > 0,
    transformActive: data.cartTransforms.nodes.length > 0,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "seed") {
      const locationIds = await getStockLocationIds(admin);
      const results = [];
      for (const item of ALL_ITEMS) {
        results.push(await seedProduct(admin, item, locationIds));
      }
      const createdIds = results.filter((r) => !r.skipped).map((r) => r.id);
      // Publish everything (idempotent) so a re-run also fixes unpublished products.
      const publish = await publishAll(admin, results.map((r) => r.id));
      const parentVariantId = await setRequiresComponents(admin);
      return {
        intent,
        ok: true,
        message: `Seeded ${createdIds.length} products (${results.length - createdIds.length} already existed — inventory refreshed to catalog values), published ${publish.published}. Parent variant ${parentVariantId} now requires components.${publish.note ? ` Note: ${publish.note}` : ""}`,
      };
    }

    if (intent === "upload_images") {
      const result = await uploadProductImages(admin);
      return {
        intent,
        ok: true,
        message: `Uploaded ${result.uploaded} product images.${result.notes.length ? ` Notes: ${result.notes.join(" / ")}` : ""}`,
      };
    }

    if (intent === "activate") {
      const result = await activateCartTransform(admin);
      return {
        intent,
        ok: true,
        message: `Cart transform active (${result.transformId}). Config: ${result.config}`,
      };
    }

    return { intent, ok: false, message: "Unknown intent" };
  } catch (error) {
    return { intent, ok: false, message: String(error) };
  }
};

export default function SetupPage() {
  const status = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const run = (intent: string) => () =>
    fetcher.submit({ intent }, { method: "POST" });

  return (
    <s-page heading="Bouquet setup">
      <s-section heading="1. Seed demo catalog">
        <s-paragraph>
          Creates 14 flowers, 2 wraps, an arrangement fee, the Custom Bouquet
          merge parent (all unlisted), and 4 regular shop products (listed).
          Idempotent: existing titles are updated, not duplicated.
        </s-paragraph>
        <s-paragraph>
          Status: {status.componentCount} component products,{" "}
          {status.parentSeeded ? "parent seeded" : "parent missing"}.
        </s-paragraph>
        <s-button onClick={run("seed")} {...(busy ? { disabled: true } : {})}>
          Seed products
        </s-button>
      </s-section>

      <s-section heading="2. Upload product images">
        <s-paragraph>
          Uploads the generated images from temp/from_image_agent to every
          seeded product (skips products that already have one). Dev machine
          only.
        </s-paragraph>
        <s-button
          onClick={run("upload_images")}
          {...(busy ? { disabled: true } : {})}
        >
          Upload images
        </s-button>
      </s-section>

      <s-section heading="3. Activate cart transform">
        <s-paragraph>
          Requires a deployed function (`shopify app deploy`). Creates the cart
          transform and writes the template→parent-variant config metafield.
        </s-paragraph>
        <s-paragraph>
          Status: {status.transformActive ? "active" : "not active"}.
        </s-paragraph>
        <s-button
          onClick={run("activate")}
          {...(busy ? { disabled: true } : {})}
        >
          Activate cart transform
        </s-button>
      </s-section>

      {fetcher.data ? (
        <s-section heading="Result">
          <s-paragraph>
            {fetcher.data.ok ? "✅ " : "❌ "}
            {fetcher.data.message}
          </s-paragraph>
        </s-section>
      ) : null}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
