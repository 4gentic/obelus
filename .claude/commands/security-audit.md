---
description: Whole-repo security audit, not diff-based. Scans the tree for secret leakage, network-surface violations, input-validation gaps, PDF/bundle injection surfaces, and — with --desktop — Tauri capability drift. Read-only.
argument-hint: "[--desktop]  # adds a Tauri v2 capability + plugin-scope pass"
allowed-tools: Read, Glob, Grep, Bash, Agent
---

# /security-audit

One pass, scoped to Obelus's invariants. Unlike `/security-review` (diff against base), this audits the full tree. Unlike `/oss-audit` (release readiness across six personas), this is security-only.

## Execution plan

### 1. Gate: `pnpm guard:network`

Run it first. This is the load-bearing invariant — no runtime network anywhere in the app. If it fails, stop and surface the offending file. Everything else is moot until the allow-list is clean.

If it passes, note `- [guard] pnpm guard:network — green` and continue.

### 2. Shared fact base

Before dispatch, collect signals the personas would otherwise re-query. One bash invocation, attach the output to each agent:

- `git grep -nE '(api_key|secret|token|password|bearer)\s*[:=]\s*["'\'']' -- ':!*.lock' ':!*.md'` — hardcoded-credential candidates.
- `git grep -nE 'dangerously[A-Z][a-zA-Z]*Inner[A-Z][a-zA-Z]*|\beval\(|\bFunction\s*\(' -- 'apps/**' 'packages/**'` — DOM and dynamic-code surfaces.
- `git grep -n 'fetch(' -- 'apps/**' 'packages/**'` — every network caller (cross-check against the allow-list).
- `git grep -nE 'innerHTML\s*=|outerHTML\s*=|document\.write' -- 'apps/**' 'packages/**'` — raw-HTML writes.
- `pnpm audit --prod --json 2>/dev/null || true` — dep CVE snapshot, prod tree only.
- If `--desktop`: list `apps/desktop/src-tauri/capabilities/*.json`, read `apps/desktop/src-tauri/tauri.conf.json`, read `apps/desktop/src-tauri/Cargo.toml` feature list.

### 3. Parallel dispatch

One message, four `Agent` calls (five with `--desktop`). Same output contract for each:

> Audit your security scope. Report findings as a flat markdown list, one per line, in the form:
> `- [<persona>] <severity> <path>:<line> — <finding> → <remediation>`
> where `<severity>` is one of `crit`, `high`, `med`, `low`.
> Use `<path>` without `:<line>` when the finding is a missing control. Cap at ~400 words. No preamble, no prose.

| Agent | Security scope |
|---|---|
| `proofreader` | Hardcoded secrets, `process.env` reads in runtime code, dynamic-code sinks (the `eval` call, the `Function` constructor, React's dangerous inner-HTML escape hatch), dep CVEs at `high`+ severity, ranged-version drift (`^` or `~` on security-sensitive packages: `pdfjs-dist`, `dexie`, `zod`, `@tauri-apps/*`), `// FIXME:` or `// HACK:` in security-adjacent files. |
| `archivist` | Every `fetch` / `XMLHttpRequest` / `sendBeacon` caller under `apps/**` + `packages/**` — any runtime call is a finding. PWA scope + `navigateFallback` (does it expose admin-like routes?). OPFS path derivation (any user-controlled segment?). |
| `compositor` | PDF worker isolation — `?worker` import, not `new URL()` (sandboxing). Text-layer injection — user-controlled strings rendered into the DOM without sanitization. Anchor-quote normalization — NFKC applied before hashing (combining-mark injection). Object-URL lifetime — every `URL.createObjectURL` paired with `revokeObjectURL`. `pdfjs-dist` pinned to a CVE-clean version. |
| `scribe` | Bundle-schema leakage — does the exported review JSON contain any machine identifier, filesystem path, or username? Plugin skills with write paths must set `disable-model-invocation: true`. `packages/claude-plugin/**` imports nothing from `apps/web` or `apps/desktop`. `packages/bundle-schema` validates at both producer and consumer boundary (no silent type-casts). |

With `--desktop`, add a fifth dispatch to `proofreader` scoped narrowly to Tauri:

- Capability files: least-privilege check on `permissions` arrays — flag any `*:default` or broad permission (e.g. `fs:allow-read-file` without a path scope).
- `plugin-sql`: no raw interpolation into SQL strings — queries use parameter bindings.
- `plugin-fs`: `scope` arrays constrain reads/writes to expected dirs (no `$HOME/**`).
- `plugin-shell`: every `allowed` entry has a fixed command + arg pattern, no `$ARG` free-form.
- `tauri.conf.json`: `app.security.csp` is set (not `null`), `app.withGlobalTauri` false, `bundle.resources` doesn't ship source maps.
- Cargo: no `default-features = true` on `tauri` that enables dev-only surfaces in release.

### 4. Consolidate

Merge persona outputs. Sort by severity descending. Print in this exact shape:

```
## /security-audit — <YYYY-MM-DD>

crit: N · high: N · med: N · low: N

### Crit
- [<persona>] <path>:<line> — <finding> → <remediation>

### High
- ...

### Med
- ...

### Low
- ...

### Green
- [guard] pnpm guard:network — green
- [<persona>] <what verified clean>
```

If a section is empty, write `_none_` under its heading. End with a one-line verdict: `clean` / `advisory` / `block`. `block` if any `crit`. `advisory` if any `high`. Otherwise `clean`.

### 5. No auto-fix

Security findings rarely have autonomous-safe remediations. This command ends at the report. If the user wants fixes, they'll invoke the relevant persona directly with a specific finding.
