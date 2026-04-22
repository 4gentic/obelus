import { useCallback, useState } from "react";

// Inline "Click to confirm" state machine shared by every destructive action
// in writer mode. First click arms; second click commits. Blur cancels.
export interface InlineConfirm {
  armed: boolean;
  arm(): void;
  cancel(): void;
  confirm(run: () => void | Promise<void>): Promise<void>;
  bind(): {
    onBlur: () => void;
    "data-armed": "true" | "false";
  };
}

export function useInlineConfirm(): InlineConfirm {
  const [armed, setArmed] = useState(false);
  const arm = useCallback(() => setArmed(true), []);
  const cancel = useCallback(() => setArmed(false), []);
  const confirm = useCallback(async (run: () => void | Promise<void>): Promise<void> => {
    setArmed(false);
    await run();
  }, []);
  const bind = useCallback(
    () => ({
      onBlur: () => setArmed(false),
      "data-armed": (armed ? "true" : "false") as "true" | "false",
    }),
    [armed],
  );
  return { armed, arm, cancel, confirm, bind };
}
