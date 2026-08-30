/**
 * Bouquet Composer — WebMCP tools + on-page panel (design 4a: inline diff).
 *
 * Humans and agents edit the same drafts: tools mutate the store below, the
 * panel renders it, and human edits are visible to the agent via
 * bouquet_get_state. Only bouquet_commit writes to the cart
 * (Shopify.actions.updateCart); the Cart Transform Function merges component
 * lines into one bouquet line carrying a hidden `_bundle_id` attribute, which
 * lets us find and replace a committed bouquet when it is edited again.
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------- catalog
  let catalogPromise = null;
  const getCatalog = () => {
    catalogPromise ??= fetch("/apps/composer/catalog", {
      headers: { Accept: "application/json" },
    }).then((response) => {
      if (!response.ok) {
        catalogPromise = null;
        throw new Error(`Catalog unavailable (HTTP ${response.status})`);
      }
      return response.json();
    });
    return catalogPromise;
  };

  const allEntries = (catalog) => [
    ...catalog.components,
    ...catalog.wraps,
    ...catalog.fees,
  ];
  const findEntry = (catalog, variantId) =>
    allEntries(catalog).find((entry) => entry.variantId === variantId) ?? null;

  // ------------------------------------------------------------------ store
  const STORAGE_KEY = "bouquet-composer-v1";
  const listeners = new Set();
  let state = { drafts: {}, activeBundleId: null };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === "object" && saved.drafts) state = saved;
  } catch {
    /* fresh state */
  }
  const notify = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
    listeners.forEach((listener) => listener());
  };

  const newBundleId = () =>
    `bq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const createDraft = ({ name, budget, occasion, recipient } = {}) => {
    const id = newBundleId();
    state.drafts[id] = {
      id,
      name: name?.trim() || "Custom Bouquet",
      occasion: occasion ?? null,
      recipient: recipient ?? null,
      budget: Number.isFinite(budget) && budget > 0 ? budget : null,
      items: {}, // variantId -> quantity (current edit)
      wrapVariantId: null,
      notes: {},
      committed: false,
      committedItems: null, // snapshot of items at last commit
      committedWrapVariantId: null,
      cartLineId: null, // merged parent CartLine gid, when known
    };
    state.activeBundleId = id;
    notify();
    return state.drafts[id];
  };

  const resolveDraft = (bundleId) => {
    if (bundleId) return state.drafts[bundleId] ?? null;
    return state.activeBundleId ? state.drafts[state.activeBundleId] : null;
  };

  // ----------------------------------------------------------------- domain
  const costOf = (items, wrapVariantId, catalog) => {
    let stems = 0;
    let cost = 0;
    for (const [variantId, quantity] of Object.entries(items)) {
      const entry = findEntry(catalog, variantId);
      if (!entry) continue;
      stems += quantity;
      cost += Number(entry.price) * quantity;
    }
    const wrap = wrapVariantId ? findEntry(catalog, wrapVariantId) : null;
    cost += wrap ? Number(wrap.price) : 0;
    cost += catalog.fees.reduce((sum, fee) => sum + Number(fee.price), 0);
    return { stems, cost };
  };

  const totalsOf = (draft, catalog) => {
    const current = costOf(draft.items, draft.wrapVariantId, catalog);
    return {
      stems: current.stems,
      total: current.cost.toFixed(2),
      remaining:
        draft.budget != null ? (draft.budget - current.cost).toFixed(2) : null,
    };
  };

  /** Diff vs the cart (last committed snapshot). Null for uncommitted drafts. */
  const diffOf = (draft, catalog) => {
    if (!draft.committed || !draft.committedItems) return null;
    const changes = [];
    const variantIds = new Set([
      ...Object.keys(draft.items),
      ...Object.keys(draft.committedItems),
    ]);
    for (const variantId of variantIds) {
      const from = draft.committedItems[variantId] ?? 0;
      const to = draft.items[variantId] ?? 0;
      if (from !== to) {
        changes.push({
          variant_id: variantId,
          title: findEntry(catalog, variantId)?.title ?? variantId,
          in_cart: from,
          now: to,
        });
      }
    }
    const wrapChanged = draft.wrapVariantId !== draft.committedWrapVariantId;
    const before = costOf(
      draft.committedItems,
      draft.committedWrapVariantId,
      catalog,
    ).cost;
    const after = costOf(draft.items, draft.wrapVariantId, catalog).cost;
    return {
      count: changes.length + (wrapChanged ? 1 : 0),
      changes,
      wrapChanged,
      priceDelta: after - before,
    };
  };

  const validateDraft = (draft, catalog) => {
    const violations = [];
    const { constraints } = catalog.rules;
    const totals = totalsOf(draft, catalog);
    const diff = diffOf(draft, catalog);
    if (totals.stems === 0) {
      violations.push({
        code: "EMPTY",
        message: "The bouquet has no stems yet.",
        hint: "Add flowers with bouquet_add_items.",
      });
    } else if (totals.stems < constraints.minTotalStems) {
      violations.push({
        code: "MIN_STEMS",
        message: `A bouquet needs at least ${constraints.minTotalStems} stems (currently ${totals.stems}).`,
        hint: "Add more stems.",
      });
    }
    if (totals.stems > constraints.maxTotalStems) {
      violations.push({
        code: "MAX_STEMS",
        message: `A bouquet can hold at most ${constraints.maxTotalStems} stems (currently ${totals.stems}).`,
        hint: "Remove some stems.",
      });
    }
    for (const [variantId, quantity] of Object.entries(draft.items)) {
      const entry = findEntry(catalog, variantId);
      if (!entry) {
        violations.push({
          code: "UNKNOWN_VARIANT",
          message: `Unknown component: ${variantId}.`,
          hint: "Remove it and pick components from bouquet_list_components.",
        });
      } else if (quantity > entry.available) {
        violations.push({
          code: "INSUFFICIENT_INVENTORY",
          message: `Only ${entry.available} × ${entry.title} in stock (requested ${quantity}).`,
          hint: "Lower the quantity or pick an alternative.",
        });
      }
    }
    if (draft.budget != null && Number(totals.total) > draft.budget) {
      violations.push({
        code: "OVER_BUDGET",
        message: `Total $${totals.total} exceeds the $${draft.budget} budget.`,
        hint: "Remove stems or switch to cheaper components.",
      });
    }
    if (draft.committed && (!diff || diff.count === 0)) {
      violations.push({
        code: "NO_CHANGES",
        message: "This bouquet is already in the cart with no pending changes.",
        hint: "Edit it first, or create a new bouquet with bouquet_create.",
      });
    }
    return { ok: violations.length === 0, violations, totals };
  };

  const draftSummary = (draft, catalog) => {
    const validation = validateDraft(draft, catalog);
    const diff = diffOf(draft, catalog);
    return {
      bundle_id: draft.id,
      name: draft.name,
      occasion: draft.occasion,
      recipient: draft.recipient,
      budget: draft.budget,
      committed: draft.committed,
      items: Object.entries(draft.items).map(([variantId, quantity]) => {
        const entry = findEntry(catalog, variantId);
        return {
          variant_id: variantId,
          title: entry?.title ?? "(unknown)",
          quantity,
          unit_price: entry?.price ?? null,
          role: entry?.role ?? null,
          color: entry?.color ?? null,
          meaning: entry?.meaning ?? null,
        };
      }),
      wrap: draft.wrapVariantId
        ? {
            variant_id: draft.wrapVariantId,
            title: findEntry(catalog, draft.wrapVariantId)?.title,
          }
        : null,
      notes: draft.notes,
      totals: validation.totals,
      changes_since_cart: diff
        ? {
            count: diff.count,
            changes: diff.changes,
            wrap_changed: diff.wrapChanged,
            price_delta: diff.priceDelta.toFixed(2),
          }
        : null,
      validation: { ok: validation.ok, violations: validation.violations },
    };
  };

  const mutateItems = (draft, catalog, items, direction) => {
    const warnings = [];
    for (const item of items) {
      const quantity = Math.max(1, Math.floor(Number(item.qty ?? 1)));
      const entry = findEntry(catalog, item.variant_id);
      if (!entry) {
        warnings.push(
          `Unknown variant_id ${item.variant_id} — use bouquet_list_components.`,
        );
        continue;
      }
      const current = draft.items[item.variant_id] ?? 0;
      if (direction > 0) {
        const next = current + quantity;
        if (next > entry.available) {
          warnings.push(
            `Only ${entry.available} × ${entry.title} in stock; quantity capped.`,
          );
          draft.items[item.variant_id] = entry.available;
        } else {
          draft.items[item.variant_id] = next;
        }
      } else {
        const next = current - quantity;
        if (next > 0) draft.items[item.variant_id] = next;
        else delete draft.items[item.variant_id];
      }
    }
    notify();
    return warnings;
  };

  /**
   * Drop drafts that no longer match reality: committed bouquets that are not
   * in the cart any more (checked out, removed in the drawer, or left over
   * from an earlier session). Empty uncommitted drafts are pruned only on
   * page load so in-progress agent work is never deleted mid-conversation.
   */
  const reconcileWithCart = async ({ pruneEmpty = false } = {}) => {
    let cart;
    try {
      cart = await fetch("/cart.js").then((response) => response.json());
    } catch {
      return; // Can't reach the cart: leave state untouched.
    }
    const inCart = new Set();
    for (const item of cart.items ?? []) {
      const bundleId = item.properties?._bundle_id;
      if (bundleId) inCart.add(bundleId);
    }
    let changed = false;
    for (const draft of Object.values(state.drafts)) {
      const stale =
        (draft.committed && !inCart.has(draft.id)) ||
        (pruneEmpty &&
          !draft.committed &&
          Object.keys(draft.items).length === 0);
      if (stale) {
        delete state.drafts[draft.id];
        changed = true;
      }
    }
    if (state.activeBundleId && !state.drafts[state.activeBundleId]) {
      state.activeBundleId = Object.keys(state.drafts)[0] ?? null;
      changed = true;
    }
    if (changed) notify();
  };

  const revertDraft = (draft) => {
    if (!draft.committed || !draft.committedItems) return;
    draft.items = { ...draft.committedItems };
    draft.wrapVariantId = draft.committedWrapVariantId;
    notify();
  };

  // ----------------------------------------------------------------- commit
  const numericId = (gid) => Number(String(gid).split("/").pop());

  /** Find the merged parent line's Ajax key for this bundle, if it's in the cart. */
  const findParentLineKey = async (bundleId) => {
    const cart = await fetch("/cart.js").then((response) => response.json());
    const line = cart.items.find(
      (item) => item.properties?._bundle_id === bundleId,
    );
    return line?.key ?? null;
  };

  const componentLines = (draft, catalog) => [
    ...Object.entries(draft.items).map(([variantId, quantity]) => ({
      variantId,
      quantity,
    })),
    ...(draft.wrapVariantId
      ? [{ variantId: draft.wrapVariantId, quantity: 1 }]
      : []),
    ...catalog.fees.map((fee) => ({ variantId: fee.variantId, quantity: 1 })),
  ];

  const commitDraft = async (draft, catalog) => {
    // After a successful commit, navigate to the server-rendered cart page:
    // it is always correct regardless of theme drawer behavior, and "added
    // to cart → see the cart" is the natural shopping flow. Scheduled after
    // the tool result is returned.
    const goToCart = () => {
      console.info("[bouquet-composer] commit done — navigating to /cart");
      setTimeout(() => window.location.assign("/cart"), 800);
    };

    const attributeEntries = { _bundle_id: draft.id, _bundle_name: draft.name };
    if (draft.notes.card_message)
      attributeEntries._card_message = draft.notes.card_message;
    if (draft.notes.recipient_name)
      attributeEntries._recipient_name = draft.notes.recipient_name;
    const lines = componentLines(draft, catalog);
    const isUpdate = draft.committed;

    const markCommitted = () => {
      draft.committed = true;
      draft.committedItems = { ...draft.items };
      draft.committedWrapVariantId = draft.wrapVariantId;
      notify();
    };

    const hasActions =
      typeof window.Shopify?.actions?.updateCart === "function";
    console.info(
      "[bouquet-composer] commit path:",
      hasActions ? "Shopify.actions.updateCart" : "ajax fallback",
    );
    if (hasActions) {
      try {
      const linesInput = [];
      if (isUpdate) {
        // Replace the previous merged line. Prefer the stored CartLine id;
        // fall back to removing via the Ajax API using the hidden attribute.
        if (draft.cartLineId) {
          linesInput.push({ id: draft.cartLineId, quantity: 0 });
        } else {
          const key = await findParentLineKey(draft.id);
          if (key) {
            await fetch("/cart/change.js", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: key, quantity: 0 }),
            });
          }
        }
      }
      const attributes = Object.entries(attributeEntries).map(
        ([key, value]) => ({ key, value }),
      );
      linesInput.push(
        ...lines.map(({ variantId, quantity }) => ({
          merchandiseId: variantId,
          quantity,
          attributes,
        })),
      );
      const result = await window.Shopify.actions.updateCart({
        lines: linesInput,
      });
      if (result.userErrors?.length) {
        return { committed: false, errors: result.userErrors };
      }
      // Remember the merged parent line id for the next update, if visible.
      try {
        const parent = (result.cart?.lines ?? []).find((line) =>
          (line.attributes ?? []).some(
            (attribute) =>
              attribute.key === "_bundle_id" && attribute.value === draft.id,
          ),
        );
        draft.cartLineId = parent?.id ?? null;
      } catch {
        draft.cartLineId = null;
      }
      markCommitted();
      console.info("[bouquet-composer] commit ok via Shopify.actions", result.cart?.totalQuantity);
      goToCart();
      return {
        committed: true,
        updated_existing: isUpdate,
        bundle_id: draft.id,
        cart_total: result.cart?.cost?.totalAmount?.amount ?? null,
        ui_note: "The browser navigates to the cart page to show the bouquet.",
        next_steps: ["get_cart", "proceed_to_checkout"],
      };
      } catch (error) {
        // Actions API misbehaved: fall through to the Ajax path below.
        console.warn("[bouquet-composer] Shopify.actions.updateCart failed, falling back", error);
      }
    }

    // Fallback: Ajax Cart API (theme UI won't refresh on its own).
    if (isUpdate) {
      const key = await findParentLineKey(draft.id);
      if (key) {
        await fetch("/cart/change.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: key, quantity: 0 }),
        });
      }
    }
    const added = await fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map(({ variantId, quantity }) => ({
          id: numericId(variantId),
          quantity,
          properties: attributeEntries,
        })),
      }),
    });
    if (!added.ok) {
      return {
        committed: false,
        errors: [
          { message: `cart/add.js failed: ${added.status} ${await added.text()}` },
        ],
      };
    }
    markCommitted();
    goToCart();
    return {
      committed: true,
      updated_existing: isUpdate,
      bundle_id: draft.id,
      ui_note: "The browser navigates to the cart page to show the bouquet.",
      next_steps: ["get_cart", "proceed_to_checkout"],
    };
  };

  // ------------------------------------------------------------------ tools
  const controller = new AbortController();
  window.addEventListener("pagehide", () => controller.abort(), { once: true });

  const fail = (code, message, hint) => ({ error: { code, message, hint } });
  const needDraft = (bundleId) => {
    const draft = resolveDraft(bundleId);
    return (
      draft ??
      fail(
        "NO_SUCH_BOUQUET",
        bundleId
          ? `No bouquet with bundle_id ${bundleId}.`
          : "No bouquet is being composed yet.",
        "Call bouquet_create first, or bouquet_get_state to list bouquets.",
      )
    );
  };
  const isError = (value) =>
    value && typeof value === "object" && "error" in value;

  const registerTool = (definition) => {
    document.modelContext.registerTool(definition, {
      signal: controller.signal,
    });
  };

  const registerTools = () => {
    registerTool({
      name: "bouquet_get_rules",
      description:
        "Read the florist's composition rules for custom bouquets: slots " +
        "(focal/filler/greenery), stem limits, wrapping options, fees, default " +
        "budget and lead time. Call this before composing a bouquet.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const catalog = await getCatalog();
        return {
          rules: catalog.rules,
          currency: catalog.currency,
          wraps: catalog.wraps.map(({ variantId, title, price }) => ({
            variant_id: variantId,
            title,
            price,
          })),
          fees: catalog.fees.map(({ title, price }) => ({ title, price })),
          next_steps: ["bouquet_list_components", "bouquet_create"],
        };
      },
    });

    registerTool({
      name: "bouquet_list_components",
      description:
        "Browse the flowers available for custom bouquets today, with the " +
        "florist's knowledge: role (focal/filler/greenery), color, flower " +
        "meaning, suitable occasions (birthday, mothers-day, wedding, sympathy, " +
        "anniversary, get-well, housewarming) and pet safety. Use the filters " +
        "to advise the shopper — e.g. occasion=sympathy for a funeral.",
      inputSchema: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["focal", "filler", "greenery"] },
          color: {
            type: "string",
            description: "e.g. red, white, pink, yellow, purple, blue, orange, green",
          },
          occasion: {
            type: "string",
            enum: [
              "birthday",
              "mothers-day",
              "wedding",
              "sympathy",
              "anniversary",
              "get-well",
              "housewarming",
            ],
          },
          pet_safe: { type: "boolean", description: "true = only pet-safe flowers" },
          max_price: { type: "number", description: "max price per stem" },
          query: { type: "string", description: "free-text match on the flower name" },
          limit: { type: "number", description: "max results, default 20" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input = {}) => {
        const catalog = await getCatalog();
        let items = catalog.components;
        if (input.role) items = items.filter((item) => item.role === input.role);
        if (input.color)
          items = items.filter(
            (item) => item.color === String(input.color).toLowerCase(),
          );
        if (input.occasion)
          items = items.filter((item) => item.occasions.includes(input.occasion));
        if (input.pet_safe === true)
          items = items.filter((item) => item.petSafe === true);
        if (input.max_price != null)
          items = items.filter(
            (item) => Number(item.price) <= Number(input.max_price),
          );
        if (input.query) {
          const query = String(input.query).toLowerCase();
          items = items.filter((item) =>
            item.title.toLowerCase().includes(query),
          );
        }
        const limit = Math.min(Math.max(1, Math.floor(input.limit ?? 20)), 20);
        return {
          count: items.length,
          items: items.slice(0, limit).map((item) => ({
            variant_id: item.variantId,
            title: item.title,
            price: item.price,
            role: item.role,
            color: item.color,
            meaning: item.meaning,
            occasions: item.occasions,
            pet_safe: item.petSafe,
            available: item.available,
          })),
          next_steps: ["bouquet_create", "bouquet_add_items"],
        };
      },
    });

    registerTool({
      name: "bouquet_create",
      description:
        "Start composing a new custom bouquet (a product that doesn't exist " +
        "yet). Returns a bundle_id used by the other bouquet_* tools. Create " +
        "one bouquet per recipient; to modify an existing bouquet use " +
        "bouquet_add_items / bouquet_remove_items instead of creating another.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "display name, e.g. 'Warm Birthday Bouquet'",
          },
          budget: { type: "number", description: "budget in the store currency" },
          occasion: { type: "string" },
          recipient: { type: "string" },
        },
        additionalProperties: false,
      },
      execute: async (input = {}) => {
        const catalog = await getCatalog();
        const draft = createDraft(input);
        return {
          bundle_id: draft.id,
          summary: draftSummary(draft, catalog),
          next_steps: ["bouquet_add_items", "bouquet_set_wrap"],
        };
      },
    });

    registerTool({
      name: "bouquet_get_state",
      description:
        "Read all bouquets currently being composed, including edits the " +
        "shopper made by hand in the on-page composer panel, and each " +
        "bouquet's pending changes vs. the cart. Call this after the shopper " +
        "says they changed something, and before revising a bouquet.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const catalog = await getCatalog();
        const bouquets = Object.values(state.drafts).map((draft) =>
          draftSummary(draft, catalog),
        );
        return {
          active_bundle_id: state.activeBundleId,
          bouquets,
          next_steps: bouquets.length
            ? ["bouquet_add_items", "bouquet_validate", "bouquet_commit"]
            : ["bouquet_create"],
        };
      },
    });

    registerTool({
      name: "bouquet_add_items",
      description:
        "Add stems (or increase quantities) in a bouquet being composed. Use " +
        "this — not update_cart — while composing; the cart is only written " +
        "by bouquet_commit. variant_id values come from bouquet_list_components.",
      inputSchema: {
        type: "object",
        properties: {
          bundle_id: { type: "string", description: "defaults to the active bouquet" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                variant_id: { type: "string" },
                qty: { type: "number" },
              },
              required: ["variant_id"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
      execute: async ({ bundle_id, items } = {}) => {
        const catalog = await getCatalog();
        const draft = needDraft(bundle_id);
        if (isError(draft)) return draft;
        const warnings = mutateItems(draft, catalog, items ?? [], +1);
        return { warnings, summary: draftSummary(draft, catalog) };
      },
    });

    registerTool({
      name: "bouquet_remove_items",
      description:
        "Remove stems (or decrease quantities) from a bouquet being composed. " +
        "Omit qty to decrease by 1; the line disappears at 0.",
      inputSchema: {
        type: "object",
        properties: {
          bundle_id: { type: "string", description: "defaults to the active bouquet" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                variant_id: { type: "string" },
                qty: { type: "number" },
              },
              required: ["variant_id"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
      execute: async ({ bundle_id, items } = {}) => {
        const catalog = await getCatalog();
        const draft = needDraft(bundle_id);
        if (isError(draft)) return draft;
        const warnings = mutateItems(draft, catalog, items ?? [], -1);
        return { warnings, summary: draftSummary(draft, catalog) };
      },
    });

    registerTool({
      name: "bouquet_set_wrap",
      description:
        "Choose the wrapping for a bouquet. wrap_variant_id comes from " +
        "bouquet_get_rules; pass null to remove the wrap.",
      inputSchema: {
        type: "object",
        properties: {
          bundle_id: { type: "string", description: "defaults to the active bouquet" },
          wrap_variant_id: { type: ["string", "null"] },
        },
        required: ["wrap_variant_id"],
        additionalProperties: false,
      },
      execute: async ({ bundle_id, wrap_variant_id } = {}) => {
        const catalog = await getCatalog();
        const draft = needDraft(bundle_id);
        if (isError(draft)) return draft;
        if (
          wrap_variant_id != null &&
          !catalog.wraps.some((wrap) => wrap.variantId === wrap_variant_id)
        ) {
          return fail(
            "UNKNOWN_WRAP",
            `No wrapping option with variant_id ${wrap_variant_id}.`,
            "List valid options with bouquet_get_rules.",
          );
        }
        draft.wrapVariantId = wrap_variant_id;
        notify();
        return { summary: draftSummary(draft, catalog) };
      },
    });

    registerTool({
      name: "bouquet_set_note",
      description:
        "Set the card message or recipient name for a bouquet. Great for " +
        "co-writing a message based on the flowers' meanings.",
      inputSchema: {
        type: "object",
        properties: {
          bundle_id: { type: "string", description: "defaults to the active bouquet" },
          key: { type: "string", enum: ["card_message", "recipient_name"] },
          text: { type: "string", description: "max 120 characters" },
        },
        required: ["key", "text"],
        additionalProperties: false,
      },
      execute: async ({ bundle_id, key, text } = {}) => {
        const catalog = await getCatalog();
        const draft = needDraft(bundle_id);
        if (isError(draft)) return draft;
        draft.notes[key] = String(text).slice(0, 120);
        notify();
        return { summary: draftSummary(draft, catalog) };
      },
    });

    registerTool({
      name: "bouquet_validate",
      description:
        "Check a bouquet against the florist's rules (stem limits, inventory, " +
        "budget). Call before bouquet_commit and fix any violations.",
      inputSchema: {
        type: "object",
        properties: {
          bundle_id: { type: "string", description: "defaults to the active bouquet" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async ({ bundle_id } = {}) => {
        const catalog = await getCatalog();
        const draft = needDraft(bundle_id);
        if (isError(draft)) return draft;
        const validation = validateDraft(draft, catalog);
        return {
          ok: validation.ok,
          violations: validation.violations,
          totals: validation.totals,
          next_steps: validation.ok
            ? ["bouquet_commit"]
            : ["bouquet_add_items", "bouquet_remove_items"],
        };
      },
    });

    registerTool({
      name: "bouquet_commit",
      description:
        "Add a finished bouquet to the Shopify cart as one bundled line, or " +
        "apply pending edits to a bouquet that is already in the cart " +
        "(replaces its cart line). This is the only bouquet tool that writes " +
        "to the cart. Validates first. Afterwards use get_cart / " +
        "proceed_to_checkout.",
      inputSchema: {
        type: "object",
        properties: {
          bundle_id: { type: "string", description: "defaults to the active bouquet" },
        },
        additionalProperties: false,
      },
      execute: async ({ bundle_id } = {}) => {
        const catalog = await getCatalog();
        const draft = needDraft(bundle_id);
        if (isError(draft)) return draft;
        const validation = validateDraft(draft, catalog);
        if (!validation.ok) {
          return {
            committed: false,
            violations: validation.violations,
            hint: "Fix the violations, then call bouquet_commit again.",
          };
        }
        return commitDraft(draft, catalog);
      },
    });

    registerTool({
      name: "bouquet_discard",
      description:
        "Discard a bouquet that is being composed (does not touch the cart).",
      inputSchema: {
        type: "object",
        properties: {
          bundle_id: { type: "string", description: "defaults to the active bouquet" },
        },
        additionalProperties: false,
      },
      execute: async ({ bundle_id } = {}) => {
        const draft = needDraft(bundle_id);
        if (isError(draft)) return draft;
        delete state.drafts[draft.id];
        if (state.activeBundleId === draft.id) {
          state.activeBundleId = Object.keys(state.drafts)[0] ?? null;
        }
        notify();
        return { discarded: draft.id };
      },
    });

    console.info("[bouquet-composer] Registered 11 bouquet_* tools");
  };

  // --------------------------------------------------------------------- UI
  const formatMoney = (amount, currency) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
      }).format(Number(amount));
    } catch {
      return `$${Number(amount).toFixed(2)}`;
    }
  };
  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

  const buildPanel = (catalog) => {
    const root = document.createElement("div");
    root.id = "bouquet-composer-root";
    root.innerHTML = `
      <button type="button" class="bqc-toggle" aria-label="Bouquet composer">🌸<span class="bqc-badge" hidden></span></button>
      <div class="bqc-panel" hidden>
        <div class="bqc-head">
          <strong>Bouquet Composer</strong>
          <button type="button" class="bqc-close" aria-label="Close">×</button>
        </div>
        <div class="bqc-tabs"></div>
        <div class="bqc-body"></div>
      </div>`;
    document.body.appendChild(root);

    const panel = root.querySelector(".bqc-panel");
    const badge = root.querySelector(".bqc-badge");
    root.querySelector(".bqc-toggle").addEventListener("click", () => {
      panel.hidden = !panel.hidden;
    });
    root.querySelector(".bqc-close").addEventListener("click", () => {
      panel.hidden = true;
    });

    const tabs = root.querySelector(".bqc-tabs");
    const body = root.querySelector(".bqc-body");

    const render = () => {
      const drafts = Object.values(state.drafts);
      const pendingTotal = drafts.reduce(
        (sum, draft) => sum + (diffOf(draft, catalog)?.count ?? 0),
        0,
      );
      badge.hidden = pendingTotal === 0;
      badge.textContent = pendingTotal;

      tabs.innerHTML = "";
      for (const draft of drafts) {
        const diff = diffOf(draft, catalog);
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = `bqc-tab${draft.id === state.activeBundleId ? " active" : ""}`;
        tab.innerHTML =
          escapeHtml(draft.name) +
          (diff?.count
            ? ` <span class="bqc-tab-badge">${diff.count} change${diff.count > 1 ? "s" : ""}</span>`
            : draft.committed
              ? " ✓"
              : "");
        tab.addEventListener("click", () => {
          state.activeBundleId = draft.id;
          notify();
        });
        tabs.appendChild(tab);
      }

      const draft = resolveDraft(null);
      if (!draft) {
        body.innerHTML = `<p class="bqc-empty">No bouquet yet — ask your AI agent to compose one for you.</p>`;
        return;
      }

      const validation = validateDraft(draft, catalog);
      const totals = validation.totals;
      const diff = diffOf(draft, catalog);
      const snapshot = draft.committedItems ?? {};

      const rowIds = new Set([
        ...Object.keys(draft.items),
        ...Object.keys(snapshot),
      ]);
      const rows = [...rowIds]
        .map((variantId) => {
          const entry = findEntry(catalog, variantId);
          if (!entry) return "";
          const now = draft.items[variantId] ?? 0;
          const before = snapshot[variantId] ?? 0;
          const title = escapeHtml(entry.title);
          const meaning = entry.meaning
            ? `<span class="bqc-meaning">${escapeHtml(entry.meaning)}</span>`
            : "";

          if (now === 0 && before > 0) {
            // Ghost row: removed vs cart, restorable.
            return `<div class="bqc-row bqc-removed" data-variant="${variantId}">
              <div class="bqc-row-main">
                <span class="bqc-row-title bqc-strike">${title} × ${before}</span>
                <span class="bqc-diff-note bqc-red">Removed</span>
              </div>
              <button type="button" class="bqc-restore" data-op="restore">Restore</button>
              <span class="bqc-price bqc-strike-price">${formatMoney(Number(entry.price) * before, catalog.currency)}</span>
            </div>`;
          }
          if (now === 0) return "";

          let rowClass = "";
          let note = "";
          if (draft.committed) {
            if (before === 0) {
              rowClass = " bqc-added";
              note = `<span class="bqc-diff-note bqc-green">Added — not in cart yet</span>`;
            } else if (before !== now) {
              rowClass = " bqc-changed";
              note = `<span class="bqc-diff-note bqc-amber">${before} → ${now} in cart</span>`;
            }
          }
          return `<div class="bqc-row${rowClass}" data-variant="${variantId}">
            <div class="bqc-row-main">
              <span class="bqc-row-title">${title}</span>
              ${note || meaning}
            </div>
            <span class="bqc-qty">
              <button type="button" data-op="dec">−</button>
              <b>${now}</b>
              <button type="button" data-op="inc">+</button>
            </span>
            <span class="bqc-price">${formatMoney(Number(entry.price) * now, catalog.currency)}</span>
          </div>`;
        })
        .join("");

      const wrapOptions = [`<option value="">No wrap</option>`]
        .concat(
          catalog.wraps.map(
            (wrap) =>
              `<option value="${wrap.variantId}" ${draft.wrapVariantId === wrap.variantId ? "selected" : ""}>${escapeHtml(wrap.title)} (${formatMoney(wrap.price, catalog.currency)})</option>`,
          ),
        )
        .join("");

      const overBudget =
        draft.budget != null && Number(totals.total) > draft.budget;
      const budgetMeter = draft.budget
        ? `<div class="bqc-budget">
            <div class="bqc-budget-bar"><span style="width:${Math.min(100, (Number(totals.total) / draft.budget) * 100)}%" class="${overBudget ? "over" : ""}"></span></div>
            <small>${formatMoney(totals.total, catalog.currency)} / ${formatMoney(draft.budget, catalog.currency)} budget</small>
          </div>`
        : `<div class="bqc-budget"><small>Total ${formatMoney(totals.total, catalog.currency)}</small></div>`;

      let commitLabel;
      let commitDisabled = false;
      if (!draft.committed) {
        commitLabel = "Add bouquet to cart";
        commitDisabled = totals.stems === 0;
      } else if (diff?.count) {
        const delta = diff.priceDelta;
        const sign = delta >= 0 ? "+" : "−";
        commitLabel = `Update cart · ${sign}${formatMoney(Math.abs(delta), catalog.currency)}`;
        commitDisabled = totals.stems === 0;
      } else {
        commitLabel = "In cart ✓";
        commitDisabled = true;
      }

      const shownViolations = validation.violations.filter(
        (violation) => !["EMPTY", "NO_CHANGES"].includes(violation.code),
      );

      body.innerHTML = `
        <div class="bqc-rows">${rows || `<p class="bqc-empty">No stems yet.</p>`}</div>
        <div class="bqc-wrap-row">
          <span class="bqc-wrap-label">Wrap</span>
          <select class="bqc-wrap">${wrapOptions}</select>
        </div>
        ${draft.notes.card_message ? `<p class="bqc-note">💌 ${escapeHtml(draft.notes.card_message)}</p>` : ""}
        ${budgetMeter}
        ${
          shownViolations.length
            ? `<ul class="bqc-violations">${shownViolations
                .map((violation) => `<li>${escapeHtml(violation.message)}</li>`)
                .join("")}</ul>`
            : ""
        }
        <button type="button" class="bqc-commit" ${commitDisabled ? "disabled" : ""}>${commitLabel}</button>
        ${diff?.count ? `<button type="button" class="bqc-revert">Revert to cart state</button>` : ""}`;

      body.querySelectorAll(".bqc-row").forEach((row) => {
        const variantId = row.dataset.variant;
        row.querySelectorAll("button").forEach((button) => {
          button.addEventListener("click", () => {
            const op = button.dataset.op;
            if (op === "inc")
              mutateItems(draft, catalog, [{ variant_id: variantId, qty: 1 }], +1);
            if (op === "dec")
              mutateItems(draft, catalog, [{ variant_id: variantId, qty: 1 }], -1);
            if (op === "restore") {
              draft.items[variantId] = snapshot[variantId];
              notify();
            }
          });
        });
      });
      body.querySelector(".bqc-wrap")?.addEventListener("change", (event) => {
        draft.wrapVariantId = event.target.value || null;
        notify();
      });
      body.querySelector(".bqc-commit")?.addEventListener("click", async () => {
        const result = await commitDraft(draft, catalog);
        if (!result.committed) {
          console.warn("[bouquet-composer] commit failed", result);
        }
      });
      body.querySelector(".bqc-revert")?.addEventListener("click", () => {
        revertDraft(draft);
      });
    };

    listeners.add(render);
    render();
  };

  // ------------------------------------------------------------------- init
  if (typeof document.modelContext?.registerTool === "function") {
    registerTools();
  } else {
    console.info("[bouquet-composer] WebMCP not available; panel only.");
  }

  // Diagnostic: Actions API availability now and once the page settles
  // (its runtime loads asynchronously).
  console.info(
    "[bouquet-composer] Shopify.actions at init:",
    typeof window.Shopify?.actions?.updateCart,
  );
  window.addEventListener("load", () => {
    setTimeout(() => {
      console.info(
        "[bouquet-composer] Shopify.actions after load:",
        typeof window.Shopify?.actions?.updateCart,
      );
    }, 2000);
  });

  document.addEventListener(
    "shopify:cart:lines-update",
    (event) => {
      console.info("[bouquet-composer] shopify:cart:lines-update", event.action);
      // Cart changed (agent, drawer, another app): drop drafts whose cart
      // line disappeared so tabs always mirror reality.
      reconcileWithCart();
    },
    { signal: controller.signal },
  );

  const start = () =>
    Promise.all([getCatalog(), reconcileWithCart({ pruneEmpty: true })])
      .then(([catalog]) => buildPanel(catalog))
      .catch((error) =>
        console.warn("[bouquet-composer] catalog failed:", error),
      );
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
