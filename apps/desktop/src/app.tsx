import type { JSX } from "react";
import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import Frame from "./components/frame";
import JobsListener from "./components/jobs-listener";
import { registerDeepLinkHandler } from "./lib/deep-link";
import Boot from "./routes/boot";
import Home from "./routes/home";
import ProjectRoute from "./routes/project";
import Settings from "./routes/settings";
import Wizard from "./routes/wizard";

function useDeepLinks(): void {
  const navigate = useNavigate();
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void registerDeepLinkHandler(navigate).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [navigate]);
}

export default function App(): JSX.Element {
  useDeepLinks();
  return (
    <JobsListener>
      <Routes>
        <Route element={<Frame />}>
          <Route path="/" element={<Boot />} />
          <Route path="/wizard" element={<Wizard />} />
          <Route path="/home" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/project/:id" element={<ProjectRoute />} />
        </Route>
      </Routes>
    </JobsListener>
  );
}
