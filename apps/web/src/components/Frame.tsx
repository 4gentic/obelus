import { Lockup } from "@obelus/brand";
import { Link, Outlet } from "react-router-dom";
import "@obelus/brand/lockup.css";
import UpdateBanner from "../pwa/UpdateBanner";
import "./Frame.css";

export default function Frame() {
  return (
    <div className="frame">
      <a className="frame__skip-link" href="#main">
        Skip to content
      </a>
      <header className="frame__header">
        <Link to="/" className="frame__brand" aria-label="Obelus home">
          <Lockup />
        </Link>
        <nav className="frame__nav" aria-label="Primary">
          <Link to="/" className="frame__link">
            Home
          </Link>
          <Link to="/app" className="frame__link">
            Library
          </Link>
          <a
            className="frame__link"
            href="https://github.com/4gentic/obelus"
            rel="noreferrer noopener"
          >
            GitHub
          </a>
        </nav>
      </header>
      <main id="main" className="frame__main" tabIndex={-1}>
        <Outlet />
      </main>
      <UpdateBanner />
    </div>
  );
}
