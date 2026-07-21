use super::super::model::GraphIssueSeverity;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContractSchemaKind {
    NodeFile,
    Graph,
    Manifest,
    Meta,
    Variables,
}

impl ContractSchemaKind {
    pub(crate) fn filename(self) -> &'static str {
        match self {
            Self::NodeFile => "nodeFile.schema.json",
            Self::Graph => "graph.schema.json",
            Self::Manifest => "manifest.schema.json",
            Self::Meta => "meta.schema.json",
            Self::Variables => "variables.schema.json",
        }
    }

    fn raw(self) -> &'static str {
        match self {
            Self::NodeFile => include_str!("../../../generated/contracts/nodeFile.schema.json"),
            Self::Graph => include_str!("../../../generated/contracts/graph.schema.json"),
            Self::Manifest => include_str!("../../../generated/contracts/manifest.schema.json"),
            Self::Meta => include_str!("../../../generated/contracts/meta.schema.json"),
            Self::Variables => include_str!("../../../generated/contracts/variables.schema.json"),
        }
    }

    fn policy_name(self) -> &'static str {
        match self {
            Self::NodeFile => "nodeFile",
            Self::Graph => "graph",
            Self::Manifest => "manifest",
            Self::Meta => "meta",
            Self::Variables => "variables",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ContractDiagnostic {
    pub(crate) severity: GraphIssueSeverity,
    pub(crate) source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawContractMetadata {
    format_version: u32,
    diagnostics: HashMap<String, RawDiagnostic>,
    structural_policies: HashMap<String, StructuralPolicy>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawDiagnostic {
    severity: String,
    source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuralPolicy {
    default_code: String,
    #[serde(default)]
    root_type_code: Option<String>,
    #[serde(default)]
    path_overrides: Vec<StructuralPathOverride>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StructuralPathOverride {
    code: String,
    #[serde(default)]
    exact: Vec<String>,
    #[serde(default)]
    prefixes: Vec<String>,
}

#[derive(Debug)]
struct ContractMetadata {
    diagnostics: HashMap<String, ContractDiagnostic>,
    structural_policies: HashMap<String, StructuralPolicy>,
}

static NODE_SCHEMA: OnceLock<Value> = OnceLock::new();
static GRAPH_SCHEMA: OnceLock<Value> = OnceLock::new();
static MANIFEST_SCHEMA: OnceLock<Value> = OnceLock::new();
static META_SCHEMA: OnceLock<Value> = OnceLock::new();
static VARIABLES_SCHEMA: OnceLock<Value> = OnceLock::new();
static NODE_BRANCHES: OnceLock<HashMap<String, Value>> = OnceLock::new();
static CONTRACT_METADATA: OnceLock<ContractMetadata> = OnceLock::new();

pub(crate) fn schema(kind: ContractSchemaKind) -> &'static Value {
    let slot = match kind {
        ContractSchemaKind::NodeFile => &NODE_SCHEMA,
        ContractSchemaKind::Graph => &GRAPH_SCHEMA,
        ContractSchemaKind::Manifest => &MANIFEST_SCHEMA,
        ContractSchemaKind::Meta => &META_SCHEMA,
        ContractSchemaKind::Variables => &VARIABLES_SCHEMA,
    };
    slot.get_or_init(|| {
        serde_json::from_str(kind.raw())
            .unwrap_or_else(|error| panic!("embedded {} is invalid JSON: {error}", kind.filename()))
    })
}

pub(crate) fn instruction_branch(instruction_type: &str) -> Option<&'static Value> {
    instruction_branches().get(instruction_type)
}

pub(crate) fn instruction_types() -> impl Iterator<Item = &'static str> {
    instruction_branches().keys().map(String::as_str)
}

pub(crate) fn instruction_policies(instruction_type: &str) -> Option<&'static Value> {
    instruction_branch(instruction_type).and_then(|branch| branch.get("x-vibegal"))
}

pub(crate) fn diagnostic(code: &str) -> &'static ContractDiagnostic {
    contract_metadata()
        .diagnostics
        .get(code)
        .unwrap_or_else(|| panic!("embedded diagnostics do not define code {code}"))
}

pub(crate) fn structural_code(
    kind: ContractSchemaKind,
    value: &Value,
    json_path: &str,
) -> &'static str {
    let policy = contract_metadata()
        .structural_policies
        .get(kind.policy_name())
        .unwrap_or_else(|| panic!("missing structural policy for {}", kind.policy_name()));
    let root_has_wrong_type = match kind {
        ContractSchemaKind::NodeFile => !value.is_array(),
        _ => !value.is_object(),
    };
    if root_has_wrong_type {
        if let Some(code) = &policy.root_type_code {
            return code;
        }
    }
    for path_override in &policy.path_overrides {
        if path_override.exact.iter().any(|path| path == json_path)
            || path_override
                .prefixes
                .iter()
                .any(|prefix| json_path.starts_with(prefix))
        {
            return &path_override.code;
        }
    }
    &policy.default_code
}

fn instruction_branches() -> &'static HashMap<String, Value> {
    NODE_BRANCHES.get_or_init(|| {
        let branches = schema(ContractSchemaKind::NodeFile)
            .pointer("/items/oneOf")
            .and_then(Value::as_array)
            .unwrap_or_else(|| panic!("embedded node schema has no items.oneOf"));
        let mut result = HashMap::with_capacity(branches.len());
        for branch in branches {
            let instruction_type = branch
                .pointer("/properties/t/const")
                .and_then(Value::as_str)
                .unwrap_or_else(|| {
                    panic!("node schema branch is missing string properties.t.const")
                });
            let policy = branch
                .get("x-vibegal")
                .unwrap_or_else(|| panic!("instruction {instruction_type} is missing x-vibegal"));
            validate_instruction_policy(instruction_type, policy);
            assert!(
                result
                    .insert(instruction_type.to_string(), branch.clone())
                    .is_none(),
                "duplicate instruction discriminator in embedded schema: {instruction_type}"
            );
        }
        result
    })
}

fn contract_metadata() -> &'static ContractMetadata {
    CONTRACT_METADATA.get_or_init(|| {
        let raw: RawContractMetadata = serde_json::from_str(include_str!(
            "../../../generated/contracts/diagnostics.json"
        ))
        .unwrap_or_else(|error| panic!("embedded diagnostics.json is invalid: {error}"));
        assert_eq!(raw.format_version, 1, "unsupported diagnostics format");
        assert!(
            !raw.diagnostics.is_empty(),
            "embedded diagnostics registry is empty"
        );

        let diagnostics = raw
            .diagnostics
            .into_iter()
            .map(|(code, definition)| {
                let severity = match definition.severity.as_str() {
                    "error" => GraphIssueSeverity::Error,
                    "warn" => GraphIssueSeverity::Warn,
                    severity => panic!("diagnostic {code} has invalid severity {severity}"),
                };
                assert!(
                    matches!(
                        definition.source.as_str(),
                        "node" | "graph" | "manifest" | "meta" | "variables" | "contract"
                    ),
                    "diagnostic {code} has invalid source {}",
                    definition.source
                );
                (
                    code,
                    ContractDiagnostic {
                        severity,
                        source: definition.source,
                    },
                )
            })
            .collect::<HashMap<_, _>>();

        let expected_policies = ["nodeFile", "graph", "manifest", "meta", "variables"]
            .into_iter()
            .collect::<HashSet<_>>();
        assert_eq!(
            raw.structural_policies
                .keys()
                .map(String::as_str)
                .collect::<HashSet<_>>(),
            expected_policies,
            "embedded structural policy set must cover every product document"
        );
        for (name, policy) in &raw.structural_policies {
            assert_diagnostic_exists(&diagnostics, &policy.default_code, name);
            if let Some(code) = &policy.root_type_code {
                assert_diagnostic_exists(&diagnostics, code, name);
            }
            for path_override in &policy.path_overrides {
                assert_diagnostic_exists(&diagnostics, &path_override.code, name);
                assert!(
                    !path_override.exact.is_empty() || !path_override.prefixes.is_empty(),
                    "structural policy {name} has an empty path override"
                );
            }
        }

        ContractMetadata {
            diagnostics,
            structural_policies: raw.structural_policies,
        }
    })
}

fn assert_diagnostic_exists(
    diagnostics: &HashMap<String, ContractDiagnostic>,
    code: &str,
    owner: &str,
) {
    assert!(
        diagnostics.contains_key(code),
        "{owner} references undefined diagnostic code {code}"
    );
}

fn validate_instruction_policy(instruction_type: &str, policy: &Value) {
    let object = policy
        .as_object()
        .unwrap_or_else(|| panic!("instruction {instruction_type} x-vibegal must be an object"));
    if let Some(story_point) = object.get("storyPoint") {
        assert!(
            story_point.is_boolean(),
            "instruction {instruction_type} storyPoint must be boolean"
        );
    }
    let Some(references) = object.get("references") else {
        return;
    };
    let references = references
        .as_array()
        .unwrap_or_else(|| panic!("instruction {instruction_type} references must be an array"));
    for rule in references {
        let kind = required_string(rule, "kind", instruction_type);
        match kind {
            "registry" => {
                required_string(rule, "idField", instruction_type);
                required_string_array(rule, "registryPath", instruction_type);
                let code = required_string(rule, "missingCode", instruction_type);
                diagnostic(code);
            }
            "characterExpression" => {
                required_string(rule, "characterIdField", instruction_type);
                required_string(rule, "expressionField", instruction_type);
                required_string(rule, "defaultExpression", instruction_type);
            }
            "registryByDiscriminator" => {
                required_string(rule, "discriminatorField", instruction_type);
                required_string(rule, "idField", instruction_type);
                required_string_array(rule, "registryPath", instruction_type);
                let code = required_string(rule, "missingCode", instruction_type);
                diagnostic(code);
                let branches = rule
                    .get("registryByValue")
                    .and_then(Value::as_object)
                    .unwrap_or_else(|| {
                        panic!("instruction {instruction_type} registryByValue must be an object")
                    });
                assert!(
                    !branches.is_empty(),
                    "instruction {instruction_type} registryByValue cannot be empty"
                );
                for branch in branches.values() {
                    assert!(
                        branch
                            .as_array()
                            .is_some_and(|parts| parts.iter().all(Value::is_string)),
                        "instruction {instruction_type} registryByValue paths must be string arrays"
                    );
                }
            }
            "storyPoint" => {}
            kind => panic!("instruction {instruction_type} has unsupported policy rule {kind}"),
        }
    }
}

fn required_string<'a>(value: &'a Value, key: &str, owner: &str) -> &'a str {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("instruction {owner} policy field {key} must be a string"))
}

fn required_string_array(value: &Value, key: &str, owner: &str) {
    assert!(
        value
            .get(key)
            .and_then(Value::as_array)
            .is_some_and(|parts| parts.iter().all(Value::is_string)),
        "instruction {owner} policy field {key} must be a string array"
    );
}
