// Pure helpers shared by the plugin-e2e harness for OpenCode runs.
// Extracted into a sibling module so the parsing/prompt-rewriting logic can
// be unit-tested in isolation; the harness re-imports from here.

// Rewrites a Claude-shaped prompt (`/obelus:<skill> <args> [— ...continuation]`)
// into engine-neutral English for OpenCode. The skill files are staged at
// `<dir>/.claude/skills/<skill>/SKILL.md` so the agent can read them by path.
// Two special cases the scenarios use today:
//   - `/obelus:write-review ./bundle.json --out`  vs.  `/obelus:write-review ./bundle.json`
//   - the em-dash continuation that chains `/skill apply-fix` onto apply-revision.
export function openCodePrompt(claudePrompt) {
  const trimmed = claudePrompt.trim();
  // Match the leading invocation; the rest may contain an em-dash continuation.
  const leadMatch = trimmed.match(/^\/obelus:([a-z-]+)\s+(\S+)(.*)$/);
  if (!leadMatch) return trimmed;
  const skill = leadMatch[1];
  const arg = leadMatch[2];
  const tail = leadMatch[3] ?? "";
  const out = [
    `Read .claude/skills/${skill}/SKILL.md inside this directory and follow it on input \`${arg}\`.`,
  ];
  if (skill === "write-review") {
    if (/--out\b/.test(tail)) {
      out.push(
        "Out-of-band mode: write the reviewer letter as `writeup-<paperId>-<iso>.md` inside $OBELUS_WORKSPACE_DIR; the final stdout line must be `OBELUS_WROTE: <absolute-path-to-that-file>`.",
      );
    } else {
      out.push(
        "Inline mode: emit the reviewer letter as the final assistant message; do NOT write a file and do NOT emit any `OBELUS_WROTE:` marker.",
      );
    }
  } else if (skill === "apply-revision") {
    out.push(
      "Write the plan as `plan-<iso>.json` inside $OBELUS_WORKSPACE_DIR; end with `OBELUS_WROTE: <absolute-path-to-that-file>`.",
    );
  } else if (skill === "fix-compile") {
    out.push(
      "Write the plan as `plan-<iso>.json` inside $OBELUS_WORKSPACE_DIR; end with `OBELUS_WROTE: <absolute-path-to-that-file>`.",
    );
  }
  // Normalise the em-dash continuation into a plain follow-up sentence.
  const continuation = tail.replace(/^\s*[—-]+\s*/, "").trim();
  if (continuation) {
    const rewritten = continuation.replace(
      /\/skill\s+([a-z-]+)/gi,
      "the `$1` skill (read .claude/skills/$1/SKILL.md inside this directory)",
    );
    out.push(rewritten);
  }
  return out.join("\n");
}

// `opencode run --format json` emits NDJSON events on stdout. We tolerate
// several plausible shapes — `{type: "message", content: [{type:"text", text}]}`,
// `{type: "assistant", message: {content: [...]}}`, `{type:"text", text}` —
// and concatenate every assistant text fragment we find, returning the same
// `{ result, is_error }` envelope the Claude assertions read.
export function parseOpenCodeStdout(stdout) {
  let assistantText = "";
  let isError = false;
  for (const raw of stdout.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    if (obj.is_error === true || obj.type === "error") isError = true;
    assistantText += extractOpenCodeText(obj);
  }
  return { result: assistantText, is_error: isError };
}

export function extractOpenCodeText(obj) {
  if (typeof obj.text === "string" && obj.type === "text") return obj.text;
  const candidate =
    obj.role === "assistant" || obj.type === "message" || obj.type === "assistant" ? obj : null;
  const content = candidate?.content ?? candidate?.message?.content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const c of content) {
    if (c && typeof c === "object" && c.type === "text" && typeof c.text === "string") {
      out += c.text;
    }
  }
  return out;
}
