// Extracts a single binary from a release archive. The engine installer only
// needs the one executable; unpacking the entire tarball into app-data is
// wasted IO. We scan the archive for the named entry, write it out, and
// chmod it executable on Unix.

use flate2::read::GzDecoder;
use std::fs::{File, OpenOptions};
use std::io::{copy, Read};
use std::path::Path;
use xz2::read::XzDecoder;
use zip::ZipArchive;

use super::manifest::ArchiveKind;
use crate::error::{AppError, AppResult};

pub fn extract_binary(
    archive: &Path,
    kind: ArchiveKind,
    inner_path: &str,
    dest_binary: &Path,
) -> AppResult<()> {
    if let Some(parent) = dest_binary.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::from)?;
    }

    match kind {
        ArchiveKind::TarXz => extract_tar(archive, inner_path, dest_binary, Compression::Xz),
        ArchiveKind::TarGz => extract_tar(archive, inner_path, dest_binary, Compression::Gz),
        ArchiveKind::Zip => extract_zip(archive, inner_path, dest_binary),
    }?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(dest_binary).map_err(AppError::from)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(dest_binary, perms).map_err(AppError::from)?;
    }

    Ok(())
}

enum Compression {
    Gz,
    Xz,
}

fn extract_tar(
    archive: &Path,
    inner_path: &str,
    dest: &Path,
    compression: Compression,
) -> AppResult<()> {
    let file = File::open(archive).map_err(AppError::from)?;
    let reader: Box<dyn Read> = match compression {
        Compression::Gz => Box::new(GzDecoder::new(file)),
        Compression::Xz => Box::new(XzDecoder::new(file)),
    };
    let mut tar = tar::Archive::new(reader);
    for entry in tar.entries().map_err(AppError::from)? {
        let mut entry = entry.map_err(AppError::from)?;
        let path = entry
            .path()
            .map_err(|e| AppError::Other(format!("tar entry path: {e}")))?
            .to_path_buf();
        if path_matches(&path, inner_path) {
            let mut out = open_dest(dest)?;
            copy(&mut entry, &mut out).map_err(AppError::from)?;
            return Ok(());
        }
    }
    Err(AppError::Other(format!(
        "archive did not contain expected entry: {inner_path}"
    )))
}

fn extract_zip(archive: &Path, inner_path: &str, dest: &Path) -> AppResult<()> {
    let file = File::open(archive).map_err(AppError::from)?;
    let mut zip = ZipArchive::new(file).map_err(|e| AppError::Other(format!("zip: {e}")))?;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| AppError::Other(format!("zip entry: {e}")))?;
        let name = entry.name().to_string();
        if path_matches(Path::new(&name), inner_path) {
            let mut out = open_dest(dest)?;
            copy(&mut entry, &mut out).map_err(AppError::from)?;
            return Ok(());
        }
    }
    Err(AppError::Other(format!(
        "archive did not contain expected entry: {inner_path}"
    )))
}

fn open_dest(dest: &Path) -> AppResult<File> {
    OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(dest)
        .map_err(AppError::from)
}

// Archive paths can have leading "./" or platform-native separators. We
// normalise both sides to forward slashes and compare.
fn path_matches(archive_entry: &Path, expected: &str) -> bool {
    let entry_norm = archive_entry
        .to_string_lossy()
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string();
    let expected_norm = expected.replace('\\', "/");
    let expected_norm = expected_norm.trim_start_matches("./");
    entry_norm == expected_norm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_matches_normalises_leading_dot_slash() {
        assert!(path_matches(Path::new("./typst-x86_64-apple-darwin/typst"), "typst-x86_64-apple-darwin/typst"));
        assert!(path_matches(Path::new("tectonic"), "tectonic"));
        assert!(!path_matches(Path::new("typst/other"), "typst/typst"));
    }

    #[test]
    #[cfg(windows)]
    fn path_matches_normalises_backslashes_on_windows() {
        assert!(path_matches(Path::new(r"typst-x86_64-pc-windows-msvc\typst.exe"), "typst-x86_64-pc-windows-msvc/typst.exe"));
    }
}
