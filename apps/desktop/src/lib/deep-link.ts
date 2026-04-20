import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getRepository } from "./repo";

// Deep-link contract:
//   obelus://open?path=<absolute-project-root>
//     Navigates to the registered project whose root equals <path>.
//     If no such project exists, the link resolves to "unknown" and the
//     renderer is free to ignore it — we do not auto-register projects
//     from a URL in v1 (the user always picks kind via the wizard first).
//
// Future shapes (post-v1):
//   obelus://bundle?url=<https-url-to-v2-bundle>  — PWA → desktop handoff.
export type DeepLinkTarget =
  | { kind: "project"; projectId: string }
  | { kind: "unknown"; reason: string };

export type ParsedDeepLink = { kind: "open"; path: string } | { kind: "invalid"; reason: string };

export function parseDeepLink(url: string): ParsedDeepLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "obelus:") return null;
  if (parsed.host !== "open") {
    return { kind: "invalid", reason: `unsupported action: ${parsed.host}` };
  }
  const path = parsed.searchParams.get("path");
  if (!path) return { kind: "invalid", reason: "missing path" };
  return { kind: "open", path };
}

export async function resolveDeepLink(url: string): Promise<DeepLinkTarget | null> {
  const link = parseDeepLink(url);
  if (link === null) return null;
  if (link.kind === "invalid") return { kind: "unknown", reason: link.reason };
  const repo = await getRepository();
  const match = (await repo.projects.list()).find((p) => p.root === link.path);
  if (!match) return { kind: "unknown", reason: `no project registered at ${link.path}` };
  await repo.projects.touchLastOpened(match.id);
  return { kind: "project", projectId: match.id };
}

export async function registerDeepLinkHandler(
  navigate: (route: string) => void,
): Promise<() => void> {
  const handle = async (urls: string[]): Promise<void> => {
    for (const url of urls) {
      const target = await resolveDeepLink(url);
      if (target?.kind === "project") {
        navigate(`/project/${target.projectId}`);
        return;
      }
    }
  };
  const initial = await getCurrent();
  if (initial && initial.length > 0) await handle(initial);
  return onOpenUrl(handle);
}
