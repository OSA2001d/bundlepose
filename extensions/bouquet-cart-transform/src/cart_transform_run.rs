use super::schema;
use serde::Deserialize;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::BTreeMap;

/// Function config stored on the CartTransform object:
/// `{ "templates": { "bouquet": "gid://shopify/ProductVariant/..." } }`
/// For now every bundle maps to the "bouquet" template's parent variant.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    templates: BTreeMap<String, String>,
}

const DEFAULT_TEMPLATE: &str = "bouquet";
const DEFAULT_TITLE: &str = "Custom Bouquet";

#[shopify_function]
fn cart_transform_run(
    input: schema::cart_transform_run::CartTransformRunInput,
) -> Result<schema::CartTransformRunResult> {
    let no_changes = schema::CartTransformRunResult { operations: vec![] };

    // Missing/invalid config must never break checkout: no-op instead.
    let Some(config) = input
        .cart_transform()
        .config()
        .and_then(|metafield| serde_json::from_str::<Config>(metafield.value()).ok())
    else {
        return Ok(no_changes);
    };
    let Some(parent_variant_id) = config.templates.get(DEFAULT_TEMPLATE) else {
        return Ok(no_changes);
    };

    // Group lines that carry a `_bundle_id` line property. BTreeMap keeps the
    // operation order deterministic for tests and repeated runs.
    use schema::cart_transform_run::cart_transform_run_input::cart::Lines;
    let mut bundles: BTreeMap<String, Vec<&Lines>> = BTreeMap::new();
    for line in input.cart().lines() {
        let Some(bundle_id) = line
            .bundle_id()
            .and_then(|attribute| attribute.value())
            .filter(|value| !value.trim().is_empty())
        else {
            continue; // Regular line: leave untouched.
        };
        bundles.entry(bundle_id.clone()).or_default().push(line);
    }

    let operations = bundles
        .into_iter()
        .map(|(bundle_id, lines)| {
            let title = lines
                .iter()
                .find_map(|line| line.bundle_name().and_then(|attribute| attribute.value()))
                .filter(|value| !value.trim().is_empty())
                .cloned()
                .unwrap_or_else(|| DEFAULT_TITLE.to_string());

            let card_message = lines
                .iter()
                .find_map(|line| line.card_message().and_then(|attribute| attribute.value()))
                .filter(|value| !value.trim().is_empty())
                .cloned();

            let cart_lines = lines
                .iter()
                .map(|line| schema::CartLineInput {
                    cart_line_id: line.id().clone(),
                    quantity: *line.quantity(),
                })
                .collect();

            schema::Operation::LinesMerge(schema::LinesMergeOperation {
                cart_lines,
                parent_variant_id: parent_variant_id.clone().into(),
                title: Some(title.clone()),
                // No price adjustment: the bundle price is the components' sum.
                price: None,
                image: None,
                // Visible line properties: themes that show the parent product's
                // title (e.g. cart drawers) still display the bouquet's name,
                // and the card message survives into the order.
                // The hidden `_bundle_id` lets the composer find this merged
                // line again (to update or replace a committed bouquet).
                attributes: Some({
                    let mut attributes = vec![
                        schema::AttributeOutput {
                            key: "_bundle_id".to_string(),
                            value: bundle_id,
                        },
                        schema::AttributeOutput {
                            key: "Bouquet".to_string(),
                            value: title,
                        },
                    ];
                    if let Some(message) = card_message {
                        attributes.push(schema::AttributeOutput {
                            key: "Card message".to_string(),
                            value: message,
                        });
                    }
                    attributes
                }),
            })
        })
        .collect();

    Ok(schema::CartTransformRunResult { operations })
}
