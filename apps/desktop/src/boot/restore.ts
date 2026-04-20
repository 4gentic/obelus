import { getRepository } from "../lib/repo";
import { getAppState } from "../store/app-state";

export type RestoreDestination = "/wizard" | "/home";

export async function nextDestination(): Promise<RestoreDestination> {
  const wizard = await getAppState("wizard");
  if (wizard && wizard.folio !== "done") return "/wizard";

  const repo = await getRepository();
  const projects = await repo.projects.list();
  if (projects.length === 0) return "/wizard";
  return "/home";
}
