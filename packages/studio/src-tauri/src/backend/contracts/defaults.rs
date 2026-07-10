use serde_json::Value;

/// Apply JSON Schema object-property defaults to an in-memory clone only.
/// The caller owns the clone; raw disk JSON is never mutated or replaced.
pub(crate) fn apply_schema_defaults(value: &mut Value, schema: &Value) {
    for keyword in ["allOf", "oneOf", "anyOf"] {
        let Some(branches) = schema.get(keyword).and_then(Value::as_array) else {
            continue;
        };
        let matching = if keyword == "allOf" {
            branches.iter().collect::<Vec<_>>()
        } else {
            branches
                .iter()
                .find(|branch| schema_accepts(branch, value))
                .into_iter()
                .collect()
        };
        for branch in matching {
            apply_schema_defaults(value, branch);
        }
    }

    if value.is_object() {
        if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
            let object = value.as_object_mut().expect("checked object");
            for (name, property_schema) in properties {
                if !object.contains_key(name) {
                    if let Some(default) = property_schema.get("default") {
                        object.insert(name.clone(), default.clone());
                    }
                }
                if let Some(child) = object.get_mut(name) {
                    apply_schema_defaults(child, property_schema);
                }
            }
        }

        if let Some(additional) = schema
            .get("additionalProperties")
            .filter(|value| value.is_object())
        {
            let properties = schema.get("properties").and_then(Value::as_object);
            let object = value.as_object_mut().expect("checked object");
            for (name, child) in object {
                if !properties.is_some_and(|known| known.contains_key(name)) {
                    apply_schema_defaults(child, additional);
                }
            }
        }
    }

    if let (Some(items), Some(array)) = (schema.get("items"), value.as_array_mut()) {
        if let Some(tuple_items) = items.as_array() {
            for (child, item_schema) in array.iter_mut().zip(tuple_items) {
                apply_schema_defaults(child, item_schema);
            }
        } else {
            for child in array {
                apply_schema_defaults(child, items);
            }
        }
    }
}

fn schema_accepts(schema: &Value, value: &Value) -> bool {
    jsonschema::draft202012::options()
        .build(schema)
        .is_ok_and(|validator| validator.is_valid(value))
}
