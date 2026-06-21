// Run with:  node --test scripts/__tests__/sanitize-metrics.test.mjs
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { leaksMachinePath, orderReplacements, sanitizeLine } from "../lib/sanitize-metrics.mjs";

describe("orderReplacements", () => {
  it("sorts longest prefix first and drops empty paths", () => {
    const ordered = orderReplacements([
      ["/Users/alex/code/obelus", "<obelus-repo>"],
      ["", "<skip>"],
      ["/Users/alex/code/obelus/apps/desktop/projects/p1", "<workspace>"],
    ]);
    assert.equal(ordered.length, 2);
    assert.equal(ordered[0][1], "<workspace>");
    assert.equal(ordered[1][1], "<obelus-repo>");
  });
});

describe("sanitizeLine", () => {
  const replacements = orderReplacements([
    ["/Users/alex/Library/Application Support/app.obelus.desktop/projects/p1", "<workspace>"],
    ["/Users/alex/papers/attention", "<paper-root>"],
    ["/Users/alex/code/obelus", "<obelus-repo>"],
  ]);

  it("rewrites each registered path to its placeholder", () => {
    const line =
      '{"a":"/Users/alex/papers/attention/main.md","b":"/Users/alex/code/obelus/plugin/SKILL.md"}';
    const out = sanitizeLine(line, replacements);
    assert.match(out, /<paper-root>\/main\.md/);
    assert.match(out, /<obelus-repo>\/plugin\/SKILL\.md/);
    assert.ok(!leaksMachinePath(out));
  });

  it("replaces the nested workspace path before its repo-root ancestor", () => {
    const ordered = orderReplacements([
      ["/Users/alex/code/obelus", "<obelus-repo>"],
      ["/Users/alex/code/obelus/projects/p1", "<workspace>"],
    ]);
    const line = '{"file_path":"/Users/alex/code/obelus/projects/p1/plan.json"}';
    const out = sanitizeLine(line, ordered);
    assert.match(out, /<workspace>\/plan\.json/);
    assert.doesNotMatch(out, /<obelus-repo>\/projects/);
  });

  it("collapses an unregistered home path via the generic fallback", () => {
    const line = '{"file_path":"/Users/alex/.claude/projects/abc.jsonl"}';
    const out = sanitizeLine(line, replacements);
    assert.match(out, /<home>\/\.claude/);
    assert.ok(!leaksMachinePath(out));
  });

  it("handles Linux /home and the hostname token sweep", () => {
    const linux = orderReplacements([["/home/bob/.local/share/obelus/p1", "<workspace>"]]);
    const out = sanitizeLine(
      '{"file_path":"/home/bob/.local/share/obelus/p1/plan.json","host":"bob-laptop"}',
      linux,
      ["bob-laptop"],
    );
    assert.match(out, /<workspace>\/plan\.json/);
    assert.match(out, /"host":"<host>"/);
    assert.ok(!leaksMachinePath(out, ["bob-laptop"]));
  });

  it("scrubs a JSON-escaped Windows user path", () => {
    const line = '{"file_path":"C:\\\\Users\\\\carol\\\\obelus\\\\plan.json"}';
    const out = sanitizeLine(line, []);
    assert.ok(!leaksMachinePath(out));
    assert.match(out, /<home>/);
  });

  it("leaves an already-sanitised placeholder line untouched", () => {
    const line = '{"event":"phase","name":"<pre-phase>"}';
    assert.strictEqual(sanitizeLine(line, replacements), line);
  });
});

describe("leaksMachinePath", () => {
  it("flags a raw /Users path and a bare hostname token", () => {
    assert.ok(leaksMachinePath('{"p":"/Users/alex/x"}'));
    assert.ok(leaksMachinePath('{"host":"alex-box"}', ["alex-box"]));
  });

  it("passes a fully placeholdered line", () => {
    assert.ok(!leaksMachinePath('{"p":"<workspace>/plan.json","q":"<paper-root>/a.md"}'));
  });
});
