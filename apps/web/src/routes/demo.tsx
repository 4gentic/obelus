import { categoryMeta } from "@obelus/categories";
import { InlineChange } from "@obelus/diff-view";
import "@obelus/diff-view/diff-view.css";
import type { CSSProperties, JSX } from "react";
import { Link } from "react-router-dom";
import { SAMPLE_SEED, SAMPLE_TITLE } from "../data/sample-annotations.generated";
import {
  SAMPLE_RESULT_DIFF,
  SAMPLE_RESULT_ENTRYPOINT,
  SAMPLE_RESULT_PLAN,
  type SampleResultBlock,
} from "../data/sample-result.generated";
import "./demo.css";

function MarkSwatch({ category }: { category: string }): JSX.Element {
  const meta = categoryMeta(category);
  return (
    <span className="demo-mark__cat">
      <span
        className="demo-mark__swatch"
        aria-hidden="true"
        style={{ "--swatch": `var(${meta.tokenVar})` } as CSSProperties}
      />
      {meta.label}
    </span>
  );
}

function MarksSection(): JSX.Element {
  return (
    <section className="demo-section" aria-labelledby="demo-marks-heading">
      <header className="demo-section__head">
        <span className="demo-section__ord" aria-hidden="true">
          I
        </span>
        <div>
          <h2 id="demo-marks-heading" className="demo-section__title">
            The marks
          </h2>
          <p className="demo-section__lede">
            Seven marginal notes on this edition — the kind a reviewer leaves in the gutter. Each
            carries a category and a comment; nothing is sent anywhere.
          </p>
        </div>
      </header>
      <ol className="demo-marks">
        {SAMPLE_SEED.map((mark) => (
          <li key={mark.quote} className="demo-mark">
            <MarkSwatch category={mark.category} />
            <blockquote className="demo-mark__quote">{mark.quote}</blockquote>
            <p className="demo-mark__note">{mark.note}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlanCard({ block }: { block: SampleResultBlock }): JSX.Element {
  const isEmpty = block.emptyReason !== null;
  return (
    <li className={`demo-card${isEmpty ? " demo-card--note" : ""}`}>
      <header className="demo-card__head">
        <MarkSwatch category={block.category} />
        {isEmpty ? (
          <span className="demo-card__badge">no edit needed</span>
        ) : (
          <span className="demo-card__badge demo-card__badge--edit">edit</span>
        )}
      </header>
      <blockquote className="demo-card__quote">{block.quote}</blockquote>
      {block.whatChanges !== null && <p className="demo-card__what">{block.whatChanges}</p>}
      <p className="demo-card__why">{block.why}</p>
    </li>
  );
}

function PlanSection(): JSX.Element {
  return (
    <section className="demo-section" aria-labelledby="demo-plan-heading">
      <header className="demo-section__head">
        <span className="demo-section__ord" aria-hidden="true">
          II
        </span>
        <div>
          <h2 id="demo-plan-heading" className="demo-section__title">
            The plan
          </h2>
          <p className="demo-section__lede">
            What the engine proposes for each mark — and, more to the point, why. Three marks ask
            for an edit; four are praise that earns a line in the cover letter, not a change to the
            source.
          </p>
        </div>
      </header>
      <ol className="demo-cards">
        {SAMPLE_RESULT_PLAN.map((block) => (
          <PlanCard key={`${block.category}:${block.quote}`} block={block} />
        ))}
      </ol>
    </section>
  );
}

function DiffSection(): JSX.Element {
  return (
    <section className="demo-section" aria-labelledby="demo-diff-heading">
      <header className="demo-section__head">
        <span className="demo-section__ord" aria-hidden="true">
          III
        </span>
        <div>
          <h2 id="demo-diff-heading" className="demo-section__title">
            The changes
          </h2>
          <p className="demo-section__lede">
            The three edits proposed for <code>{SAMPLE_RESULT_ENTRYPOINT}</code>, marked the way an
            editor marks a manuscript — an apparatus note, a commentary gloss, and one reshaped line
            of the facing translation. You read each change before anything lands.
          </p>
        </div>
      </header>
      <ol className="demo-diff">
        {SAMPLE_RESULT_DIFF.map((change) => (
          <li key={change.patch} className="demo-change">
            <p className="demo-change__label">{change.label}</p>
            <InlineChange patch={change.patch} sourceText={change.sourceText} />
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function Demo(): JSX.Element {
  return (
    <article className="demo">
      <header className="demo__masthead">
        <p className="demo__kicker">The whole loop</p>
        <h1 className="demo__title">From marks to a reviewed diff.</h1>
        <p className="demo__standfirst">
          Follow one sample paper — <em>{SAMPLE_TITLE}</em> — through the entire review: the marks
          you leave, the plan an engine returns, and the diff it would apply. The author reviews
          every change before it touches a file.
        </p>
        <p className="demo__banner">
          A pre-baked example of the sample paper — no engine ran, nothing left your device.
        </p>
      </header>

      <MarksSection />
      <PlanSection />
      <DiffSection />

      <footer className="demo__foot">
        <Link to="/app" className="demo__foot-link">
          <span aria-hidden="true">&larr;</span> Back to library
        </Link>
        <Link to="/app" className="demo__foot-cta">
          Open the sample paper <span aria-hidden="true">&rarr;</span>
        </Link>
      </footer>
    </article>
  );
}
