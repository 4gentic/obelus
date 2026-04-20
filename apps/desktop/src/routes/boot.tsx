import type { JSX } from "react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { nextDestination } from "../boot/restore";
export default function Boot(): JSX.Element {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const dest = await nextDestination();
      if (!cancelled) navigate(dest, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  return <div className="boot" aria-hidden="true" />;
}
