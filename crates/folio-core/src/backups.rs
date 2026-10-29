//! Copies of originals taken before Folio first overwrites them. Kept 14 days, at most 1 GB
//! in total (oldest go first). They hold document content, so the UI offers "Clear".

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::Result;

pub struct Backups {
    dir: PathBuf,
    max_age: Duration,
    max_bytes: u64,
}

impl Backups {
    pub fn new(dir: PathBuf) -> Backups {
        Backups { dir, max_age: Duration::from_secs(14 * 24 * 60 * 60), max_bytes: 1 << 30 }
    }

    /// Copies `original` into the backup folder and prunes old backups.
    pub fn keep(&self, original: &Path) -> Result<PathBuf> {
        std::fs::create_dir_all(&self.dir)?;
        let name = original.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let stamp = utc_stamp(SystemTime::now());
        let mut dest = self.dir.join(format!("{stamp}-{name}"));
        let mut n = 1;
        while dest.exists() {
            n += 1;
            dest = self.dir.join(format!("{stamp}-{n}-{name}"));
        }
        std::fs::copy(original, &dest)?;
        self.prune()?;
        Ok(dest)
    }

    /// Deletes backups older than 14 days, then the oldest ones until the total fits in 1 GB.
    pub fn prune(&self) -> Result<()> {
        let mut entries = self.entries()?;
        let now = SystemTime::now();
        entries.retain(|e| {
            let expired = now.duration_since(e.modified).unwrap_or_default() > self.max_age;
            if expired {
                let _ = std::fs::remove_file(&e.path);
            }
            !expired
        });
        entries.sort_by_key(|e| e.modified);
        let mut total: u64 = entries.iter().map(|e| e.size).sum();
        for entry in &entries {
            if total <= self.max_bytes {
                break;
            }
            if std::fs::remove_file(&entry.path).is_ok() {
                total -= entry.size;
            }
        }
        Ok(())
    }

    /// Number of backups and their total size in bytes.
    pub fn usage(&self) -> Result<(u64, u64)> {
        let entries = self.entries()?;
        Ok((entries.len() as u64, entries.iter().map(|e| e.size).sum()))
    }

    /// Deletes every backup.
    pub fn clear(&self) -> Result<()> {
        for entry in self.entries()? {
            std::fs::remove_file(&entry.path)?;
        }
        Ok(())
    }

    fn entries(&self) -> Result<Vec<Entry>> {
        let dir = match std::fs::read_dir(&self.dir) {
            Ok(dir) => dir,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err.into()),
        };
        let mut entries = Vec::new();
        for item in dir {
            let item = item?;
            let meta = item.metadata()?;
            if meta.is_file() {
                entries.push(Entry {
                    path: item.path(),
                    size: meta.len(),
                    modified: meta.modified().unwrap_or(UNIX_EPOCH),
                });
            }
        }
        Ok(entries)
    }
}

struct Entry {
    path: PathBuf,
    size: u64,
    modified: SystemTime,
}

/// `20261029-143205`, in UTC, for file names.
pub fn utc_stamp(time: SystemTime) -> String {
    let secs = time.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
    let (days, rest) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}{month:02}{day:02}-{:02}{:02}{:02}", rest / 3600, rest % 3600 / 60, rest % 60)
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe as i64 + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_are_utc_dates() {
        assert_eq!(utc_stamp(UNIX_EPOCH), "19700101-000000");
        assert_eq!(utc_stamp(UNIX_EPOCH + Duration::from_secs(951_782_400)), "20000229-000000");
        assert_eq!(utc_stamp(UNIX_EPOCH + Duration::from_secs(1_793_257_808)), "20261029-071008");
    }

    #[test]
    fn prunes_down_to_the_size_cap() {
        let dir = std::env::temp_dir().join(format!("folio-test-backups-{}", crate::random::hex(4).unwrap()));
        let backups = Backups { dir: dir.clone(), max_age: Duration::from_secs(3600), max_bytes: 10 };
        let source = dir.with_extension("src");
        std::fs::write(&source, b"123456").unwrap();
        backups.keep(&source).unwrap();
        backups.keep(&source).unwrap();
        let (count, bytes) = backups.usage().unwrap();
        assert_eq!((count, bytes), (1, 6), "two 6-byte backups don't fit in 10 bytes");
        backups.clear().unwrap();
        assert_eq!(backups.usage().unwrap(), (0, 0));
        let _ = std::fs::remove_file(&source);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
