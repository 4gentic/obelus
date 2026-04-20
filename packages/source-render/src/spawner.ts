// Process + filesystem boundary. The package itself imports nothing from
// node:* — production injects `tauriSpawner` (lives in apps/desktop), tests
// inject mocks, Node CLIs use `nodeSpawner`. This keeps source-render pure
// TS and trivially unit-testable.
export type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type SpawnOptions = {
  cwd: string;
  stdin?: string;
};

export interface Spawner {
  run(bin: string, args: ReadonlyArray<string>, opts: SpawnOptions): Promise<SpawnResult>;
  which(bin: string): Promise<string | null>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

// Minimal Node implementation. Lives in this package only because it's the
// realistic dev-time / CI Spawner; the desktop app provides its own.
export function nodeSpawner(): Spawner {
  return {
    async run(bin, args, opts) {
      const { spawn } = await import("node:child_process");
      return await new Promise<SpawnResult>((resolve, reject) => {
        const child = spawn(bin, [...args], { cwd: opts.cwd });
        const stdoutChunks: Array<Buffer> = [];
        const stderrChunks: Array<Buffer> = [];
        child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
        child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
        child.on("error", reject);
        child.on("close", (code) => {
          resolve({
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
            exitCode: code ?? -1,
          });
        });
        if (opts.stdin !== undefined) {
          child.stdin.end(opts.stdin);
        } else {
          child.stdin.end();
        }
      });
    },
    async which(bin) {
      const { spawn } = await import("node:child_process");
      // Use POSIX `command -v` via the user's shell for consistency with $PATH
      // resolution on macOS / Linux. Windows desktop integration is out of
      // scope for v1 (tracked under apps/desktop Phase 2).
      return await new Promise<string | null>((resolve) => {
        const child = spawn("/bin/sh", ["-c", `command -v ${bin}`]);
        const out: Array<Buffer> = [];
        child.stdout.on("data", (c: Buffer) => out.push(c));
        child.on("close", (code) => {
          if (code === 0) {
            const path = Buffer.concat(out).toString("utf8").trim();
            resolve(path.length > 0 ? path : null);
          } else {
            resolve(null);
          }
        });
        child.on("error", () => resolve(null));
      });
    },
    async readFile(path) {
      const { readFile } = await import("node:fs/promises");
      return await readFile(path, "utf8");
    },
    async writeFile(path, content) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, content, "utf8");
    },
  };
}
