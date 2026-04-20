import { Link, Outlet } from "react-router-dom";
import UpdateBanner from "../pwa/UpdateBanner";
import Lockup from "./Lockup";
import "./Frame.css";

export default function Frame() {
  return (
    <div className="frame">
      <header className="frame__header">
        <Link to="/" className="frame__brand" aria-label="Obelus home">
          <Lockup size={28} />
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
      <main className="frame__main">
        <Outlet />
      </main>
      <UpdateBanner />
    </div>
  );
}
