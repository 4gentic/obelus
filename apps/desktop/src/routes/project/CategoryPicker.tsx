import { DEFAULT_CATEGORIES } from "@obelus/categories";
import type { JSX } from "react";

interface Props {
  value: string | null;
  onChange: (slug: string) => void;
  invalid?: boolean;
  errorId?: string;
}

export default function CategoryPicker({
  value,
  onChange,
  invalid = false,
  errorId,
}: Props): JSX.Element {
  return (
    <fieldset
      className="category-picker"
      data-invalid={invalid ? "true" : "false"}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && errorId ? errorId : undefined}
    >
      <legend className="category-picker__legend">Category</legend>
      <div className="category-picker__chips">
        {DEFAULT_CATEGORIES.map((c) => (
          <label
            key={c.id}
            className={`category-chip${value === c.id ? " category-chip--on" : ""}`}
            style={{ ["--chip-accent" as string]: `var(${c.tokenVar})` }}
          >
            <input
              type="radio"
              name="category"
              value={c.id}
              checked={value === c.id}
              onChange={() => onChange(c.id)}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
