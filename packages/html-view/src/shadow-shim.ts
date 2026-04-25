// Inline copy of `shadow-shim.css`. Kept in TS so the shadow-root mount path
// works in every environment (Vite, jsdom, happy-dom) without per-bundler CSS
// transform glue. The .css file is shipped under the package's exports map
// for consumers that prefer to inject it via a stylesheet link instead.
export const SHADOW_SHIM_CSS = `:host {
  display: block;
  color: #2b2a26;
  background: #f6f1e7;
  font-family: "Source Serif 4 Variable", "Source Serif 4", Georgia, serif;
  line-height: 1.55;
}

h1, h2, h3, h4, h5, h6 {
  font-family: "Newsreader Variable", "Newsreader", Georgia, serif;
  font-weight: 600;
  letter-spacing: 0.002em;
  line-height: 1.2;
}

code, pre, kbd, samp {
  font-family: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

a {
  color: #b84a2e;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.15em;
}

img {
  max-width: 100%;
  height: auto;
}
`;
