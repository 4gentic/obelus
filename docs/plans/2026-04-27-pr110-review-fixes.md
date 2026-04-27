# PR 110 Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Fix the 5 issues found during code review of PR 110 (feat/pdf-polish): a pan-mode bug that silently breaks on desktop, a CLAUDE.md parity violation placing zoom controls in desktop-only code, and three comment-style violations.

**Architecture:** Two substantive changes — (1) replace the hard-coded `.review-shell__scroll` selector in `SelectionListener` and `adapter.tsx` with a computed-overflow ancestor walk (following the pattern already in `packages/md-view/src/adapter.tsx`), and (2) move `pdf-zoom-store.ts` and `PdfZoomControls.tsx` from `apps/desktop/…` into `packages/pdf-view/src/` and wire the web app's PDF surface to the same zoom state. Three comment-only edits are batched into a single commit first.

**Tech Stack:** TypeScript, React 19, `useSyncExternalStore`, Vite/pnpm monorepo. Tests run with Vitest (`pnpm test`). Typecheck with `pnpm verify`.

---

## Task 1: Fix three comment-style violations (issues 3, 4, 5)

Three independent one-line (or one-block) text edits. No logic change.

**Files:**
- Modify: `apps/desktop/src/routes/project/project.css:104-107`
- Modify: `apps/desktop/src/routes/project/DiffReview.tsx:171`
- Modify: `apps/desktop/src/routes/project/PaperActionsMenu.tsx:69-72`

### Step 1: Remove the stale Show-rail comment in project.css

In `apps/desktop/src/routes/project/project.css`, lines 104-107 contain a 4-line comment that describes an unimplemented design (hairline spine, vertical text label, z-index 30). The actual code is icon buttons. Delete the comment block entirely:

```css
/* Before (lines 104-107) — DELETE these four lines: */
/* Show-rail: a slim editorial spine. A 1px hairline rule with a vertical mono
   label ("files" / "review") that reads like the spine of a closed book.
   Sits above the PDF text layer (z-index: 30 > .pdf-page__text z:2) so a
   clicker can always reach it during scroll. */
.panel-toggles {
```

Result after deletion:
```css
.panel-toggles {
```

### Step 2: Remove "now-scrollable" from DiffReview.tsx

In `apps/desktop/src/routes/project/DiffReview.tsx`, line 171:

```ts
// Before:
  // Keep the active file row visible inside the now-scrollable list. When a

// After:
  // Keep the active file row visible when the list scrolls. When a
```

### Step 3: Trim the historical clause from PaperActionsMenu.tsx

In `apps/desktop/src/routes/project/PaperActionsMenu.tsx`, lines 69-72:

```ts
// Before:
    // Any scroll or resize closes the menu — Mac-native behaviour, and it
    // sidesteps the previous reposition complexity that left the popover
    // in a stuck state after scrolling with marks present. The user can
    // reopen with one click.

// After:
    // Any scroll or resize closes the menu — Mac-native behaviour.
    // The user can reopen with one click.
```

### Step 4: Verify no logic changed

```bash
cd /Users/juan/Projects/4gentic/obelus/.worktrees/fix-pr110-review
pnpm verify
```

Expected: all checks pass (lint, typecheck, tests, build).

### Step 5: Commit

```bash
cd /Users/juan/Projects/4gentic/obelus/.worktrees/fix-pr110-review
git add apps/desktop/src/routes/project/project.css \
        apps/desktop/src/routes/project/DiffReview.tsx \
        apps/desktop/src/routes/project/PaperActionsMenu.tsx
git commit -m "fix(comments): remove stale Show-rail block and git-history references"
```

---

## Task 2: Fix pan-mode scroll container (issue 1 — the bug)

The pan-mode handler in `packages/pdf-view/src/SelectionListener.tsx` calls
`host.closest(".review-shell__scroll")` to find its scroll container. That class
only exists inside the web app's `ReviewShell` — on desktop the PDF lives under
`.project-shell__center { overflow: auto }`. The early `if (!scroll) return` fires
on desktop, no `mousedown` listener attaches, and pan mode silently does nothing.

The same class is hard-coded in `packages/pdf-view/src/adapter.tsx:174` for
`scrollToAnnotation`, causing the same silent failure on desktop.

The fix is the same pattern already used in `packages/md-view/src/adapter.tsx`:
walk up from the element via computed style to find the first ancestor with
`overflow: auto | scroll | overlay`, falling back to `document.scrollingElement`.

**Files:**
- Modify: `packages/pdf-view/src/SelectionListener.tsx`
- Modify: `packages/pdf-view/src/adapter.tsx`

### Step 1: Add findScrollAncestor to SelectionListener.tsx

Open `packages/pdf-view/src/SelectionListener.tsx`. Find the module-level area
near the top (after imports, before the component). Add this function — it is
identical in logic to the one in `packages/md-view/src/adapter.tsx:62-74`:

```ts
// Walk up to the first scrollable ancestor. The pdf-view adapter is mounted
// both inside `.review-shell__scroll` (web ReviewShell) and inside
// `.project-shell__center { overflow: auto }` (desktop PdfPane), so
// hard-coding a wrapper class breaks one surface silently.
function findScrollAncestor(el: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const style = cur.ownerDocument?.defaultView?.getComputedStyle(cur);
    const overflow = (style?.overflowY ?? "") + (style?.overflowX ?? "");
    if (/(auto|scroll|overlay)/.test(overflow)) return cur;
    cur = cur.parentElement;
  }
  return (
    (el.ownerDocument?.scrollingElement as HTMLElement | null) ??
    el.ownerDocument?.documentElement ??
    el
  );
}
```

### Step 2: Replace the hard-coded selector in the pan-mode effect

In `packages/pdf-view/src/SelectionListener.tsx`, within the pan-mode `useEffect`
(around lines 209-260), find:

```ts
    const scroll = host.closest<HTMLElement>(".review-shell__scroll");
    if (!scroll) return;
```

Replace with:

```ts
    const scroll = findScrollAncestor(host);
```

The `if (!scroll) return` guard is no longer needed because `findScrollAncestor`
always returns an element (falls back to `documentElement`). Remove that line.

Also update the JSDoc comment on the `panMode` prop in `packages/pdf-view/src/adapter.tsx`
around line 82 — it currently says "scrolls the surrounding `.review-shell__scroll`
container". Change it to: "mousedown-drag scrolls the nearest scrollable ancestor
instead of starting a text selection".

### Step 3: Fix the same bug in adapter.tsx (scrollToAnnotation)

In `packages/pdf-view/src/adapter.tsx`, the `scrollToAnnotation` callback (around
line 172) also hard-codes the selector. Add `findScrollAncestor` to this file too
(same implementation), then replace:

```ts
      const scroll = containerRef.current?.closest<HTMLElement>(".review-shell__scroll");
      if (!scroll) return;
```

With:

```ts
      const container = containerRef.current;
      if (!container) return;
      const scroll = findScrollAncestor(container);
```

Also remove the now-stale comment block above `scrollToAnnotation` that says
"is `.review-shell__scroll`, not this adapter's own root".

### Step 4: Run tests and typecheck

```bash
cd /Users/juan/Projects/4gentic/obelus/.worktrees/fix-pr110-review
pnpm verify
```

Expected: all checks pass. There are no automated tests for the pan interaction
itself (it's DOM-event driven), but typecheck must be clean.

### Step 5: Commit

```bash
cd /Users/juan/Projects/4gentic/obelus/.worktrees/fix-pr110-review
git add packages/pdf-view/src/SelectionListener.tsx \
        packages/pdf-view/src/adapter.tsx
git commit -m "fix(pdf-view): use computed-overflow ancestor walk for pan and scroll-to-annotation"
```

---

## Task 3: Move zoom store to packages/pdf-view (issue 2 — parity)

`pdf-zoom-store.ts` and `PdfZoomControls.tsx` live in
`apps/desktop/src/routes/project/`. The web app also renders PDFs through
`packages/pdf-view` (`apps/web/src/routes/review.tsx:474`), so zoom is a shared
affordance per CLAUDE.md's parity rule. This task moves both files into the shared
package and wires the web app's PDF surface to the same state.

**Files:**
- Create: `packages/pdf-view/src/zoom-store.ts` (moved from apps/desktop)
- Create: `packages/pdf-view/src/ZoomControls.tsx` (moved from apps/desktop)
- Modify: `packages/pdf-view/src/index.ts` (add exports)
- Modify: `apps/desktop/src/routes/project/PdfPane.tsx` (update import path)
- Modify: `apps/desktop/src/routes/project/CenterPane.tsx` (update import path)
- Modify: `apps/desktop/src/routes/project/ProjectShell.tsx` (update import path)
- Delete: `apps/desktop/src/routes/project/pdf-zoom-store.ts`
- Delete: `apps/desktop/src/routes/project/PdfZoomControls.tsx`
- Modify: `apps/web/src/routes/review.tsx` (wire zoom state + render ZoomControls)

### Step 1: Copy pdf-zoom-store.ts into the shared package

Create `packages/pdf-view/src/zoom-store.ts` with the exact same content as
`apps/desktop/src/routes/project/pdf-zoom-store.ts` — no logic changes needed.
The file is already pure TS with no desktop-specific imports.

### Step 2: Copy PdfZoomControls.tsx into the shared package

Create `packages/pdf-view/src/ZoomControls.tsx` from
`apps/desktop/src/routes/project/PdfZoomControls.tsx`.

Update the one import inside it from a relative desktop path to the shared module:

```ts
// Before:
import {
  bumpPdfZoom,
  PDF_ZOOM_BASE,
  ...
} from "./pdf-zoom-store";

// After:
import {
  bumpPdfZoom,
  PDF_ZOOM_BASE,
  ...
} from "./zoom-store";
```

No other changes — the component has no desktop-specific imports.

### Step 3: Add exports to packages/pdf-view/src/index.ts

Append to `packages/pdf-view/src/index.ts`:

```ts
export {
  bumpPdfZoom,
  getPdfAutoScale,
  getPdfTool,
  getPdfZoom,
  PDF_ZOOM_BASE,
  PDF_ZOOM_MAX,
  PDF_ZOOM_MIN,
  PDF_ZOOM_STEP,
  setPdfAutoScale,
  setPdfTool,
  setPdfZoom,
  type PdfTool,
  usePanCapable,
  usePdfAutoScale,
  usePdfTool,
  usePdfZoom,
} from "./zoom-store";
export { default as PdfZoomControls } from "./ZoomControls";
```

Note: verify the exact export names by reading `zoom-store.ts` — export only what
is actually exported from that file.

### Step 4: Update desktop imports — PdfPane.tsx

In `apps/desktop/src/routes/project/PdfPane.tsx`, the imports from `./pdf-zoom-store`
become imports from `@obelus/pdf-view`:

```ts
// Before:
import { setPdfAutoScale, usePdfTool, usePdfZoom } from "./pdf-zoom-store";

// After:
import { setPdfAutoScale, usePdfTool, usePdfZoom } from "@obelus/pdf-view";
```

### Step 5: Update desktop imports — CenterPane.tsx

In `apps/desktop/src/routes/project/CenterPane.tsx`:

```ts
// Before:
import PdfZoomControls from "./PdfZoomControls";

// After:
import { PdfZoomControls } from "@obelus/pdf-view";
```

### Step 6: Update desktop imports — ProjectShell.tsx

In `apps/desktop/src/routes/project/ProjectShell.tsx`:

```ts
// Before:
import { bumpPdfZoom, setPdfZoom } from "./pdf-zoom-store";

// After:
import { bumpPdfZoom, setPdfZoom } from "@obelus/pdf-view";
```

### Step 7: Delete the now-redundant desktop files

```bash
cd /Users/juan/Projects/4gentic/obelus/.worktrees/fix-pr110-review
rm apps/desktop/src/routes/project/pdf-zoom-store.ts
rm apps/desktop/src/routes/project/PdfZoomControls.tsx
```

### Step 8: Wire zoom state into the web app's PDF surface

In `apps/web/src/routes/review.tsx`, the `usePdfSurface` function (line 470) calls
`usePdfDocumentView` without zoom parameters. Update it to pass zoom state, using
the same pattern as `PdfPane.tsx` on desktop.

First, find where `paperId` is available in the calling scope. `usePdfSurface` is
called inside `ReviewContent` (or `ReviewBody`) which receives a `state` prop
containing the paper. The `paperId` route param is already read at line 59 with
`useParams()`. Thread it down or read it inside `usePdfSurface` via `useParams`.

The simplest approach — add a `paperId` parameter to `usePdfSurface`:

```ts
// Before:
function usePdfSurface(
  props: ReviewContentProps,
  state: Extract<ReviewContentProps["state"], { kind: "ready-pdf" }>,
): DocumentView {
  return usePdfDocumentView({
    doc: state.doc,
    annotations: props.annotations,
    selectedAnchor: props.selectedAnchor,
    draftCategory: props.draftCategory,
    focusedId: props.focusedAnnotationId,
    onAnchor: props.onAnchor,
    onFocusMark: props.onFocusMark,
  });
}

// After:
function usePdfSurface(
  props: ReviewContentProps,
  state: Extract<ReviewContentProps["state"], { kind: "ready-pdf" }>,
  paperId: string,
): DocumentView {
  const zoomOverride = usePdfZoom(paperId);
  const tool = usePdfTool(paperId);
  const onAutoScaleChange = useCallback(
    (scale: number) => { setPdfAutoScale(paperId, scale); },
    [paperId],
  );
  const panMode = tool === "pan";
  return usePdfDocumentView({
    doc: state.doc,
    annotations: props.annotations,
    selectedAnchor: props.selectedAnchor,
    draftCategory: props.draftCategory,
    focusedId: props.focusedAnnotationId,
    onAnchor: props.onAnchor,
    onFocusMark: props.onFocusMark,
    zoomOverride,
    onAutoScaleChange,
    panMode,
  });
}
```

Add the needed imports at the top of `review.tsx`:

```ts
import {
  PdfZoomControls,
  setPdfAutoScale,
  usePdfTool,
  usePdfZoom,
} from "@obelus/pdf-view";
```

And `useCallback` is already imported from React in this file (verify first).

### Step 9: Render PdfZoomControls in the web app's review header

Find the call-site(s) where `usePdfSurface` is called (search for `usePdfSurface`
in `review.tsx`). Pass the paperId:

```ts
// Before (wherever usePdfSurface is called):
const documentView = usePdfSurface(props, state);

// After:
const documentView = usePdfSurface(props, state, paperId);
```

Then find `ReviewBody` (around line 650) where `ReviewShell` is rendered with its
`header` prop. When the paper kind is PDF, append `PdfZoomControls` to the header.
The `paperId` is already available in `ReviewBody`'s calling scope via the outer
`paperId` from `useParams`.

```tsx
// Find the ReviewShell render and update the header when the state is a PDF:
<ReviewShell
  documentView={documentView}
  header={
    <>
      <ReviewBreadcrumb paper={state.paper} onRename={props.onRenamePaper} />
      {state.kind === "ready-pdf" && paperId != null && (
        <PdfZoomControls paperId={paperId} />
      )}
    </>
  }
  ...
/>
```

Note: read the actual `ReviewBody` code first to confirm the exact shape — the
above is the pattern, not a copy-paste.

### Step 10: Run verify

```bash
cd /Users/juan/Projects/4gentic/obelus/.worktrees/fix-pr110-review
pnpm verify
```

Expected: all checks pass — lint, typecheck, tests, network guard, build. If
typecheck fails, it will point you to any import that needs adjustment.

### Step 11: Commit

```bash
cd /Users/juan/Projects/4gentic/obelus/.worktrees/fix-pr110-review
git add packages/pdf-view/src/zoom-store.ts \
        packages/pdf-view/src/ZoomControls.tsx \
        packages/pdf-view/src/index.ts \
        apps/desktop/src/routes/project/PdfPane.tsx \
        apps/desktop/src/routes/project/CenterPane.tsx \
        apps/desktop/src/routes/project/ProjectShell.tsx \
        apps/web/src/routes/review.tsx
git rm apps/desktop/src/routes/project/pdf-zoom-store.ts \
       apps/desktop/src/routes/project/PdfZoomControls.tsx
git commit -m "refactor(pdf-view): move zoom store + controls to shared package, wire web surface"
```

---

## Final check

After all three commits, confirm the branch is in a clean, verified state:

```bash
cd /Users/juan/Projects/4gentic/obelus/.worktrees/fix-pr110-review
pnpm verify
git log --oneline -5
```

Expected output: 3 commits on top of the merge of `origin/pdf-polish`, and a
clean `pnpm verify`.
