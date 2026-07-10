use super::super::model::GraphIssueSeverity;
use super::embedded::{diagnostic, instruction_branch, schema, structural_code};
use jsonschema::error::{ValidationError, ValidationErrorKind};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;

pub(crate) use super::embedded::ContractSchemaKind;

const MAX_CONTRACT_VIOLATIONS: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ContractViolation {
    pub(crate) severity: GraphIssueSeverity,
    pub(crate) source: String,
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) json_path: String,
    pub(crate) keyword: String,
}

static NODE_VALIDATORS: OnceLock<std::collections::HashMap<String, jsonschema::Validator>> =
    OnceLock::new();
static GRAPH_VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
static MANIFEST_VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
static META_VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();

pub(crate) fn validate_schema(kind: ContractSchemaKind, value: &Value) -> Vec<ContractViolation> {
    if kind == ContractSchemaKind::NodeFile {
        return validate_node_file(value);
    }
    truncate_sort(normalize_errors(
        kind,
        value,
        validator(kind).iter_errors(value),
        None,
    ))
}

fn validate_node_file(value: &Value) -> Vec<ContractViolation> {
    let Some(instructions) = value.as_array() else {
        return vec![violation(
            structural_code(ContractSchemaKind::NodeFile, value, "$"),
            "节点内容必须是 Instruction[] 数组".to_string(),
            "$".to_string(),
            "type".to_string(),
        )];
    };

    let validators = node_validators();
    let mut violations = Vec::new();
    for (index, instruction) in instructions.iter().enumerate() {
        let path = format!("$[{index}]");
        let Some(object) = instruction.as_object() else {
            violations.push(violation(
                "instruction_invalid_field",
                "指令必须是 JSON 对象".to_string(),
                path,
                "type".to_string(),
            ));
            continue;
        };
        let instruction_type = object.get("t").and_then(Value::as_str);
        let Some(instruction_type) = instruction_type else {
            violations.push(unknown_instruction(None, format!("{path}.t")));
            continue;
        };
        let Some(validator) = validators.get(instruction_type) else {
            violations.push(unknown_instruction(
                Some(instruction_type),
                format!("{path}.t"),
            ));
            continue;
        };
        violations.extend(
            normalize_errors(
                ContractSchemaKind::NodeFile,
                instruction,
                validator.iter_errors(instruction),
                Some("instruction_invalid_field"),
            )
            .into_iter()
            .map(|mut violation| {
                violation.json_path = prefix_path(index, &violation.json_path);
                violation
            }),
        );
    }
    truncate_sort(violations)
}

fn unknown_instruction(instruction_type: Option<&str>, json_path: String) -> ContractViolation {
    let deprecated_choice = instruction_type == Some("choice");
    let code = if deprecated_choice {
        "choice_instruction_not_supported"
    } else {
        "instruction_unknown_type"
    };
    violation(
        code,
        if deprecated_choice {
            "choice 指令已废弃且不受支持"
        } else {
            "指令缺少或使用了不受支持的 t 类型"
        }
        .to_string(),
        json_path,
        "const".to_string(),
    )
}

fn validator(kind: ContractSchemaKind) -> &'static jsonschema::Validator {
    let slot = match kind {
        ContractSchemaKind::NodeFile => unreachable!("node files dispatch by discriminator"),
        ContractSchemaKind::Graph => &GRAPH_VALIDATOR,
        ContractSchemaKind::Manifest => &MANIFEST_VALIDATOR,
        ContractSchemaKind::Meta => &META_VALIDATOR,
    };
    slot.get_or_init(|| compile(schema(kind)))
}

fn node_validators() -> &'static std::collections::HashMap<String, jsonschema::Validator> {
    NODE_VALIDATORS.get_or_init(|| {
        super::instruction_types()
            .map(|instruction_type| {
                let branch = instruction_branch(instruction_type)
                    .expect("instruction type was collected from its branch");
                (instruction_type.to_string(), compile(branch))
            })
            .collect()
    })
}

fn compile(schema: &Value) -> jsonschema::Validator {
    jsonschema::draft202012::options()
        .build(schema)
        .unwrap_or_else(|error| panic!("embedded product contract failed to compile: {error}"))
}

fn normalize_errors<'a>(
    kind: ContractSchemaKind,
    root_value: &Value,
    errors: impl Iterator<Item = ValidationError<'a>>,
    fixed_code: Option<&str>,
) -> Vec<ContractViolation> {
    let mut unique = HashSet::new();
    let mut violations = Vec::new();
    for error in errors {
        collect_error_leaves(
            kind,
            root_value,
            &error,
            fixed_code,
            &mut unique,
            &mut violations,
        );
    }
    sort_violations(&mut violations);
    violations
}

fn collect_error_leaves(
    kind: ContractSchemaKind,
    root_value: &Value,
    error: &ValidationError<'_>,
    fixed_code: Option<&str>,
    unique: &mut HashSet<(String, String, String)>,
    violations: &mut Vec<ContractViolation>,
) {
    let context = match &error.kind {
        ValidationErrorKind::AnyOf { context } | ValidationErrorKind::OneOfNotValid { context } => {
            Some(context)
        }
        _ => None,
    };
    if let Some(context) = context {
        let mut candidates = Vec::new();
        for branch in context {
            let mut branch_unique = HashSet::new();
            let mut branch_violations = Vec::new();
            for child in branch {
                collect_error_leaves(
                    kind,
                    root_value,
                    child,
                    fixed_code,
                    &mut branch_unique,
                    &mut branch_violations,
                );
            }
            if !branch_violations.is_empty() {
                candidates.push(branch_violations);
            }
        }
        candidates.sort_by_key(|candidate| union_branch_score(candidate));
        if let Some(best_branch) = candidates.into_iter().next() {
            for violation in best_branch {
                let key = (
                    violation.json_path.clone(),
                    violation.code.clone(),
                    violation.keyword.clone(),
                );
                if unique.insert(key) {
                    violations.push(violation);
                }
            }
            return;
        }
    }

    let mut json_path = pointer_to_json_path(root_value, &error.instance_path.to_string());
    if let ValidationErrorKind::Required { property } = &error.kind {
        if let Some(property) = property.as_str() {
            json_path = append_json_path_property(&json_path, property);
        }
    }
    let keyword = error
        .schema_path
        .to_string()
        .rsplit('/')
        .next()
        .filter(|part| !part.is_empty() && part.parse::<usize>().is_err())
        .unwrap_or("validation")
        .to_string();
    let code = fixed_code.unwrap_or_else(|| structural_code(kind, root_value, &json_path));
    let key = (json_path.clone(), code.to_string(), keyword.clone());
    if unique.insert(key) {
        violations.push(violation(
            code,
            stable_message(&keyword),
            json_path,
            keyword,
        ));
    }
}

fn union_branch_score(violations: &[ContractViolation]) -> isize {
    let path_specificity = violations
        .iter()
        .map(|violation| violation.json_path.len() as isize)
        .sum::<isize>();
    violations.len() as isize * 10_000 - path_specificity
}

fn violation(code: &str, message: String, json_path: String, keyword: String) -> ContractViolation {
    let definition = diagnostic(code);
    ContractViolation {
        severity: definition.severity,
        source: definition.source.clone(),
        code: code.to_string(),
        message,
        json_path,
        keyword,
    }
}

fn stable_message(keyword: &str) -> String {
    match keyword {
        "required" => "缺少必填字段".to_string(),
        "type" => "字段类型不符合内容契约".to_string(),
        "enum" | "const" => "字段值不符合内容契约".to_string(),
        "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum" | "minLength"
        | "maxLength" => "字段超出内容契约范围".to_string(),
        "additionalProperties" => "对象包含不允许的字段".to_string(),
        _ => "内容不符合产品契约".to_string(),
    }
}

fn truncate_sort(mut violations: Vec<ContractViolation>) -> Vec<ContractViolation> {
    sort_violations(&mut violations);
    if violations.len() > MAX_CONTRACT_VIOLATIONS {
        violations.truncate(MAX_CONTRACT_VIOLATIONS);
        violations.push(violation(
            "contract_error_truncated",
            format!("结构错误超过 {MAX_CONTRACT_VIOLATIONS} 条，剩余错误已截断"),
            "$".to_string(),
            "limit".to_string(),
        ));
        sort_violations(&mut violations);
    }
    violations
}

fn sort_violations(violations: &mut [ContractViolation]) {
    violations.sort_by(|left, right| {
        (&left.json_path, &left.code, &left.keyword).cmp(&(
            &right.json_path,
            &right.code,
            &right.keyword,
        ))
    });
}

fn prefix_path(index: usize, path: &str) -> String {
    if path == "$" {
        format!("$[{index}]")
    } else {
        format!("$[{index}]{}", &path[1..])
    }
}

pub(crate) fn pointer_to_json_path(root: &Value, pointer: &str) -> String {
    if pointer.is_empty() || pointer == "/" {
        return "$".to_string();
    }
    let mut path = "$".to_string();
    let mut current = Some(root);
    for segment in pointer.trim_start_matches('/').split('/') {
        let segment = segment.replace("~1", "/").replace("~0", "~");
        let is_array_index =
            current.is_some_and(Value::is_array) && segment.parse::<usize>().is_ok();
        if is_array_index {
            path.push('[');
            path.push_str(&segment);
            path.push(']');
        } else if is_identifier(&segment) {
            path.push('.');
            path.push_str(&segment);
        } else {
            path.push('[');
            path.push_str(&serde_json::to_string(&segment).expect("string json"));
            path.push(']');
        }
        current = match current {
            Some(Value::Array(values)) => segment
                .parse::<usize>()
                .ok()
                .and_then(|index| values.get(index)),
            Some(Value::Object(object)) => object.get(&segment),
            _ => None,
        };
    }
    path
}

fn append_json_path_property(path: &str, property: &str) -> String {
    if is_identifier(property) {
        format!("{path}.{property}")
    } else {
        format!(
            "{path}[{}]",
            serde_json::to_string(property).expect("string json")
        )
    }
}

fn is_identifier(segment: &str) -> bool {
    let mut chars = segment.chars();
    matches!(chars.next(), Some(c) if c == '_' || c.is_ascii_alphabetic())
        && chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}
