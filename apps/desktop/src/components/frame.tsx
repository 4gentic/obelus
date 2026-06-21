import { Lockup } from "@obelus/brand";
import { Link, Outlet, useLocation } from "react-router-dom";
import "@obelus/brand/lockup.css";
import JobsDock from "./jobs-dock";
import UpdateBanner from "./update-banner";
import "./frame.css";

import type { JSX } from "react";
export default function Frame(): JSX.Element {
  const location = useLocation();
  const isWizard = location.pathname.startsWith("/wizard") || location.pathname === "/";
  return (
    <div className="frame">
      {isWizard ? null : (
        <header className="frame__header">
          <Link to="/home" className="frame__brand" aria-label="Obelus home">
            <Lockup />
          </Link>
          <nav className="frame__nav" aria-label="Primary">
            <Link to="/home" className="frame__link">
              Home
            </Link>
            <Link to="/settings" className="frame__link">
              Settings
            </Link>
          </nav>
        </header>
      )}
      {isWizard ? null : <UpdateBanner />}
      <main className={isWizard ? "frame__main frame__main--wide" : "frame__main"}>
        <Outlet />
      </main>
      {isWizard ? null : <JobsDock />}
    </div>
  );
}
