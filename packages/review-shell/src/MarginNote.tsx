import { type Category, descriptionFor } from "@obelus/categories";
import type { AnnotationRow } from "@obelus/repo";
import "./MarginNote.css";

import type { JSX } from "react";

type Props = {
  annotation: AnnotationRow;
  top: number;
  onSelect?: (id: string) => void;
  onRef?: (id: string, el: HTMLElement | null) => void;
};

const categoryVar: Record<Category, string> = {
  unclear: "--hl-unclear",
  wrong: "--hl-wrong",
  "weak-argument": "--hl-weak",
  "citation-needed": "--hl-cite",
  rephrase: "--hl-rephrase",
  praise: "--hl-praise",
  enhancement: "--hl-enhancement",
  aside: "--hl-aside",
  flag: "--hl-flag",
};

const categoryLabel: Record<Category, string> = {
  unclear: "unclear",
  wrong: "wrong",
  "weak-argument": "weak argument",
  "citation-needed": "citation needed",
  rephrase: "rephrase",
  praise: "praise",
  enhancement: "enhancement",
  aside: "aside",
  flag: "flag",
};

function isCategory(value: string): value is Category {
  return value in categoryVar;
}

export default function MarginNote({ annotation, top, onSelect, onRef }: Props): JSX.Element {
  const cat: Category = isCategory(annotation.category) ? annotation.category : "unclear";
  const token = categoryVar[cat];
  const hasThread = annotation.thread.length > 0;
  return (
    <button
      type="button"
      className="margin-note"
      data-has-thread={hasThread ? "true" : "false"}
      style={{ top, ["--chip-color" as string]: `var(${token})` }}
      onClick={() => onSelect?.(annotation.id)}
      ref={(el) => onRef?.(annotation.id, el)}
    >
      <span className="margin-note__chip cat-tooltip" data-cat-tooltip={descriptionFor(cat)}>
        {categoryLabel[cat]}
      </span>
      <span className="margin-note__body">
        {annotation.note.length > 0 ? annotation.note : <em>(no note)</em>}
      </span>
      <svg
        className="margin-note__underline"
        viewBox="0 0 160 6"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M2 4 C 28 1, 54 5, 82 3 S 138 2, 158 4"
          fill="none"
          stroke="var(--chip-color)"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
