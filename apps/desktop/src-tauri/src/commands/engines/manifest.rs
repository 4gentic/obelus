// Per-engine, per-platform release descriptors. Pinned to specific upstream
// versions — updating a pin is a repo edit + the next app release. Sha256 is
// optional: HTTPS + pinned tag is the v1 integrity floor, and the per-platform
// digests are tracked in docs/pinned-engines.md as a follow-up hardening step.

use serde::Serialize;

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineName {
    Typst,
    Tectonic,
}

impl EngineName {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Typst => "typst",
            Self::Tectonic => "tectonic",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "typst" => Some(Self::Typst),
            "tectonic" => Some(Self::Tectonic),
            _ => None,
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ArchiveKind {
    TarXz,
    TarGz,
    Zip,
}

#[derive(Clone, Debug)]
pub struct ManifestEntry {
    pub engine: EngineName,
    pub version: &'static str,
    pub url: String,
    pub archive: ArchiveKind,
    // Path inside the archive to the binary we want to install. Slash-separated.
    pub inner_path: String,
    // SHA256 hex of the archive, or None if not pinned. When None, the installer
    // logs a warning and relies on HTTPS transport integrity.
    pub sha256: Option<&'static str>,
}

pub const TYPST_VERSION: &str = "0.14.2";
pub const TECTONIC_VERSION: &str = "0.16.9";

// Target triple assembled from the host's OS + arch. Returns None when the
// managed install is not supported on the current platform.
pub fn current_target_triple() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("aarch64-apple-darwin"),
        ("macos", "x86_64") => Some("x86_64-apple-darwin"),
        ("windows", "x86_64") => Some("x86_64-pc-windows-msvc"),
        ("linux", "x86_64") => Some("x86_64-unknown-linux"),
        _ => None,
    }
}

pub fn for_current_platform(engine: EngineName) -> Option<ManifestEntry> {
    let target = current_target_triple()?;
    match engine {
        EngineName::Typst => typst_for_target(target),
        EngineName::Tectonic => tectonic_for_target(target),
    }
}

fn typst_for_target(target: &str) -> Option<ManifestEntry> {
    // Typst's linux asset is the musl tarball; translate the generic "linux"
    // triple we carry.
    let (asset_target, archive) = match target {
        "aarch64-apple-darwin" => ("aarch64-apple-darwin", ArchiveKind::TarXz),
        "x86_64-apple-darwin" => ("x86_64-apple-darwin", ArchiveKind::TarXz),
        "x86_64-pc-windows-msvc" => ("x86_64-pc-windows-msvc", ArchiveKind::Zip),
        "x86_64-unknown-linux" => ("x86_64-unknown-linux-musl", ArchiveKind::TarXz),
        _ => return None,
    };
    let ext = match archive {
        ArchiveKind::TarXz => "tar.xz",
        ArchiveKind::TarGz => "tar.gz",
        ArchiveKind::Zip => "zip",
    };
    let bin = binary_filename("typst");
    let url = format!(
        "https://github.com/typst/typst/releases/download/v{v}/typst-{asset_target}.{ext}",
        v = TYPST_VERSION,
    );
    let inner = format!("typst-{asset_target}/{bin}");
    Some(ManifestEntry {
        engine: EngineName::Typst,
        version: TYPST_VERSION,
        url,
        archive,
        inner_path: inner,
        sha256: None,
    })
}

fn tectonic_for_target(target: &str) -> Option<ManifestEntry> {
    let (asset_target, archive) = match target {
        "aarch64-apple-darwin" => ("aarch64-apple-darwin", ArchiveKind::TarGz),
        "x86_64-apple-darwin" => ("x86_64-apple-darwin", ArchiveKind::TarGz),
        "x86_64-pc-windows-msvc" => ("x86_64-pc-windows-msvc", ArchiveKind::Zip),
        "x86_64-unknown-linux" => ("x86_64-unknown-linux-gnu", ArchiveKind::TarGz),
        _ => return None,
    };
    let ext = match archive {
        ArchiveKind::TarXz => "tar.xz",
        ArchiveKind::TarGz => "tar.gz",
        ArchiveKind::Zip => "zip",
    };
    let url = format!(
        "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@{v}/tectonic-{v}-{asset_target}.{ext}",
        v = TECTONIC_VERSION,
    );
    // Tectonic's archives place the binary at the archive root.
    let inner = binary_filename("tectonic");
    Some(ManifestEntry {
        engine: EngineName::Tectonic,
        version: TECTONIC_VERSION,
        url,
        archive,
        inner_path: inner,
        sha256: None,
    })
}

pub fn binary_filename(stem: &str) -> String {
    if cfg!(windows) {
        format!("{stem}.exe")
    } else {
        stem.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_name_roundtrip() {
        assert_eq!(EngineName::from_str("typst"), Some(EngineName::Typst));
        assert_eq!(EngineName::from_str("tectonic"), Some(EngineName::Tectonic));
        assert_eq!(EngineName::from_str("pdflatex"), None);
        assert_eq!(EngineName::Typst.as_str(), "typst");
    }

    #[test]
    fn binary_filename_suffixes_windows() {
        if cfg!(windows) {
            assert_eq!(binary_filename("typst"), "typst.exe");
        } else {
            assert_eq!(binary_filename("typst"), "typst");
        }
    }

    #[test]
    fn current_target_triple_returns_something_on_supported_hosts() {
        // Smoke test; the implementation may return None on an unsupported host,
        // but the test runner is always one of the four v1 platforms.
        assert!(current_target_triple().is_some());
    }
}
