import fs from "node:fs";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadPrivateKey(): string {
  const path = process.env.GITHUB_PRIVATE_KEY_PATH;
  if (path) {
    return fs.readFileSync(path, "utf8");
  }
  // Inline keys usually arrive with literal "\n"; turn them back into newlines.
  return required("GITHUB_PRIVATE_KEY").replace(/\\n/g, "\n");
}

/**
 * File paths we never bother reviewing — generated output, lockfiles, vendored
 * code. Matched as simple substrings against the file path.
 */
const DEFAULT_IGNORE = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "poetry.lock",
  "Cargo.lock",
  "go.sum",
  "/dist/",
  "/build/",
  "/vendor/",
  ".min.js",
  ".snap",
];

export const config = {
  githubAppId: required("GITHUB_APP_ID"),
  githubPrivateKey: loadPrivateKey(),
  githubWebhookSecret: required("GITHUB_WEBHOOK_SECRET"),

  // --- Ollama (local model) ---
  ollamaHost: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen3:8b",
  // Ollama defaults to a 4096-token context, too small for real diffs.
  ollamaNumCtx: Number(process.env.OLLAMA_NUM_CTX ?? 16384),

  port: Number(process.env.PORT ?? 3000),
  skipDrafts: (process.env.SKIP_DRAFTS ?? "true") === "true",
  maxDiffChars: Number(process.env.MAX_DIFF_CHARS ?? 60000),

  ignorePaths: DEFAULT_IGNORE,
} as const;

export function isIgnoredPath(path: string): boolean {
  return config.ignorePaths.some((frag) => path.includes(frag));
}
