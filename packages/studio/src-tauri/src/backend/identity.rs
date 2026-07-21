use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fmt;

const MAX_GENERATION_ATTEMPTS_PER_ID: usize = 1_024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionIdentityContext {
    pub file: String,
    pub node_id: String,
}

impl InstructionIdentityContext {
    pub fn new(file: impl Into<String>, node_id: impl Into<String>) -> Self {
        Self {
            file: file.into(),
            node_id: node_id.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignedInstructionId {
    pub file: String,
    pub node_id: String,
    pub json_path: String,
    pub id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionIdentityAssignment {
    pub node: Value,
    pub assigned: Vec<AssignedInstructionId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InstructionIdentityError {
    NodeMustBeArray,
    GeneratorExhausted,
}

impl fmt::Display for InstructionIdentityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NodeMustBeArray => formatter.write_str("node contents must be a JSON array"),
            Self::GeneratorExhausted => {
                formatter.write_str("instruction ID generator could not produce a unique ID")
            }
        }
    }
}

impl std::error::Error for InstructionIdentityError {}

pub trait InstructionIdGenerator {
    fn next_id(&mut self) -> String;
}

impl<F> InstructionIdGenerator for F
where
    F: FnMut() -> String,
{
    fn next_id(&mut self) -> String {
        self()
    }
}

pub fn generate_story_point_id() -> String {
    format!("sp_{}", uuid::Uuid::new_v4())
}

pub fn assign_missing_story_point_ids(
    node: &Value,
    context: &InstructionIdentityContext,
) -> Result<InstructionIdentityAssignment, InstructionIdentityError> {
    let mut generator = generate_story_point_id;
    assign_missing_story_point_ids_with_generator(node, context, &mut generator)
}

pub fn assign_missing_persistent_effect_ids(
    node: &Value,
    variables: &Value,
    context: &InstructionIdentityContext,
) -> Result<InstructionIdentityAssignment, InstructionIdentityError> {
    let Some(instructions) = node.as_array() else {
        return Err(InstructionIdentityError::NodeMustBeArray);
    };
    let declarations = variables.get("variables").and_then(Value::as_object);
    let mut normalized = instructions.clone();
    let mut assigned = vec![];
    let mut occupied = instructions.iter()
        .filter_map(|instruction| instruction.get("id").and_then(Value::as_str))
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .collect::<HashSet<_>>();
    let mut generator = || format!("pe_{}", uuid::Uuid::new_v4());

    for (index, instruction) in normalized.iter_mut().enumerate() {
        let is_global_set = instruction.get("t").and_then(Value::as_str) == Some("set")
            && instruction.get("key").and_then(Value::as_str)
                .and_then(|key| declarations.and_then(|items| items.get(key)))
                .and_then(|declaration| declaration.get("scope"))
                .and_then(Value::as_str) == Some("global");
        if !is_global_set || !needs_assignment(instruction) { continue; }
        let id = generate_unique_id(&mut generator, &occupied)?;
        occupied.insert(id.clone());
        instruction.as_object_mut().expect("set instructions are objects")
            .insert("id".to_string(), Value::String(id.clone()));
        assigned.push(AssignedInstructionId {
            file: context.file.clone(),
            node_id: context.node_id.clone(),
            json_path: format!("$[{index}].id"),
            id,
        });
    }

    Ok(InstructionIdentityAssignment { node: Value::Array(normalized), assigned })
}

pub fn assign_missing_story_point_ids_with_generator<G: InstructionIdGenerator>(
    node: &Value,
    context: &InstructionIdentityContext,
    generator: &mut G,
) -> Result<InstructionIdentityAssignment, InstructionIdentityError> {
    let Some(instructions) = node.as_array() else {
        return Err(InstructionIdentityError::NodeMustBeArray);
    };
    let mut assigned = Vec::new();
    let mut normalized = instructions.clone();
    let mut occupied = instructions
        .iter()
        .filter(|instruction| is_story_point_instruction(instruction))
        .filter_map(|instruction| instruction.get("id").and_then(Value::as_str))
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .collect::<HashSet<_>>();

    for (index, instruction) in normalized.iter_mut().enumerate() {
        if !is_story_point_instruction(instruction) || !needs_assignment(instruction) {
            continue;
        }
        let id = generate_unique_id(generator, &occupied)?;
        occupied.insert(id.clone());
        instruction
            .as_object_mut()
            .expect("story point instructions are JSON objects")
            .insert("id".to_string(), Value::String(id.clone()));
        assigned.push(AssignedInstructionId {
            file: context.file.clone(),
            node_id: context.node_id.clone(),
            json_path: format!("$[{index}].id"),
            id,
        });
    }

    Ok(InstructionIdentityAssignment {
        node: Value::Array(normalized),
        assigned,
    })
}

pub fn is_story_point_instruction(instruction: &Value) -> bool {
    instruction
        .get("t")
        .and_then(Value::as_str)
        .and_then(crate::backend::contracts::instruction_policies)
        .and_then(|metadata| metadata.get("storyPoint"))
        .and_then(Value::as_bool)
        == Some(true)
}

fn needs_assignment(instruction: &Value) -> bool {
    match instruction.get("id") {
        None => true,
        Some(Value::String(id)) => id.is_empty(),
        Some(_) => false,
    }
}

fn generate_unique_id<G: InstructionIdGenerator>(
    generator: &mut G,
    occupied: &HashSet<String>,
) -> Result<String, InstructionIdentityError> {
    for _ in 0..MAX_GENERATION_ATTEMPTS_PER_ID {
        let candidate = generator.next_id();
        if !candidate.is_empty() && !occupied.contains(&candidate) {
            return Ok(candidate);
        }
    }
    Err(InstructionIdentityError::GeneratorExhausted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;

    fn context() -> InstructionIdentityContext {
        InstructionIdentityContext::new("content/nodes/start.json", "start")
    }

    fn sequence(values: &[&str]) -> impl InstructionIdGenerator {
        let mut values = values
            .iter()
            .map(|value| value.to_string())
            .collect::<VecDeque<_>>();
        move || {
            values
                .pop_front()
                .expect("deterministic ID sequence exhausted")
        }
    }

    #[test]
    fn assigns_missing_and_empty_ids_to_every_policy_story_point() {
        let node = json!([
            { "t": "say", "who": "alice", "text": "hello" },
            { "t": "narrate", "id": "", "text": "wind" },
            { "t": "wait", "ms": 100 },
            { "t": "pause" }
        ]);
        let mut generator = sequence(&["sp-a", "sp-b", "sp-c", "sp-d"]);

        let result =
            assign_missing_story_point_ids_with_generator(&node, &context(), &mut generator)
                .unwrap();

        assert_eq!(result.node[0]["id"], "sp-a");
        assert_eq!(result.node[1]["id"], "sp-b");
        assert_eq!(result.node[2]["id"], "sp-c");
        assert_eq!(result.node[3]["id"], "sp-d");
        assert_eq!(
            result.assigned,
            vec![
                AssignedInstructionId {
                    file: "content/nodes/start.json".into(),
                    node_id: "start".into(),
                    json_path: "$[0].id".into(),
                    id: "sp-a".into(),
                },
                AssignedInstructionId {
                    file: "content/nodes/start.json".into(),
                    node_id: "start".into(),
                    json_path: "$[1].id".into(),
                    id: "sp-b".into(),
                },
                AssignedInstructionId {
                    file: "content/nodes/start.json".into(),
                    node_id: "start".into(),
                    json_path: "$[2].id".into(),
                    id: "sp-c".into(),
                },
                AssignedInstructionId {
                    file: "content/nodes/start.json".into(),
                    node_id: "start".into(),
                    json_path: "$[3].id".into(),
                    id: "sp-d".into(),
                },
            ]
        );
    }

    #[test]
    fn derives_story_points_from_generated_policy_metadata() {
        let instructions = crate::backend::contracts::instruction_types()
            .map(|instruction_type| json!({ "t": instruction_type }))
            .collect::<Vec<_>>();
        let expected_story_points = crate::backend::contracts::instruction_types()
            .filter(|instruction_type| {
                crate::backend::contracts::instruction_policies(instruction_type)
                    .and_then(|metadata| metadata.get("storyPoint"))
                    .and_then(Value::as_bool)
                    == Some(true)
            })
            .count();
        let mut counter = 0;
        let mut generator = || {
            counter += 1;
            format!("sp-{counter}")
        };

        let result = assign_missing_story_point_ids_with_generator(
            &Value::Array(instructions),
            &context(),
            &mut generator,
        )
        .unwrap();

        assert_eq!(result.assigned.len(), expected_story_points);
    }

    #[test]
    fn preserves_all_existing_non_empty_ids_including_duplicates() {
        let node = json!([
            { "t": "say", "id": "manual", "who": "alice", "text": "one" },
            { "t": "narrate", "id": "manual", "text": "two" }
        ]);
        let mut generator = || panic!("existing IDs must not invoke the generator");

        let result =
            assign_missing_story_point_ids_with_generator(&node, &context(), &mut generator)
                .unwrap();

        assert_eq!(result.node, node);
        assert!(result.assigned.is_empty());
    }

    #[test]
    fn ignores_non_story_points_and_unknown_instructions() {
        let node = json!([
            { "t": "bg", "id": "", "asset": "room" },
            { "t": "unknown", "text": "preserve me" },
            { "value": 42 }
        ]);
        let mut generator = || panic!("non-story points must not invoke the generator");

        let result =
            assign_missing_story_point_ids_with_generator(&node, &context(), &mut generator)
                .unwrap();

        assert_eq!(result.node, node);
        assert!(result.assigned.is_empty());
    }

    #[test]
    fn retries_empty_and_colliding_generated_values() {
        let node = json!([
            { "t": "say", "id": "occupied", "who": "alice", "text": "one" },
            { "t": "narrate", "text": "two" },
            { "t": "pause" }
        ]);
        let mut generator = sequence(&["", "occupied", "fresh-a", "fresh-a", "fresh-b"]);

        let result =
            assign_missing_story_point_ids_with_generator(&node, &context(), &mut generator)
                .unwrap();

        assert_eq!(result.node[1]["id"], "fresh-a");
        assert_eq!(result.node[2]["id"], "fresh-b");
    }

    #[test]
    fn assignment_is_idempotent_and_does_not_mutate_input() {
        let node = json!([{ "t": "narrate", "text": "wind" }]);
        let original = node.clone();
        let mut first_generator = sequence(&["stable"]);

        let first =
            assign_missing_story_point_ids_with_generator(&node, &context(), &mut first_generator)
                .unwrap();
        let mut second_generator = || panic!("an idempotent pass must not generate IDs");
        let second = assign_missing_story_point_ids_with_generator(
            &first.node,
            &context(),
            &mut second_generator,
        )
        .unwrap();

        assert_eq!(node, original);
        assert_eq!(second.node, first.node);
        assert!(second.assigned.is_empty());
    }

    #[test]
    fn generated_ids_are_prefixed_uuid_v4_values() {
        let id = generate_story_point_id();
        let uuid =
            uuid::Uuid::parse_str(id.strip_prefix("sp_").expect("sp_ prefix")).expect("valid UUID");

        assert_eq!(uuid.get_version_num(), 4);
    }

    #[test]
    fn report_serializes_with_cli_facing_camel_case_fields() {
        let item = AssignedInstructionId {
            file: "content/nodes/start.json".into(),
            node_id: "start".into(),
            json_path: "$[2].id".into(),
            id: "sp-a".into(),
        };

        assert_eq!(
            serde_json::to_value(item).unwrap(),
            json!({
                "file": "content/nodes/start.json",
                "nodeId": "start",
                "jsonPath": "$[2].id",
                "id": "sp-a"
            })
        );
    }

    #[test]
    fn rejects_non_array_node_values() {
        let mut generator = sequence(&["unused"]);

        let error = assign_missing_story_point_ids_with_generator(
            &json!({ "t": "narrate" }),
            &context(),
            &mut generator,
        )
        .unwrap_err();

        assert_eq!(error, InstructionIdentityError::NodeMustBeArray);
    }

    #[test]
    fn reports_exhausted_generators_instead_of_looping_forever() {
        let node = json!([
            { "t": "narrate", "id": "occupied", "text": "first" },
            { "t": "narrate", "text": "second" }
        ]);
        let mut generator = || "occupied".to_string();

        let error =
            assign_missing_story_point_ids_with_generator(&node, &context(), &mut generator)
                .unwrap_err();

        assert_eq!(error, InstructionIdentityError::GeneratorExhausted);
    }
}
