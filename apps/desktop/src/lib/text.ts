export function truncateMiddle(s: string, max = 180): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${flat.slice(0, head)}…${flat.slice(-tail)}`;
}
