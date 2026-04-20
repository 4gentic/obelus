# Twitter launch thread

Eight tweets. No hashtags, no emoji, no link until the last.

## Thread

1/ When a model writes the paper, writing is cheap. The work is review — reading closely enough to mark what's wrong, what's vague, what has no citation, what's been quietly plagiarized from a plausible-sounding nowhere.

2/ Obelus is a review surface for that problem. Open the web app, drop a PDF, highlight the passages you doubt. Categorize each mark: unclear, wrong, weak, needs-cite. Thread comments on any annotation. Export one file.

3/ That file is a review bundle — JSON, versioned, with enough context around each quote to locate the passage in source that has different hyphenation, ligatures, or reflow than the PDF.

4/ The web app never touches the network at runtime. PDFs live in the browser's origin-private filesystem; annotations live in IndexedDB. There is one opt-in call to a counter endpoint when you export. Thirty lines of open Worker code, storing a single integer.

5/ In your paper's repo, the Claude Code plugin takes over. `/apply-revision bundle.json` detects whether your source is LaTeX, Markdown, or Typst, plans a minimal-diff fix for each mark, and waits for your confirmation before writing anything.

6/ The plugin is ordinary files under `.claude/`. No hosted service behind it. The web app and the plugin share one Zod schema and nothing else — the bundle is the seam.

7/ MIT-licensed. Installable as a PWA; fully functional offline after first load. Self-hosted fonts, no CDN, no analytics, no account. Your draft stays on your machine.

8/ obelus.app
