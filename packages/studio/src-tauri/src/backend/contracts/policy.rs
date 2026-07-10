use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub(crate) struct NodeSemanticIssue {
    pub(crate) severity: super::super::model::GraphIssueSeverity,
    pub(crate) source: String,
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) json_path: String,
}

pub(crate) fn validate_node_semantics(node: &Value, manifest: &Value) -> Vec<NodeSemanticIssue> {
    let Some(instructions) = node.as_array() else {
        return vec![];
    };
    let mut issues = Vec::new();
    let mut first_story_point = HashMap::<String, usize>::new();
    for (index, instruction) in instructions.iter().enumerate() {
        let Some(instruction_type) = instruction.get("t").and_then(Value::as_str) else {
            continue;
        };
        let Some(metadata) = super::instruction_policies(instruction_type) else {
            continue;
        };
        if metadata.get("storyPoint").and_then(Value::as_bool) == Some(true) {
            let instruction_id = instruction
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty());
            match instruction_id {
                None => issues.push(issue(
                    "instruction_id_missing",
                    "停点指令缺少稳定 id",
                    format!("$[{index}].id"),
                )),
                Some(id) if first_story_point.contains_key(id) => issues.push(issue(
                    "instruction_id_duplicate",
                    &format!("同一节点内重复的停点 instruction id: \"{id}\""),
                    format!("$[{index}].id"),
                )),
                Some(id) => {
                    first_story_point.insert(id.to_string(), index);
                }
            }
        }
        for rule in metadata
            .get("references")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            match rule.get("kind").and_then(Value::as_str) {
                Some("registry") => {
                    execute_registry_rule(&mut issues, instruction, manifest, rule, index)
                }
                Some("characterExpression") => execute_character_expression_rule(
                    &mut issues,
                    instruction,
                    manifest,
                    rule,
                    index,
                ),
                Some("registryByDiscriminator") => execute_discriminated_registry_rule(
                    &mut issues,
                    instruction,
                    manifest,
                    rule,
                    index,
                ),
                Some("storyPoint") => {}
                Some(kind) => panic!("unsupported embedded contracts policy rule: {kind}"),
                None => panic!("embedded contracts policy rule is missing kind"),
            }
        }
    }
    issues
}

fn execute_registry_rule(
    issues: &mut Vec<NodeSemanticIssue>,
    instruction: &Value,
    manifest: &Value,
    rule: &Value,
    index: usize,
) {
    let id_field = rule["idField"]
        .as_str()
        .expect("validated registry idField");
    let Some(id) = instruction.get(id_field).and_then(Value::as_str) else {
        return;
    };
    let registry_path = rule["registryPath"]
        .as_array()
        .expect("validated registryPath");
    let registry = value_at(manifest, registry_path);
    if !registry
        .and_then(Value::as_object)
        .is_some_and(|table| table.contains_key(id))
    {
        let code = rule["missingCode"].as_str().expect("validated missingCode");
        issues.push(issue(
            code,
            &format!("引用了不存在的资源 id: \"{id}\""),
            format!("$[{index}].{id_field}"),
        ));
    }
}

fn execute_character_expression_rule(
    issues: &mut Vec<NodeSemanticIssue>,
    instruction: &Value,
    manifest: &Value,
    rule: &Value,
    index: usize,
) {
    let character_field = rule["characterIdField"]
        .as_str()
        .expect("validated characterIdField");
    let expression_field = rule["expressionField"]
        .as_str()
        .expect("validated expressionField");
    let Some(character_id) = instruction.get(character_field).and_then(Value::as_str) else {
        return;
    };
    let Some(characters) = manifest.get("characters").and_then(Value::as_object) else {
        return;
    };
    let Some(character) = characters.get(character_id).and_then(Value::as_object) else {
        issues.push(issue(
            "missing_character_ref",
            &format!("引用了不存在的 character id: \"{character_id}\""),
            format!("$[{index}].{character_field}"),
        ));
        return;
    };
    let expression = instruction
        .get(expression_field)
        .and_then(Value::as_str)
        .or_else(|| rule["defaultExpression"].as_str())
        .expect("validated defaultExpression");
    if !character
        .get("sprites")
        .and_then(Value::as_object)
        .is_some_and(|sprites| sprites.contains_key(expression))
    {
        issues.push(issue(
            "missing_character_expr",
            &format!("角色 \"{character_id}\" 没有表情 \"{expression}\""),
            format!("$[{index}].{expression_field}"),
        ));
    }
}

fn execute_discriminated_registry_rule(
    issues: &mut Vec<NodeSemanticIssue>,
    instruction: &Value,
    manifest: &Value,
    rule: &Value,
    index: usize,
) {
    let discriminator_field = rule["discriminatorField"]
        .as_str()
        .expect("validated discriminatorField");
    let id_field = rule["idField"].as_str().expect("validated idField");
    let Some(discriminator) = instruction.get(discriminator_field).and_then(Value::as_str) else {
        return;
    };
    let Some(id) = instruction.get(id_field).and_then(Value::as_str) else {
        return;
    };
    let registry_path = rule["registryPath"]
        .as_array()
        .expect("validated registryPath");
    let branch = rule["registryByValue"]
        .get(discriminator)
        .and_then(Value::as_array)
        .expect("validated registryByValue must cover the instruction discriminator");
    let mut path = registry_path.clone();
    path.extend(branch.iter().cloned());
    if !value_at(manifest, &path)
        .and_then(Value::as_object)
        .is_some_and(|table| table.contains_key(id))
    {
        let code = rule["missingCode"].as_str().expect("validated missingCode");
        issues.push(issue(
            code,
            &format!("引用了不存在的 unlock id: \"{id}\""),
            format!("$[{index}].{id_field}"),
        ));
    }
}

fn value_at<'a>(mut value: &'a Value, path: &[Value]) -> Option<&'a Value> {
    for part in path {
        value = value.get(part.as_str()?)?;
    }
    Some(value)
}
fn issue(code: &str, message: &str, json_path: String) -> NodeSemanticIssue {
    let definition = super::diagnostic(code);
    NodeSemanticIssue {
        severity: definition.severity,
        source: definition.source.clone(),
        code: code.to_string(),
        message: message.to_string(),
        json_path,
    }
}
