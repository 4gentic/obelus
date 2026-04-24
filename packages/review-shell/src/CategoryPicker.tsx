import { DEFAULT_CATEGORIES } from "@obelus/categories";
import "./CategoryPicker.css";

import type { JSX } from "react";

type Props = {
  value: string | null;
  onChange: (next: string) => void;
  name: string;
  disabled?: boolean;
  invalid?: boolean;
  errorId?: string;
};

export default function CategoryPicker({
  value,
  onChange,
  name,
  disabled = false,
  invalid = false,
  errorId,
}: Props): JSX.Element {
  return (
    <fieldset
      className="catpick"
      disabled={disabled}
      data-invalid={invalid ? "true" : "false"}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && errorId ? errorId : undefined}
    >
      <legend className="catpick__legend">Category</legend>
      <div className="catpick__row" role="radiogroup">
        {DEFAULT_CATEGORIES.map((c) => {
          const checked = value === c.id;
          return (
            <label
              key={c.id}
              className="catpick__chip"
              data-checked={checked ? "true" : "false"}
              style={{ ["--chip-color" as string]: `var(${c.tokenVar})` }}
            >
              <input
                type="radio"
                name={name}
                value={c.id}
                checked={checked}
                onChange={() => onChange(c.id)}
                className="catpick__input"
              />
              <span className="catpick__label">{c.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
