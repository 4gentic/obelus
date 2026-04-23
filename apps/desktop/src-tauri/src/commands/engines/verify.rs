// SHA256 integrity check for downloaded archives. When a manifest entry carries
// an expected digest, compare; when it doesn't, log a warning and return Ok so
// the v1 HTTPS-only trust floor still lets the install proceed.

use sha2::{Digest, Sha256};
use std::path::Path;

use crate::error::{AppError, AppResult};

pub async fn sha256_hex(path: &Path) -> AppResult<String> {
    let bytes = tokio::fs::read(path).await.map_err(AppError::from)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex_lower(&hasher.finalize()))
}

pub async fn verify(path: &Path, expected: Option<&str>) -> AppResult<()> {
    let Some(expected) = expected else {
        eprintln!(
            "[engine-install] no pinned sha256 for {}; relying on HTTPS",
            path.display()
        );
        return Ok(());
    };
    let actual = sha256_hex(path).await?;
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "sha256 mismatch for {}: expected {expected}, got {actual}",
            path.display()
        )))
    }
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

const HEX: &[u8; 16] = b"0123456789abcdef";

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[tokio::test]
    async fn sha256_matches_known_payload() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"hello").unwrap();
        f.flush().unwrap();
        let got = sha256_hex(f.path()).await.unwrap();
        assert_eq!(
            got,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[tokio::test]
    async fn verify_passes_when_sha_matches() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"hello").unwrap();
        f.flush().unwrap();
        assert!(verify(
            f.path(),
            Some("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
        )
        .await
        .is_ok());
    }

    #[tokio::test]
    async fn verify_fails_on_mismatch() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"hello").unwrap();
        f.flush().unwrap();
        let err = verify(f.path(), Some("deadbeef")).await.unwrap_err();
        let msg = match err {
            AppError::Other(s) => s,
            _ => panic!("wrong error kind"),
        };
        assert!(msg.contains("sha256 mismatch"));
    }

    #[tokio::test]
    async fn verify_without_expected_passes() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"hello").unwrap();
        f.flush().unwrap();
        assert!(verify(f.path(), None).await.is_ok());
    }
}
