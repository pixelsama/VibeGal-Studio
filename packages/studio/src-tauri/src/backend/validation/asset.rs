//! Asset discovery and reference validation.

/// manifest 资产收集结果。
struct ManifestAssetRefs {
    /// (路径, 来源描述)：路径相对 content 根，来源用于悬空引用里指明是谁声明的。
    declared: Vec<(String, String)>,
    /// uiSkin 约定键（Spec 21 §6 titleBackground/titleBgm）经注册表 id 解析产生
    /// 的来源。它们是注册表条目的别名而非独立声明，豁免 duplicate_asset_ref。
    convention_sources: std::collections::HashSet<String>,
    /// 收集阶段即可确定的问题（如约定 id 未命中注册表）。
    id_issues: Vec<GraphIssue>,
}

/// Spec 21 §6 约定键的 id 解析：value 是注册表资产 id 而非 content 相对路径。
/// - id 命中注册表 → 声明解析后的真实路径（missing_asset 指向真实文件）；
/// - id 未命中 → unknown_asset_id 错误（jsonPath 指向约定键）。
fn resolve_uiskin_convention_id(
    refs: &mut ManifestAssetRefs,
    manifest: &serde_json::Value,
    registry_path: &[&str],
    asset_id: &str,
    source: &str,
) {
    let mut registry = Some(manifest);
    for key in registry_path {
        registry = registry.and_then(|value| value.get(*key));
    }
    let resolved = registry
        .and_then(|entries| entries.get(asset_id))
        .and_then(|path| path.as_str());
    match resolved {
        Some(path) => {
            refs.declared.push((path.to_string(), source.to_string()));
            refs.convention_sources.insert(source.to_string());
        }
        None => refs.id_issues.push(GraphIssue {
            severity: GraphIssueSeverity::Error,
            code: "unknown_asset_id".to_string(),
            message: format!(
                "uiSkin 资产引用了未知资产 id：{asset_id}（{source}，注册表 {} 中不存在）",
                registry_path.join(".")
            ),
            file: Some("content/manifest.json".to_string()),
            json_path: Some(format!("$.{source}")),
            node_id: None,
            edge_id: None,
        }),
    }
}

/// 收集 manifest 中声明的所有资产路径（相对 content 根）。
fn collect_manifest_asset_paths(manifest: &serde_json::Value) -> ManifestAssetRefs {
    let mut refs = ManifestAssetRefs {
        declared: vec![],
        convention_sources: std::collections::HashSet::new(),
        id_issues: vec![],
    };
    let out = &mut refs.declared;

    // backgrounds: id → path
    if let Some(obj) = manifest.get("backgrounds").and_then(|v| v.as_object()) {
        for (id, path) in obj {
            if let Some(p) = path.as_str() {
                out.push((p.to_string(), format!("backgrounds.{id}")));
            }
        }
    }

    // characters.<id>.sprites.<expr> → path
    if let Some(obj) = manifest.get("characters").and_then(|v| v.as_object()) {
        for (char_id, char_val) in obj {
            if let Some(sprites) = char_val.get("sprites").and_then(|v| v.as_object()) {
                for (expr, path) in sprites {
                    if let Some(p) = path.as_str() {
                        out.push((
                            p.to_string(),
                            format!("characters.{char_id}.sprites.{expr}"),
                        ));
                    }
                }
            }
        }
    }

    // audio.{bgm,sfx,voice}.<id> → path
    if let Some(audio) = manifest.get("audio") {
        for sub in ["bgm", "sfx", "voice"] {
            if let Some(obj) = audio.get(sub).and_then(|v| v.as_object()) {
                for (id, path) in obj {
                    if let Some(p) = path.as_str() {
                        out.push((p.to_string(), format!("audio.{sub}.{id}")));
                    }
                }
            }
        }
    }

    if let Some(obj) = manifest.get("cg").and_then(|v| v.as_object()) {
        for (id, asset) in obj {
            collect_asset_ref_path(out, asset, &format!("cg.{id}"), &["thumbnail"]);
        }
    }

    if let Some(obj) = manifest.get("videos").and_then(|v| v.as_object()) {
        for (id, asset) in obj {
            collect_asset_ref_path(
                out,
                asset,
                &format!("videos.{id}"),
                &["thumbnail", "poster"],
            );
        }
    }

    if let Some(obj) = manifest.get("fonts").and_then(|v| v.as_object()) {
        for (id, asset) in obj {
            if let Some(path) = asset.get("path").and_then(|v| v.as_str()) {
                out.push((path.to_string(), format!("fonts.{id}.path")));
            }
        }
    }

    if let Some(obj) = manifest.get("uiSkins").and_then(|v| v.as_object()) {
        for (id, skin) in obj {
            if let Some(assets) = skin.get("assets").and_then(|v| v.as_object()) {
                for (asset_key, value) in assets {
                    let Some(value) = value.as_str() else {
                        continue;
                    };
                    let source = format!("uiSkins.{id}.assets.{asset_key}");
                    match asset_key.as_str() {
                        // Spec 21 §6 约定键：value 是注册表资产 id。
                        "titleBackground" => resolve_uiskin_convention_id(
                            &mut refs,
                            manifest,
                            &["backgrounds"],
                            value,
                            &source,
                        ),
                        "titleBgm" => resolve_uiskin_convention_id(
                            &mut refs,
                            manifest,
                            &["audio", "bgm"],
                            value,
                            &source,
                        ),
                        // 其它键的 id 语义尚未文档化：保持 content 相对路径语义。
                        _ => refs.declared.push((value.to_string(), source)),
                    }
                }
            }
        }
    }

    if let Some(obj) = manifest.get("animationAtlases").and_then(|v| v.as_object()) {
        for (id, atlas) in obj {
            if let Some(path) = atlas.get("image").and_then(|v| v.as_str()) {
                refs.declared
                    .push((path.to_string(), format!("animationAtlases.{id}.image")));
            }
            if let Some(path) = atlas.get("json").and_then(|v| v.as_str()) {
                refs.declared
                    .push((path.to_string(), format!("animationAtlases.{id}.json")));
            }
        }
    }

    refs
}

fn collect_asset_ref_path(
    out: &mut Vec<(String, String)>,
    value: &serde_json::Value,
    source: &str,
    extra_string_fields: &[&str],
) {
    if let Some(path) = value.as_str() {
        out.push((path.to_string(), format!("{source}.path")));
        return;
    }

    let Some(obj) = value.as_object() else {
        return;
    };

    if let Some(path) = obj.get("path").and_then(|v| v.as_str()) {
        out.push((path.to_string(), format!("{source}.path")));
    }
    for field in extra_string_fields {
        if let Some(path) = obj.get(*field).and_then(|v| v.as_str()) {
            out.push((path.to_string(), format!("{source}.{field}")));
        }
    }
}

/// 校验资产一致性：磁盘文件 ↔ manifest 声明。
/// - missing_asset (error)：manifest 声明了但磁盘文件不存在（悬空引用）
/// - unknown_asset_id (error)：uiSkin 约定键（titleBackground/titleBgm）引用了
///   注册表中不存在的资产 id（Spec 21 §6 的 id 语义）
/// - orphan_asset (error)：磁盘有文件但 manifest 没登记（剧本引用不到）
/// - duplicate_asset_ref (warn)：同一文件被多个 manifest 条目声明
pub fn validate_assets(
    disk_entries: &[AssetEntry],
    manifest: &serde_json::Value,
) -> Vec<GraphIssue> {
    let mut issues = vec![];
    let mut disk_paths: std::collections::HashSet<String> =
        disk_entries.iter().map(|e| e.rel_path.clone()).collect();

    // manifest 声明的路径；uiSkin 约定键经注册表 id 解析，未知 id 直接成 issue。
    let refs = collect_manifest_asset_paths(manifest);
    let declared = refs.declared;
    issues.extend(refs.id_issues);

    // 1. 悬空引用 + 重复声明检测
    let mut seen_path_to_sources: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for (path, source) in &declared {
        let normalized = path.replace('\\', "/");
        seen_path_to_sources
            .entry(normalized.clone())
            .or_default()
            .push(source.clone());

        if !disk_paths.remove(&normalized) {
            // remove 返回 false：要么根本不存在（悬空），要么该路径已被消费过（重复）
            if !disk_entries.iter().any(|e| e.rel_path == normalized) {
                // 文件确实不在磁盘上
                issues.push(GraphIssue {
                    severity: GraphIssueSeverity::Error,
                    code: "missing_asset".to_string(),
                    message: format!(
                        "manifest 声明了资源但文件不存在：{}（{}）",
                        normalized, source
                    ),
                    file: Some(format!("content/{}", normalized)),
                    json_path: Some(format!("$.{source}")),
                    node_id: None,
                    edge_id: None,
                });
            }
        }
    }

    // 重复声明：同一文件被多个 manifest 条目引用。uiSkin 约定键经 id 解析的
    // 来源是注册表条目的别名，不参与计数（皮肤按 id 引用背景/BGM 是预期用法）。
    for (path, sources) in &seen_path_to_sources {
        let mut real_sources: Vec<String> = sources
            .iter()
            .filter(|source| !refs.convention_sources.contains(*source))
            .cloned()
            .collect();
        if real_sources.len() > 1 {
            real_sources.sort();
            issues.push(GraphIssue {
                severity: GraphIssueSeverity::Warn,
                code: "duplicate_asset_ref".to_string(),
                message: format!(
                    "资源被多个 manifest 条目引用：{}（{}）",
                    path,
                    real_sources.join(", ")
                ),
                file: Some(format!("content/{}", path)),
                json_path: None,
                node_id: None,
                edge_id: None,
            });
        }
    }

    // 2. 孤儿文件：disk_paths 经过上面的 remove 后，剩下的就是没被任何 manifest 声明的
    let mut orphans: Vec<String> = disk_paths.into_iter().collect();
    orphans.sort();
    for orphan in orphans {
        issues.push(GraphIssue {
            severity: GraphIssueSeverity::Error,
            code: "orphan_asset".to_string(),
            message: format!("磁盘文件未被 manifest 登记剧本无法引用：{}", orphan),
            file: Some(format!("content/{}", orphan)),
            json_path: None,
            node_id: None,
            edge_id: None,
        });
    }

    issues
}

// ──────────────────────────────────────────────
// manifest 结构校验（对应前端 Zod 的 .strict()）
// 非阻断：不阻止项目加载，问题进 projectReport。
// ──────────────────────────────────────────────
use super::super::model::{AssetEntry, GraphIssue, GraphIssueSeverity};
