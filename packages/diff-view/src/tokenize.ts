// Word-granularity tokens for the prose redline, with one twist: a math span or
// a markup call is kept whole. Diffing `["$a$", " ", "when"]` against
// `["$b$", " ", "where"]` then marks the old formula struck and the new one
// added, instead of jsdiff aligning `$`, `a`, `(`, `)` against unrelated prose
// and shredding the formula. Concatenating the returned tokens reproduces the
// input byte-for-byte — whitespace runs are tokens too — so the renderer can
// join any contiguous run back into the original text.

// Walks a bracketed group starting at `open` (which must sit on the opening
// delimiter). Counts nested same-kind brackets and skips double-quoted strings
// so a `"` inside an argument — `#text(weight: "bold")`, `$italic("a)b")$` —
// doesn't end the group early. Returns the index just past the matching close,
// or null if the group never closes (unbalanced — caller falls back).
function scanBalanced(text: string, open: number, openCh: string, closeCh: string): number | null {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') {
        // A backslash escapes the next char, including an escaped quote.
        if (text[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return null;
}

// A paired math delimiter: from `start` (on the opening run) find the matching
// closing run of the same `delim`, bounded to one line so a stray `$` can't
// swallow a paragraph. Returns the index past the closing delimiter, or null.
function scanMath(text: string, start: number, delim: string): number | null {
  let i = start + delim.length;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") return null;
    if (text.startsWith(delim, i)) return i + delim.length;
    i += 1;
  }
  return null;
}

const IDENT = /[A-Za-z][A-Za-z0-9_-]*/y;
const LATEX_NAME = /\\[A-Za-z]+/y;
const WORD = /[\p{L}\p{N}]+/uy;
const PUNCT = /[^\s\p{L}\p{N}]+/uy;
const SPACE = /\s+/y;

function matchAt(re: RegExp, text: string, at: number): string | null {
  re.lastIndex = at;
  const m = re.exec(text);
  return m ? m[0] : null;
}

// Length of an atomic protected span starting at `i`, or 0 if none begins there.
// Unbalanced or unterminated sigils return 0 so the caller emits them as
// ordinary punctuation rather than hanging or consuming to end-of-string.
function protectedSpanLength(text: string, i: number): number {
  const ch = text[i];

  if (ch === "$") {
    const delim = text.startsWith("$$", i) ? "$$" : "$";
    const end = scanMath(text, i, delim);
    return end === null ? 0 : end - i;
  }

  if (ch === "\\") {
    if (text.startsWith("\\(", i)) {
      const end = text.indexOf("\\)", i + 2);
      return end === -1 ? 0 : end + 2 - i;
    }
    if (text.startsWith("\\[", i)) {
      const end = text.indexOf("\\]", i + 2);
      return end === -1 ? 0 : end + 2 - i;
    }
    const name = matchAt(LATEX_NAME, text, i);
    if (name === null) return 0;
    let end = i + name.length;
    // At most one balanced {…} or […] argument belongs to the command.
    const argCh = text[end];
    if (argCh === "{") {
      const close = scanBalanced(text, end, "{", "}");
      if (close !== null) end = close;
    } else if (argCh === "[") {
      const close = scanBalanced(text, end, "[", "]");
      if (close !== null) end = close;
    }
    return end - i;
  }

  if (ch === "#") {
    const name = matchAt(IDENT, text, i + 1);
    if (name === null) return 0;
    const groupAt = i + 1 + name.length;
    const groupCh = text[groupAt];
    if (groupCh === "(") {
      const close = scanBalanced(text, groupAt, "(", ")");
      return close === null ? 0 : close - i;
    }
    if (groupCh === "[") {
      const close = scanBalanced(text, groupAt, "[", "]");
      return close === null ? 0 : close - i;
    }
    return 0;
  }

  return 0;
}

export function tokenizeRich(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const space = matchAt(SPACE, text, i);
    if (space !== null) {
      tokens.push(space);
      i += space.length;
      continue;
    }

    const protectedLen = protectedSpanLength(text, i);
    if (protectedLen > 0) {
      tokens.push(text.slice(i, i + protectedLen));
      i += protectedLen;
      continue;
    }

    const word = matchAt(WORD, text, i);
    if (word !== null) {
      tokens.push(word);
      i += word.length;
      continue;
    }

    // Punctuation run. A sigil that failed to open a protected span is part of
    // this run; carve it off as its own one-char token so the next char gets a
    // fresh chance to start a span (e.g. `$$x$$` after a lone `$`).
    const punct = matchAt(PUNCT, text, i);
    if (punct !== null) {
      const sigil = punct.search(/[$#\\]/);
      if (sigil === 0) {
        tokens.push(text[i] as string);
        i += 1;
      } else if (sigil > 0) {
        tokens.push(punct.slice(0, sigil));
        i += sigil;
      } else {
        tokens.push(punct);
        i += punct.length;
      }
      continue;
    }

    // Unreachable: SPACE, WORD, and PUNCT together cover every code point.
    tokens.push(text[i] as string);
    i += 1;
  }
  return tokens;
}
