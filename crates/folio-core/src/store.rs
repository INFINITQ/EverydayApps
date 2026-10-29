//! Small JSON files in the app's local data folder: settings, recent files and the
//! remembered view state of each file. Written atomically; a corrupt file is set aside
//! (renamed `*.corrupt-<time>.json`) and replaced with defaults instead of crashing.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::backups::utc_stamp;
use crate::grants::path_key;
use crate::{Error, Result, files};

fn load<T: DeserializeOwned + Default>(path: &Path) -> T {
    let Ok(bytes) = std::fs::read(path) else { return T::default() };
    serde_json::from_slice(&bytes).unwrap_or_else(|_| {
        let aside = path.with_extension(format!("corrupt-{}.json", utc_stamp(SystemTime::now())));
        let _ = std::fs::rename(path, aside);
        T::default()
    })
}

fn save<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| Error::Invalid(e.to_string()))?;
    files::write_atomically(path, &bytes)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn lock<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>> {
    mutex.lock().map_err(|_| Error::Invalid("app data is unavailable".into()))
}

// --- Settings ------------------------------------------------------------------------------

/// Free-form settings owned by the UI (theme choice and so on), as one JSON object.
pub struct Settings {
    path: PathBuf,
    value: Mutex<Map<String, Value>>,
}

impl Settings {
    pub fn open(path: PathBuf) -> Settings {
        let value = load(&path);
        Settings { path, value: Mutex::new(value) }
    }

    pub fn get(&self) -> Map<String, Value> {
        self.value.lock().map(|v| v.clone()).unwrap_or_default()
    }

    /// Shallow merge: each key in `patch` replaces the stored one; `null` removes it.
    pub fn merge(&self, patch: Map<String, Value>) -> Result<Map<String, Value>> {
        let mut value = lock(&self.value)?;
        for (key, item) in patch {
            if item.is_null() {
                value.remove(&key);
            } else {
                value.insert(key, item);
            }
        }
        save(&self.path, &*value)?;
        Ok(value.clone())
    }
}

// --- Recent files ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub key: String,
    pub name: String,
    pub display_path: String,
    pub opened_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    #[serde(flatten)]
    pub entry: RecentEntry,
    pub exists: bool,
}

pub struct Recent {
    path: PathBuf,
    entries: Mutex<Vec<RecentEntry>>,
    /// The app's own document types (lowercase, no dot). Other files it saves, such as a PDF's
    /// attachments, stay out of the list.
    extensions: Vec<String>,
}

const MAX_RECENT: usize = 25;

impl Recent {
    pub fn open(path: PathBuf, extensions: &[&str]) -> Recent {
        let entries = load(&path);
        let extensions = extensions.iter().map(|e| e.to_ascii_lowercase()).collect();
        Recent { path, entries: Mutex::new(entries), extensions }
    }

    /// Moves `file` to the top of the list (files of other types are left out).
    pub fn touch(&self, file: &Path) -> Result<()> {
        let ours = file
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| self.extensions.iter().any(|x| x.eq_ignore_ascii_case(e)));
        if !ours {
            return Ok(());
        }
        let key = path_key(file);
        let mut entries = lock(&self.entries)?;
        entries.retain(|e| e.key != key);
        entries.insert(
            0,
            RecentEntry {
                key,
                name: file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                display_path: file.to_string_lossy().into_owned(),
                opened_ms: now_ms(),
            },
        );
        entries.truncate(MAX_RECENT);
        save(&self.path, &*entries)
    }

    pub fn list(&self) -> Vec<RecentItem> {
        self.entries
            .lock()
            .map(|entries| {
                entries
                    .iter()
                    .map(|e| RecentItem { exists: Path::new(&e.display_path).is_file(), entry: e.clone() })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn path_of(&self, key: &str) -> Option<PathBuf> {
        let entries = self.entries.lock().ok()?;
        entries.iter().find(|e| e.key == key).map(|e| PathBuf::from(&e.display_path))
    }

    pub fn remove(&self, key: &str) -> Result<()> {
        let mut entries = lock(&self.entries)?;
        entries.retain(|e| e.key != key);
        save(&self.path, &*entries)
    }

    pub fn clear(&self) -> Result<()> {
        let mut entries = lock(&self.entries)?;
        entries.clear();
        save(&self.path, &*entries)
    }
}

// --- View state ------------------------------------------------------------------------------

/// Where you were in each file (page, zoom, scroll...), keyed by the file's path key.
pub struct ViewState {
    path: PathBuf,
    map: Mutex<Map<String, Value>>,
}

const MAX_VIEW_STATES: usize = 300;

impl ViewState {
    pub fn open(path: PathBuf) -> ViewState {
        let map = load(&path);
        ViewState { path, map: Mutex::new(map) }
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        let map = self.map.lock().ok()?;
        map.get(key).and_then(|item| item.get("v")).cloned()
    }

    pub fn set(&self, key: &str, value: Value) -> Result<()> {
        let mut map = lock(&self.map)?;
        map.insert(key.to_owned(), serde_json::json!({ "v": value, "t": now_ms() }));
        if map.len() > MAX_VIEW_STATES {
            let mut by_age: Vec<(String, u64)> = map
                .iter()
                .map(|(k, item)| (k.clone(), item.get("t").and_then(Value::as_u64).unwrap_or(0)))
                .collect();
            by_age.sort_by_key(|(_, t)| *t);
            for (old, _) in by_age.into_iter().take(map.len() - MAX_VIEW_STATES) {
                map.remove(&old);
            }
        }
        save(&self.path, &*map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("folio-test-{name}-{}", crate::random::hex(4).unwrap()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn settings_merge_and_persist() {
        let dir = temp_dir("settings");
        let settings = Settings::open(dir.join("settings.json"));
        let patch = serde_json::json!({ "theme": "dark", "zoom": 1.25 });
        settings.merge(patch.as_object().unwrap().clone()).unwrap();
        let remove = serde_json::json!({ "zoom": null });
        settings.merge(remove.as_object().unwrap().clone()).unwrap();
        let reopened = Settings::open(dir.join("settings.json"));
        assert_eq!(Value::Object(reopened.get()), serde_json::json!({ "theme": "dark" }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_files_are_set_aside() {
        let dir = temp_dir("corrupt");
        std::fs::write(dir.join("settings.json"), b"{ not json").unwrap();
        let settings = Settings::open(dir.join("settings.json"));
        assert!(settings.get().is_empty());
        let aside = std::fs::read_dir(&dir)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains("corrupt"))
            .count();
        assert_eq!(aside, 1, "the damaged file is kept for inspection");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn recent_files_move_to_the_top() {
        let dir = temp_dir("recent");
        let recent = Recent::open(dir.join("recent.json"), &["pdf"]);
        recent.touch(&dir.join("a.pdf")).unwrap();
        recent.touch(&dir.join("b.PDF")).unwrap();
        recent.touch(&dir.join("a.pdf")).unwrap();
        // A saved attachment isn't one of the app's documents.
        recent.touch(&dir.join("sheet.xlsx")).unwrap();
        let names: Vec<String> = recent.list().into_iter().map(|i| i.entry.name).collect();
        assert_eq!(names, ["a.pdf", "b.PDF"]);
        let key = path_key(&dir.join("b.PDF"));
        assert_eq!(recent.path_of(&key), Some(dir.join("b.PDF")));
        recent.clear().unwrap();
        assert!(Recent::open(dir.join("recent.json"), &["pdf"]).list().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn view_state_round_trips() {
        let dir = temp_dir("view");
        let state = ViewState::open(dir.join("view.json"));
        state.set("k1", serde_json::json!({ "page": 7 })).unwrap();
        let reopened = ViewState::open(dir.join("view.json"));
        assert_eq!(reopened.get("k1"), Some(serde_json::json!({ "page": 7 })));
        assert_eq!(reopened.get("missing"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
