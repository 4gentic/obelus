import { Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./app";
import { installPerfTee } from "./lib/perf-tee";
import "./polyfills";
import "./styles/global.css";

installPerfTee();

const container = document.getElementById("root");
if (!container) throw new Error("root element missing");

// StrictMode in prod is a no-op; in dev it double-invokes renders and effects.
// The WKWebView dev cycle is already tight on CPU — skip the tax there.
const Root = import.meta.env.PROD ? StrictMode : Fragment;

createRoot(container).render(
  <Root>
    <HashRouter>
      <App />
    </HashRouter>
  </Root>,
);
