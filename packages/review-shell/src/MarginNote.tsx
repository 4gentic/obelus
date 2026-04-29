import { type Category, descriptionFor } from "@obelus/categories";
import type { AnnotationRow } from "@obelus/repo";
import "./MarginNote.css";

import type { JSX } from "react";

type Props = {
  annotation: AnnotationRow;
  top: number;
  focused?: boolean;
  onSelect?: (id: string) => void;
  onRef?: (id: string, el: HTMLElement | null) => void;
};

const categoryVar: Record<Category, string> = {
  remove: "--hl-remove",
  elaborate: "--hl-elaborate",
  rephrase: "--hl-rephrase",
  improve: "--hl-improve",
  wrong: "--hl-wrong",
  "weak-argument": "--hl-weak",
  praise: "--hl-praise",
  note: "--hl-note",
};

const categoryLabel: Record<Category, string> = {
  remove: "remove",
  elaborate: "elaborate",
  rephrase: "rephrase",
  improve: "improve",
  wrong: "wrong",
  "weak-argument": "weak argument",
  praise: "praise",
  note: "note",
};

function isCategory(value: string): value is Category {
  return value in categoryVar;
}

export default function MarginNote({
  annotation,
  top,
  focused,
  onSelect,
  onRef,
}: Props): JSX.Element {
  const cat: Category = isCategory(annotation.category) ? annotation.category : "note";
  const token = categoryVar[cat];
  return (
    <button
      type="button"
      className="margin-note"
      data-focused={focused ? "true" : undefined}
      style={{ top, ["--chip-color" as string]: `var(${token})` }}
      onClick={() => onSelect?.(annotation.id)}
      ref={(el) => onRef?.(annotation.id, el)}
    >
      <span className="margin-note__chip cat-tooltip" data-cat-tooltip={descriptionFor(cat)}>
        {categoryLabel[cat]}
      </span>
      <span className="margin-note__body">{annotation.note}</span>
    </button>
  );
}
