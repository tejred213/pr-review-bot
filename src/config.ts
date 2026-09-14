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

  // --- LLM (any OpenAI-compatible provider) ---
  // Defaults to a local Ollama; override for a cloud provider (Groq, OpenAI, ...).
  llmBaseUrl: process.env.LLM_BASE_URL ?? "http://127.0.0.1:11434/v1",
  // Local Ollama ignores the key but the client requires a non-empty value.
  llmApiKey: process.env.LLM_API_KEY ?? "ollama",
  llmModel: process.env.LLM_MODEL ?? "qwen3:8b",
  // How strongly to constrain the model's JSON output. Providers differ:
  //   "json_schema" (default) — schema-constrained decoding (Ollama, OpenAI). Best.
  //   "json_object"           — generic JSON mode; widest compatibility (Gemini, Groq).
  //   "none"                  — send no response_format; rely on the prompt alone.
  llmJsonMode: (process.env.LLM_JSON_MODE ?? "json_schema") as
    | "json_schema"
    | "json_object"
    | "none",
  // Whether json_schema mode uses strict grammar. Some providers reject strict
  // (or unsupported schema keywords); set LLM_STRICT_SCHEMA=false for those.
  llmStrictSchema: (process.env.LLM_STRICT_SCHEMA ?? "true") === "true",

  port: Number(process.env.PORT ?? 3000),
  skipDrafts: (process.env.SKIP_DRAFTS ?? "true") === "true",
  maxDiffChars: Number(process.env.MAX_DIFF_CHARS ?? 60000),

  ignorePaths: DEFAULT_IGNORE,
} as const;

export function isIgnoredPath(path: string): boolean {
  return config.ignorePaths.some((frag) => path.includes(frag));
}
