import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";

// Works with any OpenAI-compatible endpoint (Groq, OpenAI, OpenRouter, Together...).
const client = new OpenAI({
  baseURL: config.llmBaseUrl,
  apiKey: config.llmApiKey,
});

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

// Embedded in the prompt so the model knows the exact shape to return.
const SCHEMA_TEXT = JSON.stringify(z.toJSONSchema(ReviewSchema), null, 2);

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

Respond ONLY with a single JSON object matching this JSON Schema (no markdown fences, no prose):
${SCHEMA_TEXT}`;

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

  const completion = await client.chat.completions.create({
    model: config.llmModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
  });

  const raw = completion.choices[0]?.message.content?.trim();
  if (!raw) {
    console.warn("[reviewer] empty response from model");
    return { summary: "", findings: [] };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.warn("[reviewer] model did not return valid JSON");
    return { summary: "", findings: [] };
  }

  const parsed = ReviewSchema.safeParse(json);
  if (!parsed.success) {
    console.warn(
      "[reviewer] model output failed schema validation:",
      parsed.error.message,
    );
    return { summary: "", findings: [] };
  }

  return parsed.data;
}
