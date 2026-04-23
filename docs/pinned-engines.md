# Pinned engines

The managed-engines flow (`apps/desktop/src-tauri/src/commands/engines/`) downloads
pinned binaries from each engine's official GitHub Releases. Versions live in
`commands/engines/manifest.rs` and should be bumped here and in that file
together.

## Current pins

| Engine | Version | Released | Source |
|---|---|---|---|
| Typst | 0.14.2 | 2025-12-12 | https://github.com/typst/typst/releases/tag/v0.14.2 |
| Tectonic | 0.16.9 | 2026-04-17 | https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.16.9 |

## Per-platform assets

URLs are generated from the target triple at install time. See
`manifest.rs::current_target_triple` for the mapping.

### Typst 0.14.2

| Platform | Asset | Archive | SHA256 |
|---|---|---|---|
| macOS arm64 | `typst-aarch64-apple-darwin.tar.xz` | tar.xz | _TODO_ |
| macOS x86_64 | `typst-x86_64-apple-darwin.tar.xz` | tar.xz | _TODO_ |
| Windows x86_64 | `typst-x86_64-pc-windows-msvc.zip` | zip | _TODO_ |
| Linux x86_64 | `typst-x86_64-unknown-linux-musl.tar.xz` | tar.xz | _TODO_ |

Inner binary path: `typst-<target>/typst` (or `typst.exe` on Windows).

### Tectonic 0.16.9

| Platform | Asset | Archive | SHA256 |
|---|---|---|---|
| macOS arm64 | `tectonic-0.16.9-aarch64-apple-darwin.tar.gz` | tar.gz | _TODO_ |
| macOS x86_64 | `tectonic-0.16.9-x86_64-apple-darwin.tar.gz` | tar.gz | _TODO_ |
| Windows x86_64 | `tectonic-0.16.9-x86_64-pc-windows-msvc.zip` | zip | _TODO_ |
| Linux x86_64 | `tectonic-0.16.9-x86_64-unknown-linux-gnu.tar.gz` | tar.gz | _TODO_ |

Inner binary path: `tectonic` at archive root (or `tectonic.exe` on Windows).

## Verifying and filling in the SHA256 values

v1 treats SHA256 as optional — HTTPS + pinned release tags is the integrity
floor. To harden to mandatory-verify, fill in the digests below and update
the `sha256` field of the matching `ManifestEntry` in `manifest.rs`.

```bash
for url in \
  https://github.com/typst/typst/releases/download/v0.14.2/typst-aarch64-apple-darwin.tar.xz \
  https://github.com/typst/typst/releases/download/v0.14.2/typst-x86_64-apple-darwin.tar.xz \
  https://github.com/typst/typst/releases/download/v0.14.2/typst-x86_64-pc-windows-msvc.zip \
  https://github.com/typst/typst/releases/download/v0.14.2/typst-x86_64-unknown-linux-musl.tar.xz \
  https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@0.16.9/tectonic-0.16.9-aarch64-apple-darwin.tar.gz \
  https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@0.16.9/tectonic-0.16.9-x86_64-apple-darwin.tar.gz \
  https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@0.16.9/tectonic-0.16.9-x86_64-pc-windows-msvc.zip \
  https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@0.16.9/tectonic-0.16.9-x86_64-unknown-linux-gnu.tar.gz \
; do
  printf "%s  %s\n" "$(curl -sL "$url" | shasum -a 256 | awk '{print $1}')" "$url"
done
```

## First-compile caveats

### Tectonic

The first `.tex` compile under Tectonic fetches a CTAN bundle (~300 MB) from
`relay.fullyjustified.net`. Subsequent compiles are offline. The wizard and
Settings UI disclose this before the user triggers the install.

### Typst

Self-contained. No network activity after install.
