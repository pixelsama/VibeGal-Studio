// GalStudio Tauri 后端 —— 文件系统操作。
// 所有磁盘读写集中在这里；前端通过 invoke 调用，不直接碰文件系统。

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectMeta {
    pub name: String,
    #[serde(rename = "activeRendererId")]
    pub active_renderer_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Serialize, Clone)]
pub struct ProjectListItem {
    pub path: String,
    pub meta: ProjectMeta,
}

#[derive(Serialize, Clone)]
pub struct ChapterEntry {
    #[serde(rename = "relPath")]
    pub rel_path: String,
    pub data: serde_json::Value,
}

#[derive(Serialize, Clone)]
pub struct ProjectContent {
    pub manifest: serde_json::Value,
    pub meta: serde_json::Value,
    pub chapters: Vec<ChapterEntry>,
}

#[derive(Serialize, Clone)]
pub struct ProjectData {
    pub path: String,
    pub meta: ProjectMeta,
    pub content: ProjectContent,
    #[serde(rename = "rendererIds")]
    pub renderer_ids: Vec<String>,
}

fn read_project_meta(project_path: &Path) -> Result<ProjectMeta, String> {
    let meta_file = project_path.join("gal.project.json");
    let text = fs::read_to_string(&meta_file)
        .map_err(|e| format!("读取 gal.project.json 失败 ({}): {}", meta_file.display(), e))?;
    serde_json::from_str::<ProjectMeta>(&text)
        .map_err(|e| format!("解析 gal.project.json 失败: {}", e))
}

/// 列出工作区目录下的所有项目（含 gal.project.json 的直接子目录）
#[tauri::command]
fn list_projects(workspace_dir: String) -> Result<Vec<ProjectListItem>, String> {
    let root = Path::new(&workspace_dir);
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut items = vec![];
    let entries = fs::read_dir(root).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join("gal.project.json").exists() {
            if let Ok(meta) = read_project_meta(&path) {
                items.push(ProjectListItem {
                    path: path.to_string_lossy().into_owned(),
                    meta,
                });
            }
        }
    }
    Ok(items)
}

/// 读取项目内 renderers/ 子目录名
fn list_renderer_ids(project_path: &Path) -> Vec<String> {
    let renderers_dir = project_path.join("renderers");
    if !renderers_dir.is_dir() {
        return vec![];
    }
    let mut ids = vec![];
    if let Ok(entries) = fs::read_dir(&renderers_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            // 一个渲染层 = 含 index.tsx 的子目录
            if p.is_dir() && p.join("index.tsx").exists() {
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    ids.push(name.to_string());
                }
            }
        }
    }
    ids
}

/// 打开项目：读 gal.project.json + content + 渲染层列表
#[tauri::command]
fn open_project(path: String) -> Result<ProjectData, String> {
    let project_path = Path::new(&path);
    let meta = read_project_meta(project_path)?;

    let content_dir = project_path.join("content");
    let manifest = read_json(&content_dir.join("manifest.json"))?;
    let meta_json = read_json(&content_dir.join("meta.json"))?;

    let mut chapters = vec![];
    let chapters_dir = content_dir.join("chapters");
    if chapters_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&chapters_dir) {
            let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
            paths.sort();
            for p in paths {
                if p.extension().and_then(|e| e.to_str()) == Some("json") {
                    let rel = p
                        .strip_prefix(project_path)
                        .unwrap_or(&p)
                        .to_string_lossy()
                        .replace('\\', "/");
                    let data = read_json(&p)?;
                    chapters.push(ChapterEntry { rel_path: rel, data });
                }
            }
        }
    }

    let renderer_ids = list_renderer_ids(project_path);

    Ok(ProjectData {
        path: path.clone(),
        meta,
        content: ProjectContent {
            manifest,
            meta: meta_json,
            chapters,
        },
        renderer_ids,
    })
}

/// 在 parent_dir 下创建新项目：建目录结构 + 复制默认渲染层模板 + 写 gal.project.json
#[tauri::command]
fn create_project(parent_dir: String, name: String, app_handle: tauri::AppHandle) -> Result<ProjectData, String> {
    let project_path = Path::new(&parent_dir).join(&name);
    if project_path.exists() {
        return Err(format!("目录已存在: {}", project_path.display()));
    }

    // 创建目录骨架
    fs::create_dir_all(project_path.join("content/chapters"))
        .map_err(|e| format!("创建 content 失败: {}", e))?;
    fs::create_dir_all(project_path.join("assets"))
        .map_err(|e| format!("创建 assets 失败: {}", e))?;
    fs::create_dir_all(project_path.join("renderers/default"))
        .map_err(|e| format!("创建 renderers/default 失败: {}", e))?;

    // 写最小 manifest / meta
    let manifest = serde_json::json!({
        "characters": {},
        "backgrounds": {},
        "audio": {}
    });
    write_json(&project_path.join("content/manifest.json"), &manifest)?;

    let meta = serde_json::json!({
        "title": &name,
        "chapters": [],
        "typingSpeedCps": 30,
        "autoAdvanceMs": 1200,
        "chapterGapMs": 1500
    });
    write_json(&project_path.join("content/meta.json"), &meta)?;

    // 复制默认渲染层模板（从打包的 app resource）
    let default_renderer_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("获取 resource_dir 失败: {}", e))?
        .join("resources/default-renderer");
    copy_dir_all(&default_renderer_dir, &project_path.join("renderers/default"))
        .map_err(|e| format!("复制渲染层模板失败: {}", e))?;

    let project_meta = ProjectMeta {
        name: name.clone(),
        active_renderer_id: "default".to_string(),
        created_at: chrono_now(),
    };
    write_json(&project_path.join("gal.project.json"), &serde_json::to_value(&project_meta).unwrap())?;

    // 重新读出来返回
    open_project(project_path.to_string_lossy().into_owned())
}

/// 保存单个文件（相对项目根的路径）
#[tauri::command]
fn save_file(project_path: String, rel_path: String, content: String) -> Result<(), String> {
    let target = Path::new(&project_path).join(&rel_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&target, content).map_err(|e| format!("写文件失败 ({}): {}", target.display(), e))
}

/// 更新 gal.project.json
#[tauri::command]
fn save_project_meta(project_path: String, meta: ProjectMeta) -> Result<(), String> {
    write_json(&Path::new(&project_path).join("gal.project.json"), &serde_json::to_value(&meta).unwrap())
}

// ── 工具函数 ──────────────────────────────────────

fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    let text = fs::read_to_string(path)
        .map_err(|e| format!("读取失败 ({}): {}", path.display(), e))?;
    serde_json::from_str(&text).map_err(|e| format!("解析 JSON 失败 ({}): {}", path.display(), e))
}

fn write_json(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, text).map_err(|e| format!("写文件失败 ({}): {}", path.display(), e))
}

fn chrono_now() -> String {
    // 简单的 RFC3339 风格时间戳，避免引入 chrono 依赖
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs)
}

/// 递归复制目录
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            open_project,
            create_project,
            save_file,
            save_project_meta,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
