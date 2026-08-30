/**
 * Demo catalog for the bouquet composer.
 *
 * Famous English-named flowers so judges can read the store at a glance.
 * Peony is intentionally absent: it powers the `bouquet_request_component`
 * (demand signal) demo later. Sunflower is intentionally scarce to demo
 * inventory warnings.
 */

export type CatalogRole = "focal" | "filler" | "greenery";

export interface CatalogItem {
  title: string;
  price: string;
  tags: string[];
  inventory: number | null; // null = do not track
  metafields?: {
    role: CatalogRole;
    color: string;
    meaning: string;
    occasions: string; // comma-separated: birthday, mothers-day, wedding, sympathy, anniversary, get-well, housewarming
    pet_safe: "true" | "false";
  };
}

export const COMPOSER_NAMESPACE = "composer";

export const STEMS: CatalogItem[] = [
  { title: "Red Rose", price: "4.50", tags: ["component", "stem"], inventory: 500000, metafields: { role: "focal", color: "red", meaning: "Love and passion", occasions: "birthday, anniversary, mothers-day", pet_safe: "true" } },
  { title: "White Rose", price: "4.50", tags: ["component", "stem"], inventory: 500000, metafields: { role: "focal", color: "white", meaning: "Purity and new beginnings", occasions: "wedding, sympathy, anniversary", pet_safe: "true" } },
  { title: "Sunflower", price: "3.50", tags: ["component", "stem"], inventory: 500000, metafields: { role: "focal", color: "yellow", meaning: "Adoration and loyalty", occasions: "birthday, get-well, housewarming", pet_safe: "true" } },
  { title: "Pink Tulip", price: "3.00", tags: ["component", "stem"], inventory: 500000, metafields: { role: "focal", color: "pink", meaning: "Caring and affection", occasions: "birthday, mothers-day, housewarming", pet_safe: "false" } },
  { title: "White Lily", price: "5.00", tags: ["component", "stem"], inventory: 500000, metafields: { role: "focal", color: "white", meaning: "Majesty", occasions: "sympathy, wedding", pet_safe: "false" } },
  { title: "Orange Gerbera Daisy", price: "3.00", tags: ["component", "stem"], inventory: 500000, metafields: { role: "focal", color: "orange", meaning: "Cheerfulness", occasions: "birthday, get-well, housewarming", pet_safe: "true" } },
  { title: "Pink Carnation", price: "2.50", tags: ["component", "stem"], inventory: 500000, metafields: { role: "focal", color: "pink", meaning: "Gratitude", occasions: "mothers-day, birthday", pet_safe: "false" } },
  { title: "Blue Hydrangea", price: "6.00", tags: ["component", "stem"], inventory: 500000, metafields: { role: "focal", color: "blue", meaning: "Heartfelt emotion", occasions: "housewarming, anniversary", pet_safe: "false" } },
  { title: "Baby's Breath", price: "2.00", tags: ["component", "stem"], inventory: 500000, metafields: { role: "filler", color: "white", meaning: "Everlasting love", occasions: "wedding, birthday, mothers-day", pet_safe: "false" } },
  { title: "Waxflower", price: "2.50", tags: ["component", "stem"], inventory: 500000, metafields: { role: "filler", color: "pink", meaning: "Lasting happiness", occasions: "wedding, birthday", pet_safe: "true" } },
  { title: "English Lavender", price: "2.50", tags: ["component", "stem"], inventory: 500000, metafields: { role: "filler", color: "purple", meaning: "Serenity", occasions: "get-well, housewarming", pet_safe: "false" } },
  { title: "Eucalyptus", price: "2.00", tags: ["component", "stem"], inventory: 500000, metafields: { role: "greenery", color: "green", meaning: "Protection", occasions: "wedding, sympathy", pet_safe: "false" } },
  { title: "Italian Ruscus", price: "1.80", tags: ["component", "stem"], inventory: 500000, metafields: { role: "greenery", color: "green", meaning: "Thoughtfulness", occasions: "wedding, sympathy", pet_safe: "true" } },
  { title: "Leather Fern", price: "1.50", tags: ["component", "stem"], inventory: 500000, metafields: { role: "greenery", color: "green", meaning: "Sincerity", occasions: "birthday, housewarming", pet_safe: "true" } },
];

export const EXTRAS: CatalogItem[] = [
  { title: "Kraft Paper Wrap", price: "2.00", tags: ["component", "wrap"], inventory: 500000 },
  { title: "Satin Ribbon Wrap", price: "5.00", tags: ["component", "wrap"], inventory: 500000 },
  { title: "Arrangement Fee", price: "8.00", tags: ["component", "fee"], inventory: 500000 },
];

/** Merge parent. Price 0: the merged line's price is the components' sum. */
export const PARENT: CatalogItem = {
  title: "Custom Bouquet",
  price: "0.00",
  tags: ["bouquet-parent"],
  inventory: null,
};

/**
 * Regular, non-customizable shop merchandise. Listed normally (ACTIVE) so the
 * storefront looks like a real florist rather than an empty shell.
 */
export const REGULAR: CatalogItem[] = [
  { title: "Glass Bud Vase", price: "12.00", tags: ["merch"], inventory: 500000 },
  { title: "Potted White Orchid", price: "34.50", tags: ["merch"], inventory: 500000 },
  { title: "Dried Flower Wreath", price: "28.00", tags: ["merch"], inventory: 500000 },
  { title: "Scented Soy Candle — Fresh Peony", price: "18.00", tags: ["merch"], inventory: 500000 },
];

export const ALL_ITEMS: CatalogItem[] = [...STEMS, ...EXTRAS, PARENT, ...REGULAR];
