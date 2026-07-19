//! Generic lightweight desktop player.
//!
//! The executable is compiled once and placed next to a `game/` directory by
//! the desktop export worker (on macOS inside a real `.app` bundle, with the
//! game under `Contents/Resources/game`). It serves that immutable Web export
//! through a private protocol so no per-game Rust compilation is required.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use percent_encoding::percent_decode_str;
use serde_json::{Map, Value};
use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::webview::WebviewWindowBuilder;
use tauri::{Manager, WebviewUrl};

fn game_root() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("VIBEGAL_GAME_DIR") {
        return Ok(PathBuf::from(path));
    }
    let executable =
        std::env::current_exe().map_err(|error| format!("无法定位轻量 Player: {error}"))?;
    Ok(game_root_for_executable(&executable))
}

/// 游戏目录约定：
/// 1. 可执行文件旁的 `game/`（Windows/Linux 导出布局）；
/// 2. macOS `.app` 布局下 `Contents/MacOS/<bin>` 对应的 `Contents/Resources/game`。
/// 两者都不存在时返回可执行文件旁的 `game/`，让后续 index.html 检查报错。
fn game_root_for_executable(executable: &Path) -> PathBuf {
    let Some(parent) = executable.parent() else {
        return PathBuf::from("game");
    };
    let sibling = parent.join("game");
    if sibling.is_dir() {
        return sibling;
    }
    if let Some(contents) = parent.parent() {
        let resources = contents.join("Resources").join("game");
        if resources.is_dir() {
            return resources;
        }
    }
    sibling
}

fn decode_uri_path(uri_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode_str(uri_path).decode_utf8().ok()?;
    let relative = decoded.trim_start_matches('/');
    let relative = if relative.is_empty() {
        "index.html"
    } else {
        relative
    };
    let path = Path::new(relative);
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(path.to_path_buf())
}

fn resolve_game_file(root: &Path, uri_path: &str) -> Option<PathBuf> {
    decode_uri_path(uri_path).map(|relative| root.join(relative))
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

fn decode_query(query: Option<&str>) -> Map<String, Value> {
    let mut values = Map::new();
    for pair in query
        .unwrap_or_default()
        .split('&')
        .filter(|pair| !pair.is_empty())
    {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or_default();
        let value = parts.next().unwrap_or_default();
        let key = percent_decode_str(&key.replace('+', " "))
            .decode_utf8_lossy()
            .to_string();
        let value = percent_decode_str(&value.replace('+', " "))
            .decode_utf8_lossy()
            .to_string();
        values.insert(key, Value::String(value));
    }
    values
}

fn publish_smoke_result(query: Option<&str>) {
    let result = Value::Object(decode_query(query));
    println!("VIBEGAL_DESKTOP_SMOKE_RESULT={result}");
    let _ = io::stdout().flush();
    let passed = result
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|status| status == "passed");
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        std::process::exit(if passed { 0 } else { 1 });
    });
}

fn read_window_metadata(root: &Path) -> (String, f64, f64) {
    let manifest = fs::read_to_string(root.join("game.manifest.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or(Value::Null);
    let title = manifest
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("VibeGal Game")
        .to_string();
    let width = manifest
        .pointer("/stage/width")
        .and_then(Value::as_f64)
        .unwrap_or(1280.0);
    let height = manifest
        .pointer("/stage/height")
        .and_then(Value::as_f64)
        .unwrap_or(720.0);
    (title, width, height)
}

fn main() {
    let root = game_root().unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(70);
    });
    if !root.join("index.html").is_file() {
        eprintln!("找不到游戏 Web 产物: {}", root.display());
        std::process::exit(70);
    }
    let smoke = std::env::var_os("VIBEGAL_DESKTOP_SMOKE").is_some();
    let protocol_root = root.clone();
    let (title, width, height) = read_window_metadata(&root);

    tauri::Builder::default()
        .register_uri_scheme_protocol("vibegal", move |_context, request| {
            if smoke {
                eprintln!("[vibegal-player-smoke] request {}", request.uri());
            }
            if request.uri().path() == "/__vibegal_smoke_result__" {
                publish_smoke_result(request.uri().query());
                return tauri::http::Response::builder()
                    .status(204)
                    .body(Vec::new())
                    .unwrap();
            }
            let Some(file) = resolve_game_file(&protocol_root, request.uri().path()) else {
                return tauri::http::Response::builder()
                    .status(400)
                    .header("content-type", "text/plain; charset=utf-8")
                    .body(b"invalid path".to_vec())
                    .unwrap();
            };
            match fs::read(&file) {
                Ok(body) => tauri::http::Response::builder()
                    .status(200)
                    .header("content-type", content_type(&file))
                    .header("access-control-allow-origin", "*")
                    .header("cache-control", "no-store")
                    .body(body)
                    .unwrap(),
                Err(_) => tauri::http::Response::builder()
                    .status(404)
                    .header("content-type", "text/plain; charset=utf-8")
                    .body(b"not found".to_vec())
                    .unwrap(),
            }
        })
        .setup(move |app| {
            let query = if smoke { "?vibegalSmoke=1" } else { "" };
            let url = format!("vibegal://game/index.html{query}")
                .parse()
                .map_err(|error| format!("invalid player URL: {error}"))?;
            WebviewWindowBuilder::new(app, "game", WebviewUrl::CustomProtocol(url))
                .title(title)
                .inner_size(width, height)
                .min_inner_size(960.0, 540.0)
                .resizable(true)
                .visible(!smoke)
                .build()?;
            if let Some(bootstrap) = app.get_webview_window("main") {
                bootstrap.close()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!("player.tauri.conf.json"))
        .expect("error while running VibeGal lightweight player");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_paths_are_decoded_without_allowing_traversal() {
        let root = Path::new("C:/game");
        assert_eq!(
            resolve_game_file(root, "/content/%E7%AB%A0%E8%8A%82.json"),
            Some(root.join("content/章节.json"))
        );
        assert_eq!(resolve_game_file(root, "/../secret.txt"), None);
        assert_eq!(resolve_game_file(root, "/content/../../secret.txt"), None);
        assert_eq!(resolve_game_file(root, "/"), Some(root.join("index.html")));
    }

    #[test]
    fn smoke_query_is_machine_readable() {
        let result = decode_query(Some("status=passed&save=true&error=hello+world"));
        assert_eq!(result.get("status").and_then(Value::as_str), Some("passed"));
        assert_eq!(result.get("save").and_then(Value::as_str), Some("true"));
        assert_eq!(
            result.get("error").and_then(Value::as_str),
            Some("hello world")
        );
    }

    #[test]
    fn player_content_types_cover_runtime_and_media() {
        assert_eq!(
            content_type(Path::new("runtime/bundle.js")),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(content_type(Path::new("content/bgm.mp3")), "audio/mpeg");
        assert_eq!(content_type(Path::new("content/movie.webm")), "video/webm");
    }

    #[test]
    fn game_root_prefers_sibling_then_macos_resources() {
        let base = std::env::temp_dir().join(format!(
            "vibegal-player-game-root-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        // Windows/Linux 布局：<exe>/game
        let flat = base.join("flat");
        let flat_game = flat.join("game");
        fs::create_dir_all(&flat_game).unwrap();
        let flat_exe = flat.join("player");
        assert_eq!(game_root_for_executable(&flat_exe), flat_game);

        // macOS .app 布局：Contents/MacOS/<bin> → Contents/Resources/game
        let bundle = base.join("bundle").join("Game.app");
        let resources_game = bundle.join("Contents/Resources/game");
        fs::create_dir_all(&resources_game).unwrap();
        let bundle_exe = bundle.join("Contents/MacOS/Game");
        assert_eq!(game_root_for_executable(&bundle_exe), resources_game);

        // 都没有时回落到可执行文件旁的 game/（由 index.html 检查报错）
        let bare = base.join("bare");
        fs::create_dir_all(&bare).unwrap();
        let bare_exe = bare.join("player");
        assert_eq!(game_root_for_executable(&bare_exe), bare.join("game"));

        let _ = fs::remove_dir_all(&base);
    }
}
