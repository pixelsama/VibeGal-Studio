use super::{
    apply_schema_defaults, instruction_policies, instruction_types, schema, validate_schema,
    ContractSchemaKind,
};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const SHARED_CORPUS: &str =
    include_str!("../../../../../contracts/fixtures/validation-contract.json");
const DEFAULT_PROJECTION_CORPUS: &str =
    include_str!("../../../../../contracts/fixtures/default-projection-contract.json");

fn stable_issues(kind: ContractSchemaKind, input: &Value) -> Vec<(String, String, String, String)> {
    validate_schema(kind, input)
        .into_iter()
        .map(|issue| {
            (
                issue.code,
                match issue.severity {
                    super::super::model::GraphIssueSeverity::Error => "error",
                    super::super::model::GraphIssueSeverity::Warn => "warn",
                }
                .to_string(),
                issue.source,
                issue.json_path,
            )
        })
        .collect()
}

fn expected_issues(case: &Value) -> Vec<(String, String, String, String)> {
    case["issues"]
        .as_array()
        .expect("fixture issues array")
        .iter()
        .map(|issue| {
            (
                issue["code"]
                    .as_str()
                    .expect("fixture issue code")
                    .to_string(),
                issue["severity"]
                    .as_str()
                    .expect("fixture issue severity")
                    .to_string(),
                issue["source"]
                    .as_str()
                    .expect("fixture issue source")
                    .to_string(),
                issue["jsonPath"]
                    .as_str()
                    .expect("fixture issue jsonPath")
                    .to_string(),
            )
        })
        .collect()
}

#[test]
fn rust_contract_validator_matches_shared_structural_corpus() {
    let corpus: Value = serde_json::from_str(SHARED_CORPUS).expect("shared contract corpus");

    for case in corpus["nodeCases"].as_array().expect("node cases") {
        assert_eq!(
            stable_issues(ContractSchemaKind::NodeFile, &case["input"]),
            expected_issues(case),
            "shared corpus case {}",
            case["id"]
        );
    }

    for case in corpus["schemaCases"].as_array().expect("schema cases") {
        let kind = match case["schema"].as_str().expect("fixture schema") {
            "graph" => ContractSchemaKind::Graph,
            "manifest" => ContractSchemaKind::Manifest,
            "meta" => ContractSchemaKind::Meta,
            schema => panic!("unsupported shared corpus schema: {schema}"),
        };
        assert_eq!(
            stable_issues(kind, &case["input"]),
            expected_issues(case),
            "shared corpus case {}",
            case["id"]
        );
    }

    let limit = &corpus["limitCase"];
    let count = limit["count"].as_u64().expect("limit count") as usize;
    let retained = limit["retained"].as_u64().expect("retained count") as usize;
    let input = Value::Array((0..count).map(|_| json!({})).collect());
    let repeated = &limit["repeatedIssue"];
    let mut expected = (0..count)
        .map(|index| {
            (
                repeated["code"].as_str().unwrap().to_string(),
                repeated["severity"].as_str().unwrap().to_string(),
                repeated["source"].as_str().unwrap().to_string(),
                repeated["jsonPathTemplate"]
                    .as_str()
                    .unwrap()
                    .replace("{index}", &index.to_string()),
            )
        })
        .collect::<Vec<_>>();
    expected.sort_by(|left, right| (&left.3, &left.0).cmp(&(&right.3, &right.0)));
    expected.truncate(retained);
    expected.extend(expected_issues(&json!({
        "issues": [limit["truncationIssue"].clone()]
    })));
    expected.sort_by(|left, right| (&left.3, &left.0).cmp(&(&right.3, &right.0)));
    assert_eq!(
        stable_issues(ContractSchemaKind::NodeFile, &input),
        expected,
        "shared corpus case {}",
        limit["id"]
    );
}

#[test]
fn rust_default_projection_matches_contracts_corpus() {
    let corpus: Value =
        serde_json::from_str(DEFAULT_PROJECTION_CORPUS).expect("default projection corpus");
    for case in corpus["cases"].as_array().expect("default cases") {
        let kind = match case["schema"].as_str().expect("fixture schema") {
            "nodeFile" => ContractSchemaKind::NodeFile,
            "graph" => ContractSchemaKind::Graph,
            "manifest" => ContractSchemaKind::Manifest,
            "meta" => ContractSchemaKind::Meta,
            schema => panic!("unsupported default corpus schema: {schema}"),
        };
        let mut projected = case["input"].clone();
        assert!(
            validate_schema(kind, &projected).is_empty(),
            "default fixture {} must be structurally valid",
            case["id"]
        );
        apply_schema_defaults(&mut projected, schema(kind));
        assert_eq!(projected, case["expected"], "default case {}", case["id"]);
    }
}

#[test]
fn validation_does_not_mutate_raw_input() {
    let input = json!({
        "entryNodeId": "start",
        "nodes": [{ "id": "start", "file": "nodes/start.json" }]
    });
    let before = input.clone();

    assert!(validate_schema(ContractSchemaKind::Graph, &input).is_empty());
    assert_eq!(input, before);
}

#[test]
fn defaults_descend_into_arrays_records_and_selected_unions() {
    let contract = json!({
        "type": "object",
        "properties": {
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": { "enabled": { "type": "boolean", "default": true } }
                }
            },
            "registry": {
                "type": "object",
                "additionalProperties": {
                    "type": "object",
                    "properties": { "color": { "type": "string", "default": "#ffffff" } }
                }
            },
            "choice": {
                "anyOf": [
                    { "type": "string" },
                    {
                        "type": "object",
                        "properties": { "count": { "type": "integer", "default": 1 } }
                    }
                ]
            }
        }
    });
    let mut value = json!({
        "rows": [{}],
        "registry": { "hero": {} },
        "choice": {}
    });

    apply_schema_defaults(&mut value, &contract);

    assert_eq!(
        value,
        json!({
            "rows": [{ "enabled": true }],
            "registry": { "hero": { "color": "#ffffff" } },
            "choice": { "count": 1 }
        })
    );
}

#[test]
fn every_generated_instruction_has_well_formed_policy_metadata() {
    let generated_types = instruction_types().collect::<BTreeSet<_>>();
    assert!(!generated_types.is_empty());

    for instruction_type in generated_types {
        let metadata = instruction_policies(instruction_type)
            .unwrap_or_else(|| panic!("{instruction_type} is missing x-vibegal metadata"));
        assert!(
            metadata.is_object(),
            "{instruction_type} x-vibegal metadata must be an object"
        );
    }

    assert_eq!(
        schema(ContractSchemaKind::NodeFile)["items"]["oneOf"]
            .as_array()
            .expect("node branches")
            .len(),
        instruction_types().count(),
        "instruction tags must be unique and no branch may be silently dropped"
    );
}
