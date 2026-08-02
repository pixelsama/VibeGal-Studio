//! `vibegal-cli mcp`：以 stdio MCP（Model Context Protocol）服务暴露项目工具。
//!
//! 设计约束：
//! - 传输层是 NDJSON（每行一个 JSON-RPC 消息），不引入任何新依赖；
//! - 工具层只是既有能力的薄壳：validate 走 `app_lib::open_project_for_cli`，
//!   节点写入走 `validate_node_for_cli` + `assign_missing_story_point_ids`
//!   + `save_node_for_cli`（与 Studio/CLI 同一套契约与身份分配逻辑）；
//! - 资源层把项目内 `.galstudio/` 自描述文件（README / 契约 / schemas）
//!   暴露给 Agent 阅读，信息单一源仍在项目文件里。
//!
//! 首版只读图不写图：graph.json 的结构性修改留待后续 graph_write 工具。

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

pub(crate) fn run_mcp_server() -> i32 {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        if let Some(response) = handle_mcp_line(&line) {
            if writeln!(out, "{response}").is_err() {
                return 1;
            }
            let _ = out.flush();
        }
    }
    0
}

// ---------------------------------------------------------------------------
// JSON-RPC 分发
// ---------------------------------------------------------------------------

fn handle_mcp_line(line: &str) -> Option<String> {
    let request: Value = serde_json::from_str(line).ok()?;
    if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return None;
    }
    let method = request.get("method").and_then(Value::as_str)?;
    let id = request.get("id").cloned();
    match method {
        "initialize" => id.map(|id| {
            result(
                id,
                json!({
                    "protocolVersion": request
                        .get("params")
                        .and_then(|params| params.get("protocolVersion"))
                        .and_then(Value::as_str)
                        .unwrap_or("2024-11-05"),
                    "capabilities": { "tools": {}, "resources": {} },
                    "serverInfo": {
                        "name": "vibegal",
                        "version": env!("CARGO_PKG_VERSION"),
                        "title": "VibeGal-Studio 项目工具",
                    },
                    "instructions": "VibeGal-Studio galgame 项目工具。项目为 graph-first 数据：content/graph.json 是图的唯一事实来源，每个节点指向 content/nodes/*.json 的 Instruction[]。修改节点正文用 node_write；结构问题用 project_validate 检查。完整契约见 vibegal://readme 与 vibegal://schemas/* 资源。",
                })
                .to_string(),
            )
        }),
        "notifications/initialized" | "notifications/cancelled" | "initialized" => None,
        "ping" => id.map(|id| result(id, json!({}).to_string())),
        "tools/list" => id.map(|id| result(id, tools_list().to_string())),
        "tools/call" => id.map(|id| call_tool(id, request.get("params"))),
        "resources/list" => id.map(|id| result(id, resources_list().to_string())),
        "resources/read" => id.map(|id| read_resource(id, request.get("params"))),
        _ => id.map(|id| error(id, -32601, &format!("method not found: {method}"))),
    }
}

fn result(id: Value, result_json: String) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": serde_json::from_str::<Value>(&result_json).unwrap_or(Value::Null) }).to_string()
}

fn error(id: Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

fn tools_list() -> Value {
    let mut list = json!({
        "tools": [
            {
                "name": "project_validate",
                "description": "校验 VibeGal-Studio 项目（图结构 / 资产引用 / 项目完整性），返回结构化问题列表。issues 为空即通过。修改文件后应重新调用确认。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "项目根目录（含 gal.project.json）" }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "graph_read",
                "description": "读取 content/graph.json 原文。graph.json 是图的唯一事实来源：chapters[] 声明章节，nodes[] 声明节点（每个节点必须归属一个已声明章节），edges[] 声明流转。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "项目根目录" }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "nodes_list",
                "description": "列出图中全部节点的 id / 标题 / 正文文件 / 所属章节。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "项目根目录" }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "node_read",
                "description": "读取一个节点的正文（content/nodes/*.json，Instruction[]）。nodeId 与 file 二选一。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "项目根目录" },
                        "nodeId": { "type": "string", "description": "graph.json 中的节点 id" },
                        "file": { "type": "string", "description": "相对 content/ 的节点文件路径，如 nodes/start.json" }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "node_write",
                "description": "覆盖写入一个已存在节点的正文（Instruction[]）。只允许写 graph.json 中已声明的节点——graph 是唯一事实来源，新增/删除节点或连线需要修改 graph.json（当前请提示用户在 Studio 图编辑中操作）。写入后会自动补齐 instruction 身份 id 并重新校验，返回最新问题列表。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "项目根目录" },
                        "nodeId": { "type": "string", "description": "graph.json 中的节点 id" },
                        "file": { "type": "string", "description": "相对 content/ 的节点文件路径，如 nodes/start.json" },
                        "instructions": { "type": "array", "description": "Instruction[] 正文，结构见 vibegal://schemas/nodeFile" }
                    },
                    "required": ["path", "instructions"],
                    "additionalProperties": false
                }
            }
        ]
    });
    // MCP 工具注解（2025-06-18）：codex 等客户端据此决定沙箱下的可调用性，
    // 缺注解会被保守地当作「会改文件」而在 read-only 沙箱里直接取消。
    if let Some(tools) = list.get_mut("tools").and_then(Value::as_array_mut) {
        for tool in tools {
            let name = tool.get("name").and_then(Value::as_str).unwrap_or("");
            let annotations = match name {
                "node_write" => json!({
                    "title": "写入节点正文",
                    "readOnlyHint": false,
                    "destructiveHint": false,
                    "idempotentHint": true,
                    "openWorldHint": false
                }),
                _ => json!({
                    "readOnlyHint": true,
                    "destructiveHint": false,
                    "idempotentHint": true,
                    "openWorldHint": false
                }),
            };
            if let Some(object) = tool.as_object_mut() {
                object.insert("annotations".to_string(), annotations);
            }
        }
    }
    list
}

// ---------------------------------------------------------------------------
// tools/call
// ---------------------------------------------------------------------------

fn call_tool(id: Value, params: Option<&Value>) -> String {
    let Some(params) = params else {
        return error(id, -32602, "tools/call 缺少 params");
    };
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let outcome = match name {
        "project_validate" => tool_project_validate(&args),
        "graph_read" => tool_graph_read(&args),
        "nodes_list" => tool_nodes_list(&args),
        "node_read" => tool_node_read(&args),
        "node_write" => tool_node_write(&args),
        _ => Err(format!("未知工具: {name}")),
    };
    match outcome {
        Ok(payload) => result(
            id,
            json!({
                "content": [{ "type": "text", "text": serde_json::to_string_pretty(&payload).unwrap_or_default() }],
            })
            .to_string(),
        ),
        Err(message) => result(
            id,
            json!({
                "content": [{ "type": "text", "text": message }],
                "isError": true,
            })
            .to_string(),
        ),
    }
}

fn required_path(args: &Value) -> Result<&str, String> {
    args.get("path")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "缺少必填参数 path（项目根目录）".to_string())
}

fn read_project_file(project_path: &str, rel: &str) -> Result<Value, String> {
    let full = Path::new(project_path).join(rel);
    let text = std::fs::read_to_string(&full)
        .map_err(|error| format!("读取 {rel} 失败: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("解析 {rel} 失败: {error}"))
}

fn tool_project_validate(args: &Value) -> Result<Value, String> {
    let path = required_path(args)?;
    match app_lib::open_project_for_cli(path) {
        Ok(project) => {
            let graph_issues: Vec<app_lib::GraphIssue> = project
                .graph_report
                .map(|report| report.graph_issues)
                .unwrap_or_default();
            let asset_issues: Vec<app_lib::GraphIssue> = project
                .asset_report
                .map(|report| report.asset_issues)
                .unwrap_or_default();
            let project_issues: Vec<app_lib::ProjectIssue> = project
                .project_report
                .map(|report| report.project_issues)
                .unwrap_or_default();
            Ok(json!({
                "ok": project_issues.is_empty(),
                "projectPath": path,
                "projectIssues": project_issues,
                "graphIssues": graph_issues,
                "assetIssues": asset_issues,
            }))
        }
        Err(message) => Ok(json!({
            "ok": false,
            "projectPath": path,
            "projectIssues": [{
                "severity": "error",
                "code": "open_project_failed",
                "message": message,
            }],
            "graphIssues": [],
            "assetIssues": [],
        })),
    }
}

fn tool_graph_read(args: &Value) -> Result<Value, String> {
    read_project_file(required_path(args)?, "content/graph.json")
}

fn graph_nodes(graph: &Value) -> Vec<Value> {
    graph
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn resolve_node_file(graph: &Value, args: &Value) -> Result<(String, Option<String>), String> {
    let nodes = graph_nodes(graph);
    if let Some(node_id) = args.get("nodeId").and_then(Value::as_str) {
        let node = nodes
            .iter()
            .find(|node| node.get("id").and_then(Value::as_str) == Some(node_id))
            .ok_or_else(|| format!("graph.json 中不存在节点: {node_id}"))?;
        let file = node
            .get("file")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("节点 {node_id} 缺少 file 字段"))?;
        return Ok((file.to_string(), Some(node_id.to_string())));
    }
    if let Some(file) = args.get("file").and_then(Value::as_str) {
        let node_id = nodes
            .iter()
            .find(|node| node.get("file").and_then(Value::as_str) == Some(file))
            .and_then(|node| node.get("id").and_then(Value::as_str))
            .map(str::to_string);
        return Ok((file.to_string(), node_id));
    }
    Err("nodeId 与 file 必须提供一个".to_string())
}

fn tool_nodes_list(args: &Value) -> Result<Value, String> {
    let graph = read_project_file(required_path(args)?, "content/graph.json")?;
    let nodes = graph_nodes(&graph)
        .iter()
        .map(|node| {
            json!({
                "id": node.get("id"),
                "title": node.get("title"),
                "file": node.get("file"),
                "chapterId": node.get("chapterId"),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "nodes": nodes }))
}

fn tool_node_read(args: &Value) -> Result<Value, String> {
    let path = required_path(args)?;
    let graph = read_project_file(path, "content/graph.json")?;
    let (file, node_id) = resolve_node_file(&graph, args)?;
    let instructions = read_project_file(path, &format!("content/{file}"))?;
    Ok(json!({ "nodeId": node_id, "file": file, "instructions": instructions }))
}

fn tool_node_write(args: &Value) -> Result<Value, String> {
    let path = required_path(args)?;
    let instructions = args
        .get("instructions")
        .cloned()
        .ok_or_else(|| "缺少必填参数 instructions（Instruction[]）".to_string())?;
    if !instructions.is_array() {
        return Err("instructions 必须是数组（Instruction[]）".to_string());
    }
    let graph = read_project_file(path, "content/graph.json")?;
    let (file, node_id) = resolve_node_file(&graph, args)?;
    // graph-first 约束：只允许写入 graph.json 已声明的节点文件
    let declared = graph_nodes(&graph)
        .iter()
        .any(|node| node.get("file").and_then(Value::as_str) == Some(file.as_str()));
    if !declared {
        return Err(format!(
            "{file} 未在 graph.json 中声明。新增节点请先让用户在 Studio 图编辑中创建。"
        ));
    }

    app_lib::validate_node_for_cli(&instructions)
        .map_err(|message| format!("Instruction[] 契约校验失败: {message}"))?;

    let rel_path = format!("content/{file}");
    let context = app_lib::InstructionIdentityContext::new(
        &rel_path,
        node_id.as_deref().unwrap_or(""),
    );
    let assigned = app_lib::assign_missing_story_point_ids(&instructions, &context)
        .map_err(|error| format!("补齐 instruction 身份 id 失败: {error}"))?;
    app_lib::save_node_for_cli(path, &file, assigned.node, None)
        .map_err(|message| format!("写入节点失败: {message}"))?;

    // 写后复检，把最新问题直接喂回 Agent
    let validation = tool_project_validate(&json!({ "path": path }))?;
    Ok(json!({
        "ok": true,
        "nodeId": node_id,
        "file": file,
        "assignedInstructionIds": assigned.assigned,
        "validation": validation,
    }))
}

// ---------------------------------------------------------------------------
// resources（项目内 .galstudio/ 自描述文件，信息单一源仍在项目文件里）
// ---------------------------------------------------------------------------

const SCHEMA_NAMES: [&str; 7] = [
    "graph",
    "nodeFile",
    "manifest",
    "meta",
    "fixture",
    "variables",
    "locale",
];

fn resources_list() -> Value {
    let mut resources = vec![
        json!({
            "uri": "vibegal://readme",
            "name": "项目自描述（.galstudio/README.md）",
            "mimeType": "text/markdown",
            "description": "VibeGal-Studio 项目的总体数据契约与文件布局说明",
        }),
        json!({
            "uri": "vibegal://renderer-contract",
            "name": "渲染层契约（.galstudio/renderer-contract.md）",
            "mimeType": "text/markdown",
            "description": "renderer 层的 index.tsx 入口与引擎类型契约",
        }),
    ];
    for name in SCHEMA_NAMES {
        resources.push(json!({
            "uri": format!("vibegal://schemas/{name}"),
            "name": format!("Schema: {name}"),
            "mimeType": "application/json",
            "description": format!("content/{name} 的 JSON Schema（.galstudio/schemas/{name}.json）"),
        }));
    }
    json!({ "resources": resources })
}

fn resolve_project_root() -> PathBuf {
    // MCP server 由 Agent 以项目根为 cwd 启动
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn read_resource(id: Value, params: Option<&Value>) -> String {
    let payload = (|| -> Result<Value, String> {
        let uri = params
            .and_then(|params| params.get("uri"))
            .and_then(Value::as_str)
            .ok_or_else(|| "resources/read 缺少 uri".to_string())?;
        let rel = match uri {
            "vibegal://readme" => ".galstudio/README.md".to_string(),
            "vibegal://renderer-contract" => ".galstudio/renderer-contract.md".to_string(),
            _ => {
                let name = uri
                    .strip_prefix("vibegal://schemas/")
                    .ok_or_else(|| format!("未知资源: {uri}"))?;
                if !SCHEMA_NAMES.contains(&name) {
                    return Err(format!("未知 schema 资源: {uri}"));
                }
                format!(".galstudio/schemas/{name}.json")
            }
        };
        let full = resolve_project_root().join(&rel);
        let text = std::fs::read_to_string(&full)
            .map_err(|error| format!("读取 {rel} 失败（MCP server 是否以项目根为 cwd 启动？）: {error}"))?;
        Ok(json!({
            "contents": [{
                "uri": uri,
                "mimeType": if rel.ends_with(".json") { "application/json" } else { "text/markdown" },
                "text": text,
            }]
        }))
    })();
    match payload {
        Ok(value) => result(id, value.to_string()),
        Err(message) => error(id, -32602, &message),
    }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "vibegal-mcp-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn write_text(path: &Path, text: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, text).unwrap();
    }

    fn make_project(root: &Path) {
        write_text(
            &root.join("gal.project.json"),
            r#"{"name":"T","activeRendererId":"default","createdAt":"0"}"#,
        );
        write_text(
            &root.join("content/manifest.json"),
            r#"{"characters":{},"backgrounds":{},"audio":{"bgm":{},"sfx":{},"voice":{}}}"#,
        );
        write_text(
            &root.join("content/meta.json"),
            r#"{"title":"T","typingSpeedCps":30,"autoAdvanceMs":1200,"chapterGapMs":1500}"#,
        );
        write_text(
            &root.join("content/graph.json"),
            r#"{"version":1,"entryNodeId":"start","chapters":[{"id":"chapter_1","title":"第一章"}],"nodes":[{"id":"start","title":"开始","file":"nodes/start.json","chapterId":"chapter_1","position":{"x":0,"y":0}}],"edges":[]}"#,
        );
        write_text(
            &root.join("content/nodes/start.json"),
            r#"[{"t":"narrate","text":"start"}]"#,
        );
        write_text(
            &root.join("renderers/default/index.tsx"),
            r#"export default { id: "default", name: "Default", contractVersion: 1, Component: () => null };"#,
        );
    }

    fn request_line(id: i64, method: &str, params: Value) -> String {
        json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string()
    }

    fn response_result(line: &str) -> Value {
        let response: Value = serde_json::from_str(line).unwrap();
        assert!(response.get("error").is_none(), "unexpected error: {response}");
        response.get("result").cloned().unwrap()
    }

    #[test]
    fn initialize_advertises_tools_and_resources() {
        let response = handle_mcp_line(&request_line(
            1,
            "initialize",
            json!({ "protocolVersion": "2024-11-05", "clientInfo": { "name": "test" } }),
        ))
        .expect("initialize must respond");
        let result = response_result(&response);
        assert_eq!(result["serverInfo"]["name"], "vibegal");
        assert!(result["capabilities"]["tools"].is_object());
        assert!(result["capabilities"]["resources"].is_object());
    }

    #[test]
    fn notifications_are_not_answered() {
        assert!(handle_mcp_line(
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string()
        )
        .is_none());
        assert!(handle_mcp_line("not json").is_none());
    }

    #[test]
    fn tools_list_describes_the_authoring_surface() {
        let response = handle_mcp_line(&request_line(2, "tools/list", json!({}))).unwrap();
        let result = response_result(&response);
        let names = result["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            ["project_validate", "graph_read", "nodes_list", "node_read", "node_write"]
        );
        // 工具描述必须内嵌 graph-first 契约，Agent 不读文档也不能越界
        let node_write = result["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "node_write")
            .unwrap();
        assert!(node_write["description"].as_str().unwrap().contains("graph.json 中已声明"));
    }

    #[test]
    fn validate_reports_error_free_project_and_missing_project() {
        let root = unique_temp_dir("validate");
        make_project(&root);
        let ok_response = handle_mcp_line(&request_line(
            3,
            "tools/call",
            json!({ "name": "project_validate", "arguments": { "path": root.to_string_lossy() } }),
        ))
        .unwrap();
        let result = response_result(&ok_response);
        let text = result["content"][0]["text"].as_str().unwrap();
        let payload: Value = serde_json::from_str(text).unwrap();
        // 最小夹具可能带 warn 级问题（缺辅助文件），但不能有 error 级
        for key in ["projectIssues", "graphIssues", "assetIssues"] {
            let issues = payload[key].as_array().cloned().unwrap_or_default();
            let has_error = issues
                .iter()
                .any(|issue| issue["severity"] == "error");
            assert!(!has_error, "{key} 不应有 error 级问题: {issues:?}");
        }
        assert!(result.get("isError").is_none());

        let missing = handle_mcp_line(&request_line(
            4,
            "tools/call",
            json!({ "name": "project_validate", "arguments": { "path": root.join("nope").to_string_lossy() } }),
        ))
        .unwrap();
        let result = response_result(&missing);
        let payload: Value =
            serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(payload["ok"], false);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn node_read_resolves_by_id_and_file() {
        let root = unique_temp_dir("read");
        make_project(&root);
        let path = root.to_string_lossy().to_string();
        for arguments in [
            json!({ "path": path, "nodeId": "start" }),
            json!({ "path": path, "file": "nodes/start.json" }),
        ] {
            let response = handle_mcp_line(&request_line(
                5,
                "tools/call",
                json!({ "name": "node_read", "arguments": arguments }),
            ))
            .unwrap();
            let result = response_result(&response);
            let payload: Value =
                serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
            assert_eq!(payload["file"], "nodes/start.json");
            assert_eq!(payload["instructions"][0]["t"], "narrate");
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn node_write_assigns_ids_and_revalidates() {
        let root = unique_temp_dir("write");
        make_project(&root);
        let path = root.to_string_lossy().to_string();
        let response = handle_mcp_line(&request_line(
            6,
            "tools/call",
            json!({
                "name": "node_write",
                "arguments": {
                    "path": path,
                    "nodeId": "start",
                    "instructions": [
                        { "t": "narrate", "text": "改写后的开场。" },
                        { "t": "narrate", "text": "第二句。" }
                    ]
                }
            }),
        ))
        .unwrap();
        let result = response_result(&response);
        let payload: Value =
            serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(payload["ok"], true);
        // 复检结果不能含 error 级问题（夹具的 warn 级辅助文件提醒是允许的）
        let has_error = payload["validation"]["projectIssues"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .any(|issue| issue["severity"] == "error");
        assert!(!has_error);

        // 落盘内容：身份 id 已补齐，文本已更新
        let written = read_project_file(&path, "content/nodes/start.json").unwrap();
        assert_eq!(written[0]["text"], "改写后的开场。");
        assert!(written[0]["spId"].is_string() || written[0]["id"].is_string());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn node_write_rejects_undeclared_files_and_bad_instructions() {
        let root = unique_temp_dir("write-guard");
        make_project(&root);
        let path = root.to_string_lossy().to_string();
        let response = handle_mcp_line(&request_line(
            7,
            "tools/call",
            json!({
                "name": "node_write",
                "arguments": {
                    "path": path,
                    "file": "nodes/ghost.json",
                    "instructions": [{ "t": "narrate", "text": "x" }]
                }
            }),
        ))
        .unwrap();
        let result: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(result["result"]["isError"], true);
        assert!(result["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("未在 graph.json 中声明"));

        let response = handle_mcp_line(&request_line(
            8,
            "tools/call",
            json!({
                "name": "node_write",
                "arguments": { "path": path, "nodeId": "start", "instructions": { "nope": true } }
            }),
        ))
        .unwrap();
        let result: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(result["result"]["isError"], true);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn unknown_tool_is_an_error_result_not_protocol_error() {
        let response = handle_mcp_line(&request_line(
            9,
            "tools/call",
            json!({ "name": "rm_rf", "arguments": {} }),
        ))
        .unwrap();
        let result: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(result["result"]["isError"], true);
    }

    #[test]
    fn schema_resources_are_whitelisted() {
        let response = handle_mcp_line(&request_line(10, "resources/list", json!({}))).unwrap();
        let result = response_result(&response);
        let uris = result["resources"]
            .as_array()
            .unwrap()
            .iter()
            .map(|resource| resource["uri"].as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        assert!(uris.contains(&"vibegal://readme".to_string()));
        assert!(uris.contains(&"vibegal://schemas/graph".to_string()));
        assert!(uris.contains(&"vibegal://schemas/nodeFile".to_string()));

        let bad = handle_mcp_line(&request_line(
            11,
            "resources/read",
            json!({ "uri": "vibegal://schemas/../../etc/passwd" }),
        ))
        .unwrap();
        let response: Value = serde_json::from_str(&bad).unwrap();
        assert!(response.get("error").is_some());
    }
}
