// Error / status strings follow a "headline\n\ndetails" convention so three
// review surfaces (Diff tab, Start-review footer, jobs dock) can render the
// first paragraph inline and tuck the rest behind a disclosure. A string
// without a blank line is all headline — legacy single-line messages render
// unchanged.
export function splitHeadline(message: string): { headline: string; details: string | null } {
  const idx = message.indexOf("\n\n");
  if (idx < 0) return { headline: message.trim(), details: null };
  const headline = message.slice(0, idx).trim();
  const details = message.slice(idx + 2).trim();
  return { headline, details: details.length > 0 ? details : null };
}
