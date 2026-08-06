use serde_json::Value;

/// Apply JSON Schema object-property defaults to an in-memory clone only.
/// The caller owns the clone; raw disk JSON is never mutated or replaced.
pub(crate) fn apply_schema_defaults(value: &mut Value, schema: &Value) {
    apply_schema_defaults_inner(value, schema, schema);
    normalize_locale_tags(value);
}

/// Spec 35：choice/if 内嵌 Instruction[] 使节点 schema 成为自递归类型，
/// items 与嵌套字段通过 "$ref": "#/$defs/<key>" 引用联合。apply 时需要根 schema
/// 来解引用 $ref，所以内部函数多带一个 `root` 参数。
fn apply_schema_defaults_inner(value: &mut Value, schema: &Value, root: &Value) {
    // 解引用 $ref 到根 $defs，拿到真正的子 schema 后再继续。
    let schema = resolve_ref(schema, root);

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
            apply_schema_defaults_inner(value, branch, root);
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
                    apply_schema_defaults_inner(child, property_schema, root);
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
                    apply_schema_defaults_inner(child, additional, root);
                }
            }
        }
    }

    if let (Some(items), Some(array)) = (schema.get("items"), value.as_array_mut()) {
        if let Some(tuple_items) = items.as_array() {
            for (child, item_schema) in array.iter_mut().zip(tuple_items) {
                apply_schema_defaults_inner(child, item_schema, root);
            }
        } else {
            for child in array {
                apply_schema_defaults_inner(child, items, root);
            }
        }
    }
}

/// 把 "$ref": "#/$defs/<key>" 形态的 schema 解引用到根 $defs 里的目标；
/// 非 $ref 或解析失败时原样返回。
fn resolve_ref<'a>(schema: &'a Value, root: &'a Value) -> &'a Value {
    let Some(ref_path) = schema.get("$ref").and_then(Value::as_str) else {
        return schema;
    };
    // 仅支持本地指针 "#/$defs/<...>"。
    let Some(suffix) = ref_path.strip_prefix("#/") else {
        return schema;
    };
    let mut current = root;
    for segment in suffix.split('/') {
        let next = current.get(segment).unwrap_or(schema);
        current = next;
    }
    current
}

fn normalize_locale_tags(value: &mut Value) {
    let Some(locale) = value.get_mut("locale").and_then(Value::as_object_mut) else {
        return;
    };
    if let Some(default) = locale.get("default").and_then(Value::as_str) {
        if let Some(normalized) = canonicalize_locale_tag(default) {
            locale.insert("default".to_string(), Value::String(normalized));
        }
    }
    if let Some(available) = locale.get_mut("available").and_then(Value::as_array_mut) {
        for tag in available {
            if let Some(normalized) = tag.as_str().and_then(canonicalize_locale_tag) {
                *tag = Value::String(normalized);
            }
        }
    }
}

pub(crate) fn canonicalize_locale_tag(tag: &str) -> Option<String> {
    let parts = tag.split('-').collect::<Vec<_>>();
    if parts.is_empty()
        || !(2..=8).contains(&parts[0].len())
        || !parts[0].bytes().all(|byte| byte.is_ascii_alphabetic())
        || parts.iter().skip(1).any(|part| {
            part.is_empty()
                || part.len() > 8
                || !part.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
    {
        return None;
    }
    Some(parts.into_iter()
        .enumerate()
        .map(|(index, part)| {
            if index == 0 {
                return part.to_ascii_lowercase();
            }
            if part.len() == 4 && part.bytes().all(|byte| byte.is_ascii_alphabetic()) {
                let mut chars = part.chars();
                return chars
                    .next()
                    .map(|first| {
                        format!(
                            "{}{}",
                            first.to_ascii_uppercase(),
                            chars.as_str().to_ascii_lowercase()
                        )
                    })
                    .unwrap_or_default();
            }
            if (part.len() == 2 && part.bytes().all(|byte| byte.is_ascii_alphabetic()))
                || (part.len() == 3 && part.bytes().all(|byte| byte.is_ascii_digit()))
            {
                return part.to_ascii_uppercase();
            }
            part.to_ascii_lowercase()
        })
        .collect::<Vec<_>>()
        .join("-"))
}

fn schema_accepts(schema: &Value, value: &Value) -> bool {
    jsonschema::draft202012::options()
        .build(schema)
        .is_ok_and(|validator| validator.is_valid(value))
}
