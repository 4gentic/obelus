import type { JSX } from "react";
import "./TrustBanner.css";

export interface TrustBannerProps {
  // Distinct origins parsed from the blocked URIs (e.g.,
  // ["fonts.googleapis.com", "cdn.example.com"]). Used in the message so
  // the user can decide whether the requesting servers look reasonable.
  // The component falls back to a generic count if the list is empty.
  hosts: ReadonlyArray<string>;
  blockedCount: number;
  onTrust: () => void;
  // Hides the banner for the rest of the session without granting trust.
  // The next reload re-shows it if external resources are still blocked.
  onDismiss?: () => void;
}

// Surfaced above an HTML or Markdown review surface when the paper has
// tried to load resources from external servers (CSP-blocked in the iframe,
// pre-rewritten in markdown). Editorial-toned: the user is reviewing a
// paper, not approving an extension; the copy treats trust as a deliberate,
// reversible reading choice rather than a security checkbox.
export default function TrustBanner({
  hosts,
  blockedCount,
  onTrust,
  onDismiss,
}: TrustBannerProps): JSX.Element {
  const source = formatHosts(hosts);
  return (
    <aside className="trust-banner" role="status" aria-live="polite">
      <p className="trust-banner__body">
        This paper requested {blockedCount === 1 ? "1 resource" : `${blockedCount} resources`}
        {source}. They were blocked. Loading them won&apos;t send your paper or annotations anywhere
        — only the URL itself reaches each server.
      </p>
      <div className="trust-banner__actions">
        <button type="button" className="trust-banner__primary" onClick={onTrust}>
          Allow external resources
        </button>
        {onDismiss ? (
          <button type="button" className="trust-banner__dismiss" onClick={onDismiss}>
            Keep blocked
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function formatHosts(hosts: ReadonlyArray<string>): string {
  if (hosts.length === 0) return "";
  if (hosts.length === 1) return ` from ${hosts[0]}`;
  if (hosts.length === 2) return ` from ${hosts[0]} and ${hosts[1]}`;
  const head = hosts.slice(0, 2).join(", ");
  return ` from ${head}, and ${hosts.length - 2} other host${hosts.length - 2 === 1 ? "" : "s"}`;
}
