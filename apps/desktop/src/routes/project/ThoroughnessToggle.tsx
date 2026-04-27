import type { JSX } from "react";
import { type ReviewerThoroughness, THOROUGHNESS_COPY } from "../../lib/reviewer-thoroughness";

const ORDER: ReadonlyArray<ReviewerThoroughness> = ["normal", "deep"];

interface ThoroughnessToggleProps {
  value: ReviewerThoroughness;
  onChange: (next: ReviewerThoroughness) => void;
  disabled: boolean;
  name: string;
}

export default function ThoroughnessToggle({
  value,
  onChange,
  disabled,
  name,
}: ThoroughnessToggleProps): JSX.Element {
  return (
    <fieldset className="thoroughness-toggle" disabled={disabled}>
      <legend className="visually-hidden">Reviewer thoroughness</legend>
      {ORDER.map((option) => {
        const copy = THOROUGHNESS_COPY[option];
        const active = value === option;
        return (
          <label
            key={option}
            className={`thoroughness-toggle__btn${active ? " thoroughness-toggle__btn--on" : ""}`}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={active}
              onChange={() => onChange(option)}
              className="visually-hidden"
            />
            <span className="thoroughness-toggle__btn-label">{copy.label}</span>
            <span className="thoroughness-toggle__hint" role="tooltip">
              <span className="thoroughness-toggle__hint-model">{copy.modelLabel}</span>
              <span className="thoroughness-toggle__hint-blurb">{copy.blurb}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
