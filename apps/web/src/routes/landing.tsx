import { Link } from "react-router-dom";
import "./landing.css";

export default function Landing() {
  return (
    <article className="landing">
      <section className="hero">
        <h1 className="hero__headline">
          <em>Writing AI papers is cheap.</em>
          <br />
          <em>Reviewing them is the work.</em>
        </h1>
        <p className="hero__sub">
          An offline review surface for AI-assisted papers. Mark what you doubt; any coding agent
          applies the fixes.
        </p>
      </section>

      <section className="doors" aria-label="Pick your path">
        <div className="doors__grid">
          <article className="doors__col">
            <p className="doors__tag">Browser · a paper at a time</p>
            <h2 className="doors__title">
              <em>Review a paper.</em>
            </h2>
            <p className="doors__body">
              Works in the browser. Mark passages in any PDF, write margin notes, and export a
              bundle your coding agent can apply. No install, nothing uploaded.
            </p>
            <p className="doors__for">
              <strong>Best for reviewers.</strong> Also for writers doing a final self-review pass.
            </p>
            <Link to="/app" className="doors__cta">
              Open Obelus{" "}
              <span className="btn__arrow" aria-hidden="true">
                →
              </span>
            </Link>
            <p className="doors__caption">Browser · offline after first load</p>
          </article>
          <article className="doors__col">
            <p className="doors__tag">Desktop · many papers</p>
            <h2 className="doors__title">
              <em>Keep a writing desk.</em>
            </h2>
            <p className="doors__body">
              Desktop app. One desk per deadline, topic, or collaborator — drafts, reading stacks,
              and co-authors side by side. Edit source in-window, compile Typst locally, and review
              Claude's edits as a git-style diff.
            </p>
            <p className="doors__for">
              <strong>Best for writers running several drafts at once.</strong> Also for reviewers
              with a growing reading stack.
            </p>
            <a href="#desktop" className="doors__cta doors__cta--pending">
              Download the desktop app{" "}
              <span className="btn__arrow" aria-hidden="true">
                ↓
              </span>
            </a>
            <p className="doors__caption">macOS · Windows · Linux — coming soon</p>
          </article>
        </div>
      </section>

      <section className="demo" aria-label="Three-shot demo">
        <ol className="demo__grid">
          <li className="demo__panel">
            <div className="demo__frame" aria-hidden="true">
              <svg viewBox="0 0 180 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect
                  x="12"
                  y="12"
                  width="156"
                  height="96"
                  fill="none"
                  stroke="var(--ink-soft)"
                  strokeWidth="1"
                />
                <line x1="22" y1="32" x2="158" y2="32" stroke="var(--ink)" strokeWidth="1" />
                <rect
                  x="22"
                  y="44"
                  width="120"
                  height="10"
                  fill="var(--hl-unclear)"
                  opacity="0.35"
                />
                <line x1="22" y1="48" x2="158" y2="48" stroke="var(--ink)" strokeWidth="1" />
                <line x1="22" y1="62" x2="148" y2="62" stroke="var(--ink)" strokeWidth="1" />
                <line x1="22" y1="76" x2="158" y2="76" stroke="var(--ink)" strokeWidth="1" />
                <line x1="22" y1="90" x2="138" y2="90" stroke="var(--ink)" strokeWidth="1" />
              </svg>
            </div>
            <p className="demo__caption">1. Highlight.</p>
          </li>
          <li className="demo__panel">
            <div className="demo__frame" aria-hidden="true">
              <svg viewBox="0 0 180 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect
                  x="12"
                  y="12"
                  width="90"
                  height="96"
                  fill="none"
                  stroke="var(--ink-soft)"
                  strokeWidth="1"
                />
                <line x1="22" y1="32" x2="92" y2="32" stroke="var(--ink)" strokeWidth="1" />
                <rect x="22" y="44" width="60" height="10" fill="var(--hl-wrong)" opacity="0.35" />
                <line x1="22" y1="48" x2="92" y2="48" stroke="var(--ink)" strokeWidth="1" />
                <line x1="22" y1="62" x2="82" y2="62" stroke="var(--ink)" strokeWidth="1" />
                <line x1="22" y1="76" x2="92" y2="76" stroke="var(--ink)" strokeWidth="1" />
                <line x1="112" y1="46" x2="160" y2="46" stroke="var(--rubric)" strokeWidth="1" />
                <line x1="112" y1="54" x2="156" y2="54" stroke="var(--rubric)" strokeWidth="1" />
                <line x1="112" y1="62" x2="150" y2="62" stroke="var(--rubric)" strokeWidth="1" />
              </svg>
            </div>
            <p className="demo__caption">2. Annotate in the margin.</p>
          </li>
          <li className="demo__panel">
            <div className="demo__frame" aria-hidden="true">
              <svg viewBox="0 0 180 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect
                  x="40"
                  y="22"
                  width="100"
                  height="76"
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="1"
                />
                <line x1="48" y1="38" x2="132" y2="38" stroke="var(--ink-soft)" strokeWidth="1" />
                <line x1="48" y1="50" x2="124" y2="50" stroke="var(--ink-soft)" strokeWidth="1" />
                <line x1="48" y1="62" x2="128" y2="62" stroke="var(--ink-soft)" strokeWidth="1" />
                <line x1="48" y1="74" x2="116" y2="74" stroke="var(--ink-soft)" strokeWidth="1" />
                <text
                  x="90"
                  y="112"
                  fill="var(--ink-soft)"
                  fontFamily="var(--font-mono)"
                  fontSize="10"
                  textAnchor="middle"
                >
                  review.obelus.json
                </text>
              </svg>
            </div>
            <p className="demo__caption">3. Export a bundle for any coding agent.</p>
          </li>
        </ol>
      </section>

      <section className="how" aria-label="How it works">
        <h2 className="section__title">How it works.</h2>
        <ol className="how__flow" aria-label="Pipeline">
          <li className="how__step">
            <div className="how__card" aria-hidden="true">
              <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect
                  x="10"
                  y="14"
                  width="100"
                  height="56"
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="1"
                />
                <line x1="10" y1="24" x2="110" y2="24" stroke="var(--ink)" strokeWidth="1" />
                <circle cx="16" cy="19" r="1.2" fill="var(--ink-soft)" />
                <circle cx="21" cy="19" r="1.2" fill="var(--ink-soft)" />
                <circle cx="26" cy="19" r="1.2" fill="var(--ink-soft)" />
                <rect x="18" y="34" width="70" height="6" fill="var(--hl-unclear)" opacity="0.35" />
                <line x1="18" y1="38" x2="102" y2="38" stroke="var(--ink)" strokeWidth="1" />
                <line x1="18" y1="48" x2="92" y2="48" stroke="var(--ink)" strokeWidth="1" />
                <line x1="18" y1="58" x2="102" y2="58" stroke="var(--ink)" strokeWidth="1" />
              </svg>
            </div>
            <p className="how__label">
              <span className="how__title">Web app</span>
              <span className="how__sub">Mark in the browser.</span>
            </p>
          </li>
          <li className="how__arrow" aria-hidden="true">
            <span className="how__arrow-horizontal">→</span>
            <span className="how__arrow-vertical">↓</span>
          </li>
          <li className="how__step">
            <div className="how__card" aria-hidden="true">
              <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path
                  d="M28 12 L76 12 L92 28 L92 68 L28 68 Z"
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="1"
                />
                <path d="M76 12 L76 28 L92 28" fill="none" stroke="var(--ink)" strokeWidth="1" />
                <text
                  x="60"
                  y="46"
                  fill="var(--rubric)"
                  fontFamily="var(--font-mono)"
                  fontSize="7"
                  textAnchor="middle"
                >
                  review
                </text>
                <text
                  x="60"
                  y="56"
                  fill="var(--ink-soft)"
                  fontFamily="var(--font-mono)"
                  fontSize="6"
                  textAnchor="middle"
                >
                  .obelus.json
                </text>
              </svg>
            </div>
            <p className="how__label">
              <span className="how__title">Bundle</span>
              <span className="how__sub">A plain JSON file.</span>
            </p>
          </li>
          <li className="how__arrow" aria-hidden="true">
            <span className="how__arrow-horizontal">→</span>
            <span className="how__arrow-vertical">↓</span>
          </li>
          <li className="how__step">
            <div className="how__card" aria-hidden="true">
              <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect
                  x="12"
                  y="16"
                  width="96"
                  height="48"
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="1"
                />
                <text x="20" y="36" fill="var(--ink)" fontFamily="var(--font-mono)" fontSize="7">
                  $ claude
                </text>
                <text
                  x="20"
                  y="48"
                  fill="var(--ink-soft)"
                  fontFamily="var(--font-mono)"
                  fontSize="7"
                >
                  {"> applying…"}
                </text>
                <rect x="20" y="54" width="6" height="6" fill="var(--rubric)" opacity="0.5" />
              </svg>
            </div>
            <p className="how__label">
              <span className="how__title">Coding agent</span>
              <span className="how__sub">Reads the bundle.</span>
            </p>
          </li>
          <li className="how__arrow" aria-hidden="true">
            <span className="how__arrow-horizontal">→</span>
            <span className="how__arrow-vertical">↓</span>
          </li>
          <li className="how__step">
            <div className="how__card" aria-hidden="true">
              <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect
                  x="10"
                  y="14"
                  width="60"
                  height="56"
                  fill="var(--paper)"
                  stroke="var(--ink)"
                  strokeWidth="1"
                />
                <rect
                  x="26"
                  y="20"
                  width="60"
                  height="56"
                  fill="var(--paper)"
                  stroke="var(--ink)"
                  strokeWidth="1"
                />
                <rect
                  x="42"
                  y="26"
                  width="60"
                  height="46"
                  fill="var(--paper)"
                  stroke="var(--ink)"
                  strokeWidth="1"
                />
                <line x1="48" y1="38" x2="96" y2="38" stroke="var(--ink-soft)" strokeWidth="1" />
                <line x1="48" y1="46" x2="88" y2="46" stroke="var(--ink-soft)" strokeWidth="1" />
                <line x1="48" y1="54" x2="92" y2="54" stroke="var(--ink-soft)" strokeWidth="1" />
                <line x1="48" y1="62" x2="80" y2="62" stroke="var(--ink-soft)" strokeWidth="1" />
              </svg>
            </div>
            <p className="how__label">
              <span className="how__title">Your source</span>
              <span className="how__sub">.tex · .md · .typ</span>
            </p>
          </li>
        </ol>
        <p className="how__caption">
          The bundle is a plain JSON file. Any coding agent can consume the exported Markdown
          directly. The optional Claude Code plugin adds a forked-context planner, ambiguity flags,
          and hunk-by-hunk apply — see <em>Install</em> below.
        </p>
      </section>

      <section className="principles" aria-label="Principles">
        <h2 className="section__title">Three principles.</h2>
        <dl className="principles__list">
          <div className="principles__row">
            <dt className="principles__term">Privacy-first.</dt>
            <dd className="principles__def">
              Your draft, your device. Obelus reviews PDFs in the browser and hands your coding
              agent a single file to apply.
            </dd>
          </div>
          <div className="principles__row">
            <dt className="principles__term">Self-review.</dt>
            <dd className="principles__def">
              When the model writes the paper, you become the reviewer. Obelus is the surface for
              that work.
            </dd>
          </div>
          <div className="principles__row">
            <dt className="principles__term">Format-agnostic.</dt>
            <dd className="principles__def">
              One review workflow for LaTeX, Markdown, and Typst. No cloud.
            </dd>
          </div>
        </dl>
      </section>

      <section className="privacy" aria-label="Privacy contract">
        <h2 className="section__title">The privacy contract.</h2>
        <ul className="privacy__list">
          <li>PDFs live on your device.</li>
          <li>Annotations live on your device.</li>
          <li>No network calls. No analytics. No telemetry.</li>
        </ul>
      </section>

      <section className="desktop" id="desktop" aria-label="Desktop app">
        <h2 className="section__title">Desktop.</h2>
        <p className="desktop__lead">
          Built for writers. The desktop app is fully integrated: source editing happens in-window,
          Typst compiles locally, and Claude Code runs in-app — reviewing its edits as a git-style
          diff, one hunk at a time or all at once.
        </p>
        <p className="desktop__lead">
          <strong>One desk per scope.</strong> Keep a desk for each conference deadline, research
          topic, or collaborator — NeurIPS submissions on one, a survey-in-progress on another, a
          reading stack on a third. Projects live inside desks; archive a desk when the deadline
          passes without losing its history.
        </p>
        <ul className="desktop__downloads" aria-label="Download options">
          <li>
            <span className="desktop__link desktop__link--pending" aria-disabled="true">
              macOS · Apple silicon
            </span>
          </li>
          <li>
            <span className="desktop__link desktop__link--pending" aria-disabled="true">
              macOS · Intel
            </span>
          </li>
          <li>
            <span className="desktop__link desktop__link--pending" aria-disabled="true">
              Windows · x64
            </span>
          </li>
          <li>
            <span className="desktop__link desktop__link--pending" aria-disabled="true">
              Linux · AppImage
            </span>
          </li>
        </ul>
        <p className="desktop__status">
          <em>Coming soon.</em> Releases at{" "}
          <a href="https://github.com/4gentic/obelus/releases" rel="noreferrer noopener">
            github.com/4gentic/obelus/releases
          </a>{" "}
          when ready.
        </p>
        <aside className="desktop__footnote">
          <p className="desktop__footnote-label">First launch, unsigned.</p>
          <p>
            v1 builds are unsigned. On macOS, right-click the app and pick <em>Open</em>, then
            confirm once. Windows SmartScreen: click <em>More info</em>, then <em>Run anyway</em>.
            Linux AppImages run directly. Signed releases are planned post-v1.
          </p>
        </aside>
      </section>

      <section className="install" aria-label="Claude Code plugin">
        <h2 className="section__title">Claude Code plugin (optional).</h2>
        <p className="install__lead">
          Only useful when you're applying the bundle via Claude Code. Adds{" "}
          <code>/skill apply-review</code>, <code>/skill apply-fix</code>, and{" "}
          <code>/skill draft-writeup</code> — a forked-context planner, single-hunk apply, and
          reviewer write-up. Using a different agent? Skip this: the exported Markdown is
          self-describing.
        </p>
        <div className="tabs">
          <input
            type="radio"
            id="tab-plugin"
            name="install-tab"
            defaultChecked
            className="tabs__input"
          />
          <input type="radio" id="tab-curl" name="install-tab" className="tabs__input" />
          <div className="tabs__labels">
            <label htmlFor="tab-plugin" className="tabs__label">
              Claude Code
            </label>
            <label htmlFor="tab-curl" className="tabs__label">
              curl
            </label>
          </div>
          <div className="tabs__panels">
            <pre className="tabs__panel tabs__panel--plugin">
              <code>{"/plugin marketplace add 4gentic/obelus\n/plugin install obelus@4gentic"}</code>
            </pre>
            <pre className="tabs__panel tabs__panel--curl">
              <code>curl -fsSL https://obelus.4gentic.ai/claude.tar.gz | tar -xz -C .</code>
            </pre>
          </div>
        </div>
      </section>

      <footer className="colophon" role="contentinfo" aria-labelledby="colophon-title">
        <h2 id="colophon-title" className="section__title section__title--small">
          Colophon.
        </h2>
        <dl className="colophon__list">
          <div className="colophon__row">
            <dt>Type</dt>
            <dd>Newsreader, Source Serif 4, JetBrains Mono — all OFL, self-hosted.</dd>
          </div>
          <div className="colophon__row">
            <dt>Source</dt>
            <dd>
              <a href="https://github.com/4gentic/obelus" rel="noreferrer noopener">
                github.com/4gentic/obelus
              </a>{" "}
              · MIT
            </dd>
          </div>
        </dl>
      </footer>
    </article>
  );
}
