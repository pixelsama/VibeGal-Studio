use super::fs::atomic_write_text;
use super::model::AppSettings;
use std::fs;
use std::path::Path;

// ──────────────────────────────────────────────
// 应用级设置（非项目级），存到 app config 目录的 settings.json
// ──────────────────────────────────────────────

/// 加载应用设置。文件不存在时返回默认值（首次运行，默认跟随系统）。
pub(crate) fn load(path: &Path) -> Result<AppSettings, String> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("读取设置失败 ({}): {}", path.display(), e))?;
    serde_json::from_str::<AppSettings>(&text)
        .map_err(|e| format!("解析设置失败 ({}): {}", path.display(), e))
}

/// 保存应用设置。
pub(crate) fn save(path: &Path, settings: AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建设置目录失败: {}", e))?;
    }
    let json =
        serde_json::to_string_pretty(&settings).map_err(|e| format!("序列化设置失败: {}", e))?;
    atomic_write_text(&path, &json).map_err(|e| format!("写设置失败 ({}): {}", path.display(), e))
}

// ──────────────────────────────────────────────
// 命令行工具安装（显式 symlink，不静默修改 PATH）
// ──────────────────────────────────────────────
