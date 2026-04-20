import { registerSW } from "virtual:pwa-register";

export type PwaState = {
  needRefresh: boolean;
  error: string | null;
};

let state: PwaState = { needRefresh: false, error: null };
const listeners = new Set<(s: PwaState) => void>();
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

function emit(next: Partial<PwaState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l(state);
}

export function startPwa(): void {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      emit({ needRefresh: true });
    },
    onRegisterError(err) {
      emit({ error: err instanceof Error ? err.message : String(err) });
    },
  });
}

export function subscribePwa(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getPwaState(): PwaState {
  return state;
}

export async function applyPwaUpdate(): Promise<void> {
  if (updateSW) await updateSW(true);
}
