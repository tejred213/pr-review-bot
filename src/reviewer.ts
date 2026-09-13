import { Ollama } from "ollama";
import { z } from "zod";
import { config } from "./config.js";

const ollama = new Ollama({ host: config.ollamaHost });

export const SEVERITIES = ["critical", "high", "medium", "low", "nit"] as const;

const FindingSchema = z.object({
  path: z
    .string()
    .describe("Repo-relative file path, copied exactly from the diff header."),
  line: z
    .number()
    .int()
    .describe(
      "A line number from the NEW version of the file — use one of the numbers shown at the start of each diff line.",
    ),
  severity: z.enum(SEVERITIES),
  title: z.string().describe("Short one-line summary of the issue."),
  comment: z
    .string()
    .describe(
      "The review comment in GitHub-flavored markdown: what's wrong and how to fix it.",
    ),
  suggestion: z
    .string()
    .describe(
      "Replacement code for the cited line, or an empty string if no concrete suggestion applies.",
    ),
});

export const ReviewSchema = z.object({
  summary: z
    .string()
    .describe("A 1-3 sentence overview of the change and its overall quality."),
  findings: z.array(FindingSchema),
});

export type Finding = z.infer<typeof FindingSchema>;
export type Review = z.infer<typeof ReviewSchema>;

// JSON Schema handed to Ollama's `format` option to constrain generation.
const REVIEW_JSON_SCHEMA = z.toJSONSchema(ReviewSchema);

export interface FileForReview {
  path: string;
  status: string;
  annotated: string;
}

const SYSTEM_PROMPT = `You are a meticulous senior software engineer reviewing a GitHub pull request.

You are given the changed files as unified diffs. Each diff line is prefixed with its line number in the NEW version of the file, then a marker: "+" for added lines, " " for unchanged context, and "-" for removed lines (removed lines have no number).

Review priorities, in order:
1. Correctness bugs, logic errors, and edge cases introduced by the change.
2. Security issues (injection, auth, secrets, unsafe input handling).
3. Missing error handling, race conditions, and resource leaks.
4. API misuse and violated invariants.
5. Readability and maintainability that materially affect the code.

Rules:
- Only report issues in the CHANGED code. Do not review pre-existing code you merely see for context.
- Be high-signal. A handful of real, well-explained findings beats a long list of nitpicks. If the change is clean, return an empty findings array.
- Do NOT flag pure formatting/style that a linter or formatter owns.
- Every finding MUST anchor to a real line number shown in the diff for that file. Prefer added ("+") lines.
- When you can express the fix as code, put it in "suggestion" as the replacement for that single line. Otherwise use an empty string.
- Keep comments concise and actionable. Reference the exact symbol or value.
- Write "summary" as a brief, neutral overview a reviewer would leave at the top of the PR.

Respond ONLY with a JSON object matching the required schema. Do not wrap it in markdown fences or add prose.`;

export async function reviewCode(
  files: FileForReview[],
  pr: { title: string; body: string | null },
): Promise<Review> {
  const parts: string[] = [
    `Pull request title: ${pr.title}`,
    pr.body ? `\nDescription:\n${pr.body}` : "",
    `\nChanged files (${files.length}):\n`,
  ];

  for (const file of files) {
    parts.push(
      `\n=== FILE: ${file.path} (${file.status}) ===\n${file.annotated}\n`,
    );
  }

  const content = parts.join("\n");

  const response = await ollama.chat({
    model: config.ollamaModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
    format: REVIEW_JSON_SCHEMA,
    options: {
      temperature: 0,
      num_ctx: config.ollamaNumCtx,
    },
  });

  const raw = response.message.content?.trim();
  if (!raw) {
    console.warn("[reviewer] empty response from model");
    return { summary: "", findings: [] };
  }

  // Ollama constrains output to the schema, but validate anyway — a local model
  // can still emit something the schema-narrowing missed.
  const parsed = ReviewSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.warn(
      "[reviewer] model output failed schema validation:",
      parsed.error.message,
    );
    return { summary: "", findings: [] };
  }

  return parsed.data;
}
