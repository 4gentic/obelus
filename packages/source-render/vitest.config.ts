import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    // The asset-rewrite suite mounts <script>/<link> with src into the live
    // document on purpose. happy-dom won't load them (JS evaluation is off),
    // and vitest 4.1.6 stopped swallowing the resulting "file loading is
    // disabled" error — it now propagates out of setAttribute. Treat the
    // (correctly) blocked load as a silent success instead.
    environmentOptions: { happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } } },
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
  },
});
