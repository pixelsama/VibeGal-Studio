struct ManifestRefs {
    backgrounds: HashSet<String>,
    bgm: HashSet<String>,
    sfx: HashSet<String>,
    voice: HashSet<String>,
    cg: HashSet<String>,
    videos: HashSet<String>,
    characters: HashMap<String, HashSet<String>>,
    unlock_cg: HashSet<String>,
    unlock_music: HashSet<String>,
    unlock_replay: HashSet<String>,
    unlock_endings: HashSet<String>,
}

fn collect_manifest_refs(manifest: &serde_json::Value) -> Option<ManifestRefs> {
    let obj = manifest.as_object()?;
    let backgrounds = obj
        .get("backgrounds")?
        .as_object()?
        .keys()
        .cloned()
        .collect::<HashSet<_>>();
    let audio = obj.get("audio")?.as_object()?;
    let audio_set = |name: &str| -> Option<HashSet<String>> {
        Some(audio.get(name)?.as_object()?.keys().cloned().collect())
    };
    let registry_set = |name: &str| -> HashSet<String> {
        obj.get(name)
            .and_then(|value| value.as_object())
            .map(|table| table.keys().cloned().collect())
            .unwrap_or_default()
    };
    let characters_obj = obj.get("characters")?.as_object()?;
    let mut characters = HashMap::new();
    for (id, raw) in characters_obj {
        let sprites = raw.get("sprites")?.as_object()?;
        characters.insert(id.clone(), sprites.keys().cloned().collect());
    }
    let empty_object = serde_json::Map::new();
    let unlocks = obj
        .get("unlocks")
        .and_then(|value| value.as_object())
        .unwrap_or(&empty_object);
    let unlock_set = |name: &str| -> HashSet<String> {
        unlocks
            .get(name)
            .and_then(|value| value.as_object())
            .map(|table| table.keys().cloned().collect())
            .unwrap_or_default()
    };

    Some(ManifestRefs {
        backgrounds,
        bgm: audio_set("bgm")?,
        sfx: audio_set("sfx")?,
        voice: audio_set("voice")?,
        cg: registry_set("cg"),
        videos: registry_set("videos"),
        characters,
        unlock_cg: unlock_set("cg"),
        unlock_music: unlock_set("music"),
        unlock_replay: unlock_set("replay"),
        unlock_endings: unlock_set("endings"),
    })
}

pub fn validate_node_contents(
    graph: &ProjectGraph,
    nodes: &[NodeEntry],
    manifest: &serde_json::Value,
) -> Vec<ProjectIssue> {
    let mut issues = vec![];
    let manifest_refs = collect_manifest_refs(manifest);

    for (index, graph_node) in graph.nodes.iter().enumerate() {
        let Some(entry) = nodes.get(index) else {
            continue;
        };
        let Some(data) = &entry.data else {
            continue;
        };
        let file = format!("content/{}", graph_node.file);
        let Some(instructions) = data.as_array() else {
            issues.push(node_issue(
                "node_not_array",
                format!("节点「{}」的内容必须是 Instruction[] 数组", graph_node.id),
                &file,
                "$".to_string(),
                &graph_node.id,
            ));
            continue;
        };
        let mut first_index_by_story_point_id = HashMap::<String, usize>::new();

        for (instruction_index, instruction) in instructions.iter().enumerate() {
            let Some(obj) = instruction.as_object() else {
                issues.push(node_issue(
                    "instruction_invalid_field",
                    format!("第 {} 条指令必须是 JSON 对象", instruction_index),
                    &file,
                    format!("$[{instruction_index}]"),
                    &graph_node.id,
                ));
                continue;
            };
            let Some(t) = obj.get("t").and_then(|value| value.as_str()) else {
                issues.push(node_issue(
                    "instruction_unknown_type",
                    format!("第 {} 条指令缺少有效的 t 类型", instruction_index),
                    &file,
                    format!("$[{instruction_index}].t"),
                    &graph_node.id,
                ));
                continue;
            };

            let mut valid = true;
            match t {
                "bg" => {
                    valid &= require_string_field(
                        obj,
                        "id",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_enum_field(
                        obj,
                        "trans",
                        &["fade", "cut", "dissolve"],
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_nonnegative_int_field(
                        obj,
                        "ms",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    if valid {
                        if let Some(refs) = &manifest_refs {
                            check_registry_ref(
                                refs.backgrounds.contains(obj["id"].as_str().unwrap()),
                                "missing_background_ref",
                                format!(
                                    "bg 引用了不存在的背景 id：{}",
                                    obj["id"].as_str().unwrap()
                                ),
                                "id",
                                instruction_index,
                                &file,
                                &graph_node.id,
                                &mut issues,
                            );
                        }
                    }
                }
                "bgm" => {
                    valid &= require_string_field(
                        obj,
                        "id",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_nonnegative_int_field(
                        obj,
                        "fade",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_bool_field(
                        obj,
                        "loop",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    if valid {
                        if let Some(refs) = &manifest_refs {
                            check_registry_ref(
                                refs.bgm.contains(obj["id"].as_str().unwrap()),
                                "missing_bgm_ref",
                                format!(
                                    "bgm 引用了不存在的 bgm id：{}",
                                    obj["id"].as_str().unwrap()
                                ),
                                "id",
                                instruction_index,
                                &file,
                                &graph_node.id,
                                &mut issues,
                            );
                        }
                    }
                }
                "sfx" => {
                    valid &= require_string_field(
                        obj,
                        "id",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    if valid {
                        if let Some(refs) = &manifest_refs {
                            check_registry_ref(
                                refs.sfx.contains(obj["id"].as_str().unwrap()),
                                "missing_sfx_ref",
                                format!(
                                    "sfx 引用了不存在的 sfx id：{}",
                                    obj["id"].as_str().unwrap()
                                ),
                                "id",
                                instruction_index,
                                &file,
                                &graph_node.id,
                                &mut issues,
                            );
                        }
                    }
                }
                "voice" => {
                    valid &= require_string_field(
                        obj,
                        "id",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    if valid {
                        if let Some(refs) = &manifest_refs {
                            check_registry_ref(
                                refs.voice.contains(obj["id"].as_str().unwrap()),
                                "missing_voice_ref",
                                format!(
                                    "voice 引用了不存在的 voice id：{}",
                                    obj["id"].as_str().unwrap()
                                ),
                                "id",
                                instruction_index,
                                &file,
                                &graph_node.id,
                                &mut issues,
                            );
                        }
                    }
                }
                "char" => {
                    valid &= require_string_field(
                        obj,
                        "id",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_string_field(
                        obj,
                        "pos",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_string_field(
                        obj,
                        "expr",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_enum_field(
                        obj,
                        "trans",
                        &["fade", "cut", "slide"],
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_nonnegative_int_field(
                        obj,
                        "ms",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_bool_field(
                        obj,
                        "clear",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_bool_field(
                        obj,
                        "remove",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    if valid {
                        if let Some(refs) = &manifest_refs {
                            let id = obj["id"].as_str().unwrap();
                            check_character_ref(
                                refs,
                                id,
                                obj.get("expr")
                                    .and_then(|value| value.as_str())
                                    .unwrap_or("default"),
                                "id",
                                "expr",
                                instruction_index,
                                &file,
                                &graph_node.id,
                                &mut issues,
                            );
                        }
                    }
                }
                "say" => {
                    valid &= require_string_field(
                        obj,
                        "who",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_string_field(
                        obj,
                        "expr",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= require_nonempty_string_field(
                        obj,
                        "text",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_nonnegative_int_field(
                        obj,
                        "ms",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    if valid {
                        if let Some(refs) = &manifest_refs {
                            let who = obj["who"].as_str().unwrap();
                            check_character_ref(
                                refs,
                                who,
                                obj.get("expr")
                                    .and_then(|value| value.as_str())
                                    .unwrap_or("default"),
                                "who",
                                "expr",
                                instruction_index,
                                &file,
                                &graph_node.id,
                                &mut issues,
                            );
                        }
                    }
                }
                "narrate" => {
                    valid &= require_nonempty_string_field(
                        obj,
                        "text",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_nonnegative_int_field(
                        obj,
                        "ms",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                }
                "wait" => {
                    valid &= require_nonnegative_int_field(
                        obj,
                        "ms",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                }
                "effect" => {
                    require_enum_field(
                        obj,
                        "type",
                        &["shake", "flash", "blur"],
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    optional_number_range_field(
                        obj,
                        "intensity",
                        0.0,
                        20.0,
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    optional_nonnegative_int_field(
                        obj,
                        "ms",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                }
                "transition" => {
                    require_enum_field(
                        obj,
                        "type",
                        &["fade_in", "fade_out", "white_in", "white_out", "black"],
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    optional_nonnegative_int_field(
                        obj,
                        "ms",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                }
                "choice" => {
                    issues.push(node_issue(
                        "choice_instruction_not_supported",
                        "choice 指令已废弃；请在节点出口中配置分支".to_string(),
                        &file,
                        format!("$[{instruction_index}].t"),
                        &graph_node.id,
                    ));
                }
                "set" => {
                    require_nonempty_string_field(
                        obj,
                        "key",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    require_variable_value_field(
                        obj,
                        "value",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                }
                "unlock" => {
                    valid &= require_enum_field(
                        obj,
                        "kind",
                        &["cg", "music", "replay", "endings"],
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= require_nonempty_string_field(
                        obj,
                        "id",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    if valid {
                        if let Some(refs) = &manifest_refs {
                            let exists = match obj["kind"].as_str().unwrap() {
                                "cg" => refs.unlock_cg.contains(obj["id"].as_str().unwrap()),
                                "music" => refs.unlock_music.contains(obj["id"].as_str().unwrap()),
                                "replay" => refs.unlock_replay.contains(obj["id"].as_str().unwrap()),
                                "endings" => refs.unlock_endings.contains(obj["id"].as_str().unwrap()),
                                _ => false,
                            };
                            check_registry_ref(
                                exists,
                                "missing_unlock_ref",
                                format!(
                                    "unlock 引用了不存在的 {} unlock id：{}",
                                    obj["kind"].as_str().unwrap(),
                                    obj["id"].as_str().unwrap()
                                ),
                                "id",
                                instruction_index,
                                &file,
                                &graph_node.id,
                                &mut issues,
                            );
                        }
                    }
                }
                "showCg" => {
                    valid &= require_nonempty_string_field(
                        obj,
                        "id",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    if valid {
                        if let Some(refs) = &manifest_refs {
                            check_registry_ref(
                                refs.cg.contains(obj["id"].as_str().unwrap()),
                                "missing_cg_ref",
                                format!(
                                    "showCg 引用了不存在的 cg id：{}",
                                    obj["id"].as_str().unwrap()
                                ),
                                "id",
                                instruction_index,
                                &file,
                                &graph_node.id,
                                &mut issues,
                            );
                        }
                    }
                }
                "playVideo" => {
                    valid &= require_nonempty_string_field(
                        obj,
                        "id",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    valid &= optional_bool_field(
                        obj,
                        "skippable",
                        instruction_index,
                        t,
                        &file,
                        &graph_node.id,
                        &mut issues,
                    );
                    if valid {
                        if let Some(refs) = &manifest_refs {
                            check_registry_ref(
                                refs.videos.contains(obj["id"].as_str().unwrap()),
                                "missing_video_ref",
                                format!(
                                    "playVideo 引用了不存在的 video id：{}",
                                    obj["id"].as_str().unwrap()
                                ),
                                "id",
                                instruction_index,
                                &file,
                                &graph_node.id,
                                &mut issues,
                            );
                        }
                    }
                }
                "pause" => {}
                _ => {
                    issues.push(node_issue(
                        "instruction_unknown_type",
                        format!("第 {} 条指令类型不支持：{}", instruction_index, t),
                        &file,
                        format!("$[{instruction_index}].t"),
                        &graph_node.id,
                    ));
                    valid = false;
                }
            }

            if valid && matches!(t, "say" | "narrate" | "wait" | "pause") {
                validate_story_point_identity(
                    obj,
                    instruction_index,
                    t,
                    &file,
                    &graph_node.id,
                    &mut first_index_by_story_point_id,
                    &mut issues,
                );
            }
        }
    }

    issues
}

fn validate_story_point_identity(
    obj: &serde_json::Map<String, serde_json::Value>,
    index: usize,
    instruction_type: &str,
    file: &str,
    node_id: &str,
    first_index_by_id: &mut HashMap<String, usize>,
    issues: &mut Vec<ProjectIssue>,
) {
    match obj.get("id") {
        None => issues.push(ProjectIssue {
            severity: GraphIssueSeverity::Warn,
            source: "node".to_string(),
            code: "instruction_id_missing".to_string(),
            message: format!(
                "{instruction_type} 指令缺少稳定 id；存档、已读和回滚将无法稳定定位该停点。"
            ),
            file: Some(file.to_string()),
            json_path: Some(format!("$[{index}].id")),
            node_id: Some(node_id.to_string()),
            edge_id: None,
        }),
        Some(serde_json::Value::String(id)) if !id.is_empty() => {
            if let Some(first_index) = first_index_by_id.get(id) {
                issues.push(node_issue(
                    "instruction_id_duplicate",
                    format!(
                        "同一节点内重复的停点 instruction id: \"{id}\"（首次出现于 #{first_index}）。"
                    ),
                    file,
                    format!("$[{index}].id"),
                    node_id,
                ));
            } else {
                first_index_by_id.insert(id.clone(), index);
            }
        }
        Some(_) => {
            push_invalid_field(
                issue_message(instruction_type, "id", "必须是非空字符串"),
                "id",
                index,
                file,
                node_id,
                issues,
            );
        }
    }
}

fn node_issue(
    code: &str,
    message: String,
    file: &str,
    json_path: String,
    node_id: &str,
) -> ProjectIssue {
    ProjectIssue {
        severity: GraphIssueSeverity::Error,
        source: "node".to_string(),
        code: code.to_string(),
        message,
        file: Some(file.to_string()),
        json_path: Some(json_path),
        node_id: Some(node_id.to_string()),
        edge_id: None,
    }
}

fn require_string_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    index: usize,
    instruction_type: &str,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) -> bool {
    if obj.get(field).and_then(|value| value.as_str()).is_some() {
        return true;
    }
    push_invalid_field(
        issue_message(instruction_type, field, "必须是字符串"),
        field,
        index,
        file,
        node_id,
        issues,
    );
    false
}

fn require_variable_value_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    index: usize,
    instruction_type: &str,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) -> bool {
    let Some(value) = obj.get(field) else {
        push_invalid_field(
            issue_message(instruction_type, field, "必须存在"),
            field,
            index,
            file,
            node_id,
            issues,
        );
        return false;
    };
    if value.is_string() || value.is_number() || value.is_boolean() || value.is_null() {
        return true;
    }
    push_invalid_field(
        issue_message(instruction_type, field, "必须是字符串、数字、布尔值或 null"),
        field,
        index,
        file,
        node_id,
        issues,
    );
    false
}

fn optional_string_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    index: usize,
    instruction_type: &str,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) -> bool {
    if !obj.contains_key(field) || obj.get(field).and_then(|value| value.as_str()).is_some() {
        return true;
    }
    push_invalid_field(
        issue_message(instruction_type, field, "必须是字符串"),
        field,
        index,
        file,
        node_id,
        issues,
    );
    false
}

fn require_nonempty_string_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    index: usize,
    instruction_type: &str,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) -> bool {
    match obj.get(field).and_then(|value| value.as_str()) {
        Some(value) if !value.is_empty() => true,
        _ => {
            push_invalid_field(
                issue_message(instruction_type, field, "必须是非空字符串"),
                field,
                index,
                file,
                node_id,
                issues,
            );
            false
        }
    }
}

fn require_nonnegative_int_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    index: usize,
    instruction_type: &str,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) -> bool {
    if obj.get(field).and_then(|value| value.as_u64()).is_some() {
        return true;
    }
    push_invalid_field(
        issue_message(instruction_type, field, "必须是非负整数"),
        field,
        index,
        file,
        node_id,
        issues,
    );
    false
}

fn optional_nonnegative_int_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    index: usize,
    instruction_type: &str,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) -> bool {
    if !obj.contains_key(field) || obj.get(field).and_then(|value| value.as_u64()).is_some() {
        return true;
    }
    push_invalid_field(
        issue_message(instruction_type, field, "必须是非负整数"),
        field,
        index,
        file,
        node_id,
        issues,
    );
    false
}

fn optional_number_range_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    min: f64,
    max: f64,
    index: usize,
    instruction_type: &str,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) -> bool {
    let valid = match obj.get(field) {
        None => true,
        Some(value) => value
            .as_f64()
            .map(|number| number >= min && number <= max)
            .unwrap_or(false),
    };
    if valid {
        return true;
    }
    push_invalid_field(
        issue_message(
            instruction_type,
            field,
            &format!("必须在 {min}..={max} 范围内"),
        ),
        field,
        index,
        file,
        node_id,
        issues,
    );
    false
}

fn optional_bool_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    index: usize,
    instruction_type: &str,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) -> bool {
    if !obj.contains_key(field) || obj.get(field).and_then(|value| value.as_bool()).is_some() {
        return true;
    }
    push_invalid_field(
        issue_message(instruction_type, field, "必须是布尔值"),
        field,
        index,
        file,
        node_id,
        issues,
    );
    false
}

fn require_enum_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    allowed: &[&str],
    index: usize,
    instruction_type: &str,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) -> bool {
    match obj.get(field).and_then(|value| value.as_str()) {
        Some(value) if allowed.contains(&value) => true,
        _ => {
            push_invalid_field(
                issue_message(instruction_type, field, "不是支持的枚举值"),
                field,
                index,
                file,
                node_id,
                issues,
            );
            false
        }
    }
}

fn optional_enum_field(
    obj: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    allowed: &[&str],
    index: usize,
    instruction_type: &str,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) -> bool {
    match obj.get(field).and_then(|value| value.as_str()) {
        None => !obj.contains_key(field),
        Some(value) if allowed.contains(&value) => true,
        _ => {
            push_invalid_field(
                issue_message(instruction_type, field, "不是支持的枚举值"),
                field,
                index,
                file,
                node_id,
                issues,
            );
            false
        }
    }
}

fn push_invalid_field(
    message: String,
    field: &str,
    index: usize,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) {
    issues.push(node_issue(
        "instruction_invalid_field",
        message,
        file,
        format!("$[{index}].{field}"),
        node_id,
    ));
}

fn issue_message(instruction_type: &str, field: &str, reason: &str) -> String {
    format!("{instruction_type}.{field} {reason}")
}

fn check_registry_ref(
    exists: bool,
    code: &str,
    message: String,
    field: &str,
    index: usize,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) {
    if !exists {
        issues.push(node_issue(
            code,
            message,
            file,
            format!("$[{index}].{field}"),
            node_id,
        ));
    }
}

fn check_character_ref(
    refs: &ManifestRefs,
    character_id: &str,
    expr: &str,
    id_field: &str,
    expr_field: &str,
    index: usize,
    file: &str,
    node_id: &str,
    issues: &mut Vec<ProjectIssue>,
) {
    let Some(sprites) = refs.characters.get(character_id) else {
        issues.push(node_issue(
            "missing_character_ref",
            format!("引用了不存在的角色 id：{character_id}"),
            file,
            format!("$[{index}].{id_field}"),
            node_id,
        ));
        return;
    };
    if !sprites.contains(expr) {
        issues.push(node_issue(
            "missing_character_expr",
            format!("角色 {character_id} 没有表情：{expr}"),
            file,
            format!("$[{index}].{expr_field}"),
            node_id,
        ));
    }
}

// ──────────────────────────────────────────────
// 资产一致性校验（磁盘文件 ↔ manifest 声明）
// ──────────────────────────────────────────────
