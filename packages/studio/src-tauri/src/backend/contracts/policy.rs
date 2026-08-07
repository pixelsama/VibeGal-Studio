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
    let mut first_story_point = HashMap::<String, ()>::new();
    validate_instruction_list(
        instructions,
        "$",
        manifest,
        &mut issues,
        &mut first_story_point,
    );
    issues
}

fn validate_instruction_list(
    instructions: &[Value],
    path: &str,
    manifest: &Value,
    issues: &mut Vec<NodeSemanticIssue>,
    first_story_point: &mut HashMap<String, ()>,
) {
    for (index, instruction) in instructions.iter().enumerate() {
        let instruction_path = format!("{path}[{index}]");
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
                    format!("{instruction_path}.id"),
                )),
                Some(id) if first_story_point.contains_key(id) => issues.push(issue(
                    "instruction_id_duplicate",
                    &format!("同一节点内重复的停点 instruction id: \"{id}\""),
                    format!("{instruction_path}.id"),
                )),
                Some(id) => {
                    first_story_point.insert(id.to_string(), ());
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
                Some("registry") | Some("optionalRegistry") => {
                    execute_registry_rule(issues, instruction, manifest, rule, &instruction_path)
                }
                Some("characterExpression") => execute_character_expression_rule(
                    issues,
                    instruction,
                    manifest,
                    rule,
                    &instruction_path,
                ),
                Some("registryByDiscriminator") => execute_discriminated_registry_rule(
                    issues,
                    instruction,
                    manifest,
                    rule,
                    &instruction_path,
                ),
                Some("storyPoint") => {}
                Some(kind) => panic!("unsupported embedded contracts policy rule: {kind}"),
                None => panic!("embedded contracts policy rule is missing kind"),
            }
        }
        if instruction_type == "if" {
            if let Some(then) = instruction.get("then").and_then(Value::as_array) {
                validate_instruction_list(
                    then,
                    &format!("{instruction_path}.then"),
                    manifest,
                    issues,
                    first_story_point,
                );
            }
            if let Some(else_branch) = instruction.get("else").and_then(Value::as_array) {
                validate_instruction_list(
                    else_branch,
                    &format!("{instruction_path}.else"),
                    manifest,
                    issues,
                    first_story_point,
                );
            }
        } else if instruction_type == "choice" {
            if let Some(options) = instruction.get("options").and_then(Value::as_array) {
                for (option_index, option) in options.iter().enumerate() {
                    if let Some(body) = option.get("body").and_then(Value::as_array) {
                        validate_instruction_list(
                            body,
                            &format!("{instruction_path}.options[{option_index}].body"),
                            manifest,
                            issues,
                            first_story_point,
                        );
                    }
                }
            }
        }
    }
}

fn execute_registry_rule(
    issues: &mut Vec<NodeSemanticIssue>,
    instruction: &Value,
    manifest: &Value,
    rule: &Value,
    instruction_path: &str,
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
            format!("{instruction_path}.{id_field}"),
        ));
    }
}

fn execute_character_expression_rule(
    issues: &mut Vec<NodeSemanticIssue>,
    instruction: &Value,
    manifest: &Value,
    rule: &Value,
    instruction_path: &str,
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
            format!("{instruction_path}.{character_field}"),
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
            format!("{instruction_path}.{expression_field}"),
        ));
    }
}

fn execute_discriminated_registry_rule(
    issues: &mut Vec<NodeSemanticIssue>,
    instruction: &Value,
    manifest: &Value,
    rule: &Value,
    instruction_path: &str,
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
            format!("{instruction_path}.{id_field}"),
        ));
    }
}

pub(crate) fn validate_project_semantics(
    graph: &Value,
    nodes: &std::collections::HashMap<String, &Value>,
    manifest: &Value,
    image_dimensions: &std::collections::HashMap<String, (u32, u32)>,
) -> Vec<NodeSemanticIssue> {
    let mut issues = validate_chapter_checkpoints(graph, nodes, manifest);
    issues.extend(validate_animation_atlases(manifest, image_dimensions));
    issues
        .sort_by(|left, right| (&left.json_path, &left.code).cmp(&(&right.json_path, &right.code)));
    issues.dedup_by(|left, right| left.json_path == right.json_path && left.code == right.code);
    issues
}

fn validate_chapter_checkpoints(
    graph: &Value,
    nodes: &std::collections::HashMap<String, &Value>,
    manifest: &Value,
) -> Vec<NodeSemanticIssue> {
    let Some(chapters) = graph.get("chapters").and_then(Value::as_array) else {
        return vec![];
    };
    let graph_nodes = graph
        .get("nodes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|node| node.get("id").and_then(Value::as_str).map(|id| (id, node)))
        .collect::<HashMap<_, _>>();
    let entry_chapter_id = graph
        .get("entryNodeId")
        .and_then(Value::as_str)
        .and_then(|entry| graph_nodes.get(entry))
        .and_then(|node| node.get("chapterId"))
        .and_then(Value::as_str);
    let backgrounds = manifest.get("backgrounds").and_then(Value::as_object);
    let characters = manifest.get("characters").and_then(Value::as_object);
    let bgm = manifest.pointer("/audio/bgm").and_then(Value::as_object);
    let mut issues = vec![];

    for (chapter_index, chapter) in chapters.iter().enumerate() {
        let Some(chapter_id) = chapter.get("id").and_then(Value::as_str) else {
            continue;
        };
        let path = format!("$.chapters[{chapter_index}]");
        let Some(checkpoint) = chapter.get("checkpoint") else {
            if entry_chapter_id.is_some() && Some(chapter_id) != entry_chapter_id {
                issues.push(issue(
                    "chapter_checkpoint_missing",
                    &format!("章节 \"{chapter_id}\" 没有安全跳读 checkpoint；它只能作为编辑分组。"),
                    format!("{path}.checkpoint"),
                ));
            }
            continue;
        };
        let node_id = checkpoint
            .get("nodeId")
            .and_then(Value::as_str)
            .unwrap_or("");
        match graph_nodes.get(node_id) {
            None => issues.push(issue(
                "checkpoint_node_missing",
                &format!("章节 checkpoint 引用了不存在的节点 \"{node_id}\"。"),
                format!("{path}.checkpoint.nodeId"),
            )),
            Some(node) => {
                let target_chapter = node.get("chapterId").and_then(Value::as_str).unwrap_or("");
                if target_chapter != chapter_id {
                    issues.push(issue(
                        "checkpoint_node_wrong_chapter",
                        &format!(
                            "章节 \"{chapter_id}\" 的 checkpoint 节点属于章节 \"{target_chapter}\"。"
                        ),
                        format!("{path}.checkpoint.nodeId"),
                    ));
                }
            }
        }
        if let Some(instruction_id) = checkpoint.get("instructionId").and_then(Value::as_str) {
            let found = nodes
                .get(node_id)
                .and_then(|data| data.as_array())
                .is_some_and(|instructions| {
                    instructions.iter().enumerate().any(|(index, instruction)| {
                        let Some(instruction_type) = instruction.get("t").and_then(Value::as_str)
                        else {
                            return false;
                        };
                        let story_point = matches!(
                            instruction_type,
                            "say" | "narrate" | "wait" | "pause" | "inputName" | "completeEnding"
                        );
                        story_point
                            && instruction
                                .get("id")
                                .and_then(Value::as_str)
                                .map(|id| id == instruction_id)
                                .unwrap_or_else(|| instruction_id == format!("index:{index}"))
                    })
                });
            if !found {
                issues.push(issue(
                    "checkpoint_story_point_missing",
                    &format!("checkpoint 停点 \"{instruction_id}\" 不存在于节点 \"{node_id}\"。"),
                    format!("{path}.checkpoint.instructionId"),
                ));
            }
        }
        if let Some(background) = checkpoint.get("background").and_then(Value::as_str) {
            if backgrounds.is_none_or(|registry| !registry.contains_key(background)) {
                issues.push(issue(
                    "checkpoint_background_missing",
                    &format!("checkpoint 引用了不存在的背景 \"{background}\"。"),
                    format!("{path}.checkpoint.background"),
                ));
            }
        }
        for (sprite_index, sprite) in checkpoint
            .get("sprites")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let character_id = sprite.get("id").and_then(Value::as_str).unwrap_or("");
            let expression = sprite.get("expr").and_then(Value::as_str).unwrap_or("");
            let character = characters.and_then(|registry| registry.get(character_id));
            if character.is_none() {
                issues.push(issue(
                    "checkpoint_character_missing",
                    &format!("checkpoint 引用了不存在的角色 \"{character_id}\"。"),
                    format!("{path}.checkpoint.sprites[{sprite_index}].id"),
                ));
            } else if !character
                .and_then(|value| value.get("sprites"))
                .and_then(Value::as_object)
                .is_some_and(|sprites| sprites.contains_key(expression))
            {
                issues.push(issue(
                    "checkpoint_character_expr_missing",
                    &format!("角色 \"{character_id}\" 没有 checkpoint 表情 \"{expression}\"。"),
                    format!("{path}.checkpoint.sprites[{sprite_index}].expr"),
                ));
            }
        }
        if let Some(bgm_id) = checkpoint.pointer("/bgm/id").and_then(Value::as_str) {
            if bgm.is_none_or(|registry| !registry.contains_key(bgm_id)) {
                issues.push(issue(
                    "checkpoint_bgm_missing",
                    &format!("checkpoint 引用了不存在的 BGM \"{bgm_id}\"。"),
                    format!("{path}.checkpoint.bgm.id"),
                ));
            }
        }
    }
    issues
}

fn validate_animation_atlases(
    manifest: &Value,
    image_dimensions: &std::collections::HashMap<String, (u32, u32)>,
) -> Vec<NodeSemanticIssue> {
    let atlases = manifest.get("animationAtlases").and_then(Value::as_object);
    let mut issues = vec![];
    for (character_id, character) in manifest
        .get("characters")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        for (expression, reference) in character
            .get("sprites")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let Some(reference) = reference.as_object() else {
                continue;
            };
            let atlas_id = reference.get("atlas").and_then(Value::as_str).unwrap_or("");
            let clip_id = reference.get("clip").and_then(Value::as_str).unwrap_or("");
            let path = format!(
                "$.characters[{}].sprites[{}]",
                serde_json::to_string(character_id).expect("json key"),
                serde_json::to_string(expression).expect("json key")
            );
            let atlas = atlases.and_then(|registry| registry.get(atlas_id));
            if atlas.is_none() {
                issues.push(issue(
                    "animation_atlas_missing",
                    &format!("角色表情引用了不存在的 animation atlas \"{atlas_id}\"。"),
                    format!("{path}.atlas"),
                ));
                continue;
            }
            if !atlas
                .and_then(|value| value.get("clips"))
                .and_then(Value::as_object)
                .is_some_and(|clips| clips.contains_key(clip_id))
            {
                issues.push(issue(
                    "animation_clip_missing",
                    &format!("animation atlas \"{atlas_id}\" 没有 clip \"{clip_id}\"。"),
                    format!("{path}.clip"),
                ));
            }
        }
    }

    for (atlas_id, atlas) in atlases.into_iter().flatten() {
        let Some(image) = atlas.get("image").and_then(Value::as_str) else {
            continue;
        };
        let Some(&(image_width, image_height)) = image_dimensions.get(image) else {
            continue;
        };
        let Some(frame_width) = atlas.get("frameWidth").and_then(Value::as_u64) else {
            continue;
        };
        let Some(frame_height) = atlas.get("frameHeight").and_then(Value::as_u64) else {
            continue;
        };
        let columns = u64::from(image_width) / frame_width;
        let rows = u64::from(image_height) / frame_height;
        let frame_count = columns * rows;
        for (clip_id, clip) in atlas
            .get("clips")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            for (frame_index, frame) in clip
                .get("frames")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let Some(frame) = frame.as_u64() else {
                    continue;
                };
                if columns > 0 && rows > 0 && frame < frame_count {
                    continue;
                }
                issues.push(issue(
                    "animation_frame_out_of_bounds",
                    &format!("图集帧 {frame} 超过 {columns}×{rows} 网格范围。"),
                    format!(
                        "$.animationAtlases[{}].clips[{}].frames[{frame_index}]",
                        serde_json::to_string(atlas_id).expect("json key"),
                        serde_json::to_string(clip_id).expect("json key")
                    ),
                ));
            }
        }
    }
    issues
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
