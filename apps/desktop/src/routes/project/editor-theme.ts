import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Palette mirrors `packages/design-tokens/src/tokens.css`. Values are
// embedded (not read from computed style) because CodeMirror creates its
// own CSS classes and needs literal colors at extension-build time.
const PAPER = "#F6F1E7";
const PANEL = "#EDE5D3";
const INK = "#2B2A26";
const INK_SOFT = "#6B655A";
const RUBRIC = "#B84A2E";
const HL_CITE = "#5e8d6e";
const RULE_SOFT = "#D9CFB9";

const base = EditorView.theme(
  {
    "&": {
      color: INK,
      backgroundColor: PAPER,
      height: "100%",
      fontFamily: "var(--font-mono), 'JetBrains Mono', monospace",
      fontSize: "13px",
    },
    ".cm-content": {
      caretColor: INK,
      padding: "12px 0",
    },
    ".cm-scroller": {
      fontFamily: "inherit",
      lineHeight: "1.5",
    },
    ".cm-gutters": {
      backgroundColor: PANEL,
      color: INK_SOFT,
      border: "none",
      borderRight: `1px solid ${RULE_SOFT}`,
    },
    ".cm-activeLineGutter": {
      backgroundColor: PANEL,
      color: INK,
    },
    ".cm-activeLine": {
      backgroundColor: "transparent",
    },
    "&.cm-focused .cm-activeLine": {
      backgroundColor: `color-mix(in oklab, ${PANEL} 60%, ${PAPER})`,
    },
    // CodeMirror paints selections through two painters:
    //  1. `.cm-selectionBackground` — a rect overlay `drawSelection` lays over
    //     glyph boxes. Dominant for multi-line ranges.
    //  2. Native `::selection` — the pseudo-element on the actual text. What
    //     you see for single-line intra-line ranges and for blurred-window.
    //
    // CM's `drawSelection` extension injects
    //   `.ͼN .cm-line ::selection { background: transparent !important }`
    // which is 2-class + pseudo = (0,2,1). To win reliably our selectors
    // must out-specify that: `&.cm-editor .cm-line ::selection` is (0,3,1)
    // because the editor root carries both `&` (theme class) and `.cm-editor`.
    // Same band color on both painters so the selection reads identically
    // whether focused, blurred, single-line, or multi-line.
    "&.cm-editor .cm-selectionBackground, &.cm-editor.cm-focused .cm-selectionBackground": {
      backgroundColor: `color-mix(in oklab, ${RUBRIC} 32%, ${PAPER}) !important`,
    },
    "&.cm-editor .cm-line ::selection, &.cm-editor .cm-line::selection, &.cm-editor .cm-content ::selection, &.cm-editor ::selection, &.cm-editor::selection":
      {
        backgroundColor: `color-mix(in oklab, ${RUBRIC} 32%, ${PAPER}) !important`,
        color: `${INK} !important`,
      },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: INK,
    },
    ".cm-panels": {
      backgroundColor: PANEL,
      color: INK,
    },
    ".cm-panels.cm-panels-bottom": {
      borderTop: `1px solid ${RULE_SOFT}`,
    },
    ".cm-searchMatch": {
      backgroundColor: `color-mix(in oklab, ${RUBRIC} 18%, ${PAPER})`,
      outline: `1px solid ${RUBRIC}`,
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      outline: `1px solid ${INK_SOFT}`,
      backgroundColor: "transparent",
    },
  },
  { dark: false },
);

// Two-accent syntax: keyword-ish in rubric, comment/quote in ink-soft.
// No rainbow coloring — keeps the editorial palette intact.
const highlight = HighlightStyle.define([
  { tag: [t.heading], color: INK, fontWeight: "600" },
  { tag: [t.strong], fontWeight: "600" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.link, t.url], color: HL_CITE, textDecoration: "underline" },
  { tag: [t.monospace, t.literal], color: INK },
  { tag: [t.keyword, t.tagName, t.operator, t.bracket], color: RUBRIC },
  { tag: [t.string, t.attributeValue], color: HL_CITE },
  { tag: [t.comment, t.meta, t.quote], color: INK_SOFT, fontStyle: "italic" },
  { tag: [t.attributeName, t.propertyName], color: INK_SOFT },
  { tag: [t.number], color: HL_CITE },
  { tag: [t.invalid], color: RUBRIC },
]);

export function editorTheme(): Extension {
  return [base, syntaxHighlighting(highlight)];
}
