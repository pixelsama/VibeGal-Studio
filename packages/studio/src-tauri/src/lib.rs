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

    // 章节加载顺序：优先遵循 meta.chapters 契约（决定加载哪些 + 顺序）；
    // 仅当 meta 没声明 chapters 时，才 fallback 到扫描 chapters/ 目录。
    let mut chapters = vec![];
    let meta_chapters: Vec<String> = meta_json
        .get("chapters")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    if !meta_chapters.is_empty() {
        // 按 meta 声明的顺序逐个读取（meta 里写的是相对 content 根的路径，如 "chapters/ch01.json"）
        for rel in &meta_chapters {
            let path = content_dir.join(rel);
            if path.exists() {
                let data = read_json(&path)?;
                chapters.push(ChapterEntry { rel_path: rel.clone(), data });
            } else {
                log::warn!("meta.chapters 声明了 {} 但文件不存在，已跳过", rel);
            }
        }
    } else {
        // fallback：扫描 chapters/ 目录（草稿/废弃文件也会被载入，仅为兼容）
        let chapters_dir = content_dir.join("chapters");
        if chapters_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&chapters_dir) {
                let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
                paths.sort();
                for p in paths {
                    if p.extension().and_then(|e| e.to_str()) == Some("json") {
                        let rel = p
                            .strip_prefix(&content_dir)
                            .unwrap_or(&p)
                            .to_string_lossy()
                            .replace('\\', "/");
                        let data = read_json(&p)?;
                        chapters.push(ChapterEntry { rel_path: rel, data });
                    }
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
    // 校验项目名：只允许文件名片段，禁止路径分隔符与 ..
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name == ".."
        || name == "."
        || name.contains('\0')
    {
        return Err(format!("非法项目名: {:?}", name));
    }
    let project_path = Path::new(&parent_dir).join(&name);
    if project_path.exists() {
        return Err(format!("目录已存在: {}", project_path.display()));
    }
    // 进一步确保 project_path 规范化后仍在 parent_dir 内
    ensure_within(Path::new(&parent_dir), &project_path)?;

    // 创建目录骨架（资源放在 content/assets/，与 manifest 的相对路径解析契约一致）
    fs::create_dir_all(project_path.join("content/chapters"))
        .map_err(|e| format!("创建 content/chapters 失败: {}", e))?;
    fs::create_dir_all(project_path.join("content/assets"))
        .map_err(|e| format!("创建 content/assets 失败: {}", e))?;
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

/// 保存单个文件（相对项目根的路径）。校验目标必须在项目目录内。
#[tauri::command]
fn save_file(project_path: String, rel_path: String, content: String) -> Result<(), String> {
    let project_root = Path::new(&project_path);
    let target = project_root.join(&rel_path);
    let safe_target = ensure_within(project_root, &target)?;
    if let Some(parent) = safe_target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&safe_target, content).map_err(|e| format!("写文件失败 ({}): {}", safe_target.display(), e))
}

/// 更新 gal.project.json
#[tauri::command]
fn save_project_meta(project_path: String, meta: ProjectMeta) -> Result<(), String> {
    write_json(&Path::new(&project_path).join("gal.project.json"), &serde_json::to_value(&meta).unwrap())
}

// ── 工具函数 ──────────────────────────────────────

/// 安全校验：确保 target 路径规范化后仍位于 base 目录内，防止 `../` 或绝对路径穿越。
/// 对 base 与 target 都 canonicalize 后做 starts_with 校验。
fn ensure_within(base: &Path, target: &Path) -> Result<PathBuf, String> {
    let base_canon = base.canonicalize()
        .map_err(|e| format!("无法定位基准目录 {}: {}", base.display(), e))?;
    // target 可能尚不存在（如待写的文件），canonicalize 其【父目录】再拼回文件名
    let target_canon = match target.canonicalize() {
        Ok(t) => t,
        Err(_) => {
            // 父目录必须存在，否则报错
            let parent = target.parent().unwrap_or(Path::new("."));
            let parent_canon = parent.canonicalize()
                .map_err(|e| format!("无法定位目标父目录 {}: {}", parent.display(), e))?;
            parent_canon.join(target.file_name().unwrap_or_default())
        }
    };
    if !target_canon.starts_with(&base_canon) {
        return Err(format!(
            "路径越界：{} 不在项目目录 {} 内（可能的路径穿越攻击）",
            target.display(), base.display()
        ));
    }
    Ok(target_canon)
}

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
