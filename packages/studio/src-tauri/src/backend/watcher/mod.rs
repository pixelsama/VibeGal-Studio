//! Native project watching, path classification, and debounced change delivery.

use super::fs::ProjectRoot;
use super::model::ProjectChangedPayload;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Component, Path};
use std::sync::{
    mpsc::{self, RecvTimeoutError, Sender},
    Mutex,
};
use std::time::{Duration, Instant};

pub(crate) const PROJECT_CHANGED_EVENT: &str = "project_changed";
const PROJECT_WATCH_DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProjectWatchKind {
    ProjectMeta,
    Content,
    Renderer,
}

#[derive(Default)]
pub(crate) struct ProjectDebounceState {
    pending: Option<ProjectChangedPayload>,
    last_event_at: Option<Instant>,
}

impl ProjectDebounceState {
    pub(crate) fn record(&mut self, payload: ProjectChangedPayload, now: Instant) {
        match &mut self.pending {
            Some(pending) => pending.merge(payload),
            None => self.pending = Some(payload),
        }
        self.last_event_at = Some(now);
    }

    pub(crate) fn due(&mut self, now: Instant, delay: Duration) -> Option<ProjectChangedPayload> {
        let last_event_at = self.last_event_at?;
        if now.duration_since(last_event_at) < delay {
            return None;
        }
        self.last_event_at = None;
        self.pending.take()
    }

    fn remaining_delay(&self, now: Instant, delay: Duration) -> Duration {
        self.last_event_at
            .map(|last_event_at| delay.saturating_sub(now.duration_since(last_event_at)))
            .unwrap_or(delay)
    }
}

enum WatchSignal {
    Changed { renderer_changed: bool },
    Stop,
}

struct ProjectWatchHandle {
    _watcher: RecommendedWatcher,
    stop_tx: Sender<WatchSignal>,
}

#[derive(Default)]
pub(crate) struct ProjectWatchers {
    active: Mutex<HashMap<String, ProjectWatchHandle>>,
}

pub(crate) fn watch<F>(
    project_path: &str,
    watchers: &ProjectWatchers,
    on_change: F,
) -> Result<(), String>
where
    F: Fn(ProjectChangedPayload) + Send + 'static,
{
    let root = ProjectRoot::open(Path::new(project_path))?;
    let root_key = root.path().to_string_lossy().into_owned();
    let mut active = watchers
        .active
        .lock()
        .map_err(|_| "项目监听器状态已损坏".to_string())?;
    if active.contains_key(&root_key) {
        return Ok(());
    }

    let (tx, rx) = mpsc::channel::<WatchSignal>();
    let event_tx = tx.clone();
    let event_root = root.path().to_path_buf();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let Ok(event) = result else {
            return;
        };
        let mut relevant = false;
        let mut renderer_changed = false;
        for path in event.paths {
            match classify_project_watch_path(&event_root, &path) {
                Some(ProjectWatchKind::Renderer) => {
                    relevant = true;
                    renderer_changed = true;
                }
                Some(ProjectWatchKind::Content | ProjectWatchKind::ProjectMeta) => {
                    relevant = true;
                }
                None => {}
            }
        }
        if relevant {
            let _ = event_tx.send(WatchSignal::Changed { renderer_changed });
        }
    })
    .map_err(|e| format!("创建项目监听器失败: {}", e))?;

    watcher
        .watch(root.path(), RecursiveMode::Recursive)
        .map_err(|e| format!("监听项目目录失败 {}: {}", root.path().display(), e))?;

    let worker_root = root_key.clone();
    std::thread::spawn(move || run_debouncer(worker_root, rx, on_change));
    active.insert(
        root_key,
        ProjectWatchHandle {
            _watcher: watcher,
            stop_tx: tx,
        },
    );
    Ok(())
}

pub(crate) fn unwatch(project_path: &str, watchers: &ProjectWatchers) -> Result<(), String> {
    let root = Path::new(project_path)
        .canonicalize()
        .map_err(|e| format!("无法定位项目目录 {}: {}", project_path, e))?;
    let root_key = root.to_string_lossy().into_owned();
    let mut active = watchers
        .active
        .lock()
        .map_err(|_| "项目监听器状态已损坏".to_string())?;
    if let Some(handle) = active.remove(&root_key) {
        let _ = handle.stop_tx.send(WatchSignal::Stop);
    }
    Ok(())
}

fn run_debouncer<F>(project_path: String, rx: mpsc::Receiver<WatchSignal>, on_change: F)
where
    F: Fn(ProjectChangedPayload),
{
    let mut state = ProjectDebounceState::default();
    loop {
        let timeout = state.remaining_delay(Instant::now(), PROJECT_WATCH_DEBOUNCE);
        match rx.recv_timeout(timeout) {
            Ok(WatchSignal::Changed { renderer_changed }) => state.record(
                ProjectChangedPayload::new(project_path.clone(), renderer_changed),
                Instant::now(),
            ),
            Ok(WatchSignal::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {
                if let Some(payload) = state.due(Instant::now(), PROJECT_WATCH_DEBOUNCE) {
                    on_change(payload);
                }
            }
        }
    }
}

pub(crate) fn classify_project_watch_path(root: &Path, path: &Path) -> Option<ProjectWatchKind> {
    let rel = path.strip_prefix(root).ok()?;
    let mut normal_components = rel.components().filter_map(|component| match component {
        Component::Normal(part) => part.to_str(),
        _ => None,
    });
    let first = normal_components.next()?;

    if matches!(first, ".git" | "node_modules" | "dist" | "target") {
        return None;
    }
    if first == "gal.project.json" {
        return Some(ProjectWatchKind::ProjectMeta);
    }
    if first == "content" {
        return Some(ProjectWatchKind::Content);
    }
    if first == "renderers" {
        return Some(ProjectWatchKind::Renderer);
    }
    None
}
