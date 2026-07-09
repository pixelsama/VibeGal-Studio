// VibeGal-Studio Tauri 后端 —— 文件系统操作。
// 所有磁盘读写集中在这里；前端通过 invoke 调用，不直接碰文件系统。

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::{
    mpsc::{self, RecvTimeoutError, Sender},
    Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

const MAX_ASSET_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;
