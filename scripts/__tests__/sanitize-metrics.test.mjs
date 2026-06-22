// Run with:  node --test scripts/__tests__/sanitize-metrics.test.mjs
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  expandScratchForms,
  leaksMachinePath,
  orderReplacements,
  sanitizeLine,
} from "../lib/sanitize-metrics.mjs";

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

  it("flags a raw /var/folders scratch path (and the /private realpath form)", () => {
    assert.ok(leaksMachinePath('{"p":"/var/folders/sq/abc/T/obelus-capture-x/sample.md"}'));
    assert.ok(leaksMachinePath('{"p":"/private/var/folders/sq/abc/T/obelus-capture-x/sample.md"}'));
  });

  it("flags a scratch fragment truncated mid-path inside an embedded blob", () => {
    // The `...` is the metric summariser's truncation marker — the directory is
    // severed, but the gate must still catch the surviving `/var/folders/` run.
    assert.ok(leaksMachinePath('{"input":"{\\"bundleId\\":\\"/var/folders/sq/tn9g1sb1..."}'));
  });

  it("flags a /tmp scratch path in both symlink and realpath form", () => {
    assert.ok(leaksMachinePath('{"p":"/tmp/obelus-capture-x/bundle.json"}'));
    assert.ok(leaksMachinePath('{"p":"/private/tmp/obelus-capture-x/bundle.json"}'));
  });

  it("flags a dangling /private<placeholder> artifact", () => {
    assert.ok(leaksMachinePath('{"file_path":"/private<paper-root>/sample.md"}'));
    assert.ok(leaksMachinePath('{"file_path":"/private<workspace>/plan.json"}'));
  });
});

// macOS reports tmp paths through the `/private` realpath. The harness
// registers the bare `os.tmpdir()` form; expandScratchForms adds the twin so a
// contiguous occurrence in either form is rewritten whole, with no dangling
// `/private`. These pin the two leak forms that escaped the first real capture.
describe("expandScratchForms", () => {
  it("adds the /private twin for a bare /var/folders prefix", () => {
    const out = expandScratchForms([
      ["/var/folders/sq/abc/T/obelus-capture-x/paper", "<paper-root>"],
    ]);
    const paths = out.map(([p]) => p);
    assert.ok(paths.includes("/var/folders/sq/abc/T/obelus-capture-x/paper"));
    assert.ok(paths.includes("/private/var/folders/sq/abc/T/obelus-capture-x/paper"));
  });

  it("adds the bare twin for a /private-prefixed prefix and is idempotent", () => {
    const out = expandScratchForms([["/private/tmp/obelus-capture-x", "<workspace>"]]);
    const paths = out.map(([p]) => p);
    assert.ok(paths.includes("/private/tmp/obelus-capture-x"));
    assert.ok(paths.includes("/tmp/obelus-capture-x"));
    // No duplicate entries on a second pass.
    assert.deepEqual(expandScratchForms(out), out);
  });

  it("leaves a non-scratch path (home/repo) untouched", () => {
    const out = expandScratchForms([["/Users/alex/code/obelus", "<obelus-repo>"]]);
    assert.deepEqual(out, [["/Users/alex/code/obelus", "<obelus-repo>"]]);
  });

  it("registering both forms scrubs a /private/var realpath input with no dangling /private", () => {
    // Reproduces leak #1: the OS reports `/private/var/folders/...` for the
    // paper-root, the harness registered the bare `/var/folders/...` form.
    const ordered = orderReplacements(
      expandScratchForms([
        [
          "/var/folders/sq/tn9g1sb17cx3b48f_1r20q5c0000gn/T/obelus-capture-a3dfbf90/paper",
          "<paper-root>",
        ],
      ]),
    );
    const line =
      '{"input":"{\\"file_path\\":\\"/private/var/folders/sq/tn9g1sb17cx3b48f_1r20q5c0000gn/T/obelus-capture-a3dfbf90/paper/sample.md\\"}"}';
    const out = sanitizeLine(line, ordered);
    assert.match(out, /<paper-root>\/sample\.md/);
    assert.doesNotMatch(out, /\/private/);
    assert.ok(!leaksMachinePath(out));
  });

  it("scrubs a bare-form input when only the /private form was registered", () => {
    const ordered = orderReplacements(
      expandScratchForms([
        ["/private/var/folders/sq/abc/T/obelus-capture-x/workspace", "<workspace>"],
      ]),
    );
    const line = '{"file_path":"/var/folders/sq/abc/T/obelus-capture-x/workspace/plan.json"}';
    const out = sanitizeLine(line, ordered);
    assert.match(out, /<workspace>\/plan\.json/);
    assert.ok(!leaksMachinePath(out));
  });
});

// The OS-scratch catch-all + the /private-artifact cleanup. These pin the two
// concrete leaks from the first real capture against the actual scratch root.
describe("sanitizeLine — OS scratch paths", () => {
  it("strips a dangling /private glued to a placeholder", () => {
    // Reproduces leak #1 post-rewrite: bare-form registration matched the tail,
    // leaving `/private<paper-root>`. The artifact cleanup removes it.
    const line = '{"input":"{\\"file_path\\":\\"/private<paper-root>/sample.md\\"}"}';
    const out = sanitizeLine(line, []);
    assert.match(out, /<paper-root>\/sample\.md/);
    assert.doesNotMatch(out, /\/private/);
    assert.ok(!leaksMachinePath(out));
  });

  it("collapses a scratch path truncated mid-path inside embedded content", () => {
    // Reproduces leak #2: a Write tool-call's `input` embeds the plan JSON whose
    // `bundleId` is a raw scratch path; summariseToolInput cut it at ~200 chars,
    // so the full registered prefix is no longer contiguous. The catch-all sweep
    // collapses the surviving `/var/folders/...` fragment to <scratch>.
    const line =
      '{"event":"tool-call","name":"Write","input":"{\\"file_path\\":\\"<workspace>/plan.json\\",\\"content\\":\\"{\\\\n  \\\\\\"bundleId\\\\\\": \\\\\\"/var/folders/sq/tn9g1sb17cx3b48f_1r20q5c0..."}';
    const out = sanitizeLine(line, []);
    assert.doesNotMatch(out, /\/var\/folders/);
    assert.match(out, /<scratch>/);
    assert.ok(!leaksMachinePath(out));
  });

  it("collapses a full untruncated /var/folders bundle path to <scratch>", () => {
    const line = '{"p":"/var/folders/sq/abc/T/obelus-capture-x/workspace/bundle.json"}';
    const out = sanitizeLine(line, []);
    assert.match(out, /<scratch>/);
    assert.doesNotMatch(out, /\/var\/folders/);
    assert.ok(!leaksMachinePath(out));
  });

  it("collapses /tmp and /private/tmp scratch paths", () => {
    assert.ok(!leaksMachinePath(sanitizeLine('{"p":"/tmp/obelus-capture-x/a"}', [])));
    assert.ok(!leaksMachinePath(sanitizeLine('{"p":"/private/tmp/obelus-capture-x/a"}', [])));
  });
});
