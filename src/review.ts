import type { Octokit } from "octokit";
import { config, isIgnoredPath } from "./config.js";
import { parsePatch } from "./diff.js";
import { reviewCode, type FileForReview, type Finding } from "./reviewer.js";

const MARKER = "<!-- claude-pr-review -->";

const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  critical: "🔴 Critical",
  high: "🟠 High",
  medium: "🟡 Medium",
  low: "🔵 Low",
  nit: "⚪ Nit",
};

export interface PullRequestRef {
  owner: string;
  repo: string;
  pull_number: number;
  head_sha: string;
  title: string;
  body: string | null;
}

/** Fetch, review, and comment on a single pull request. */
export async function reviewPullRequest(
  octokit: Octokit,
  pr: PullRequestRef,
): Promise<void> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.pull_number,
    per_page: 100,
  });

  const forReview: FileForReview[] = [];
  const commentable = new Map<string, Set<number>>();
  let budget = config.maxDiffChars;

  for (const file of files) {
    if (file.status === "removed") continue;
    if (!file.patch) continue; // binary or too large — GitHub omits the patch
    if (isIgnoredPath(file.filename)) continue;
    if (budget <= 0) break;

    const { annotated, commentableLines } = parsePatch(file.patch);
    const clipped = annotated.slice(0, budget);
    budget -= clipped.length;

    forReview.push({
      path: file.filename,
      status: file.status,
      annotated: clipped,
    });
    commentable.set(file.filename, commentableLines);
  }

  if (forReview.length === 0) {
    console.log(
      `[review] PR #${pr.pull_number}: nothing reviewable, skipping.`,
    );
    return;
  }

  const review = await reviewCode(forReview, {
    title: pr.title,
    body: pr.body,
  });

  // Split findings into ones GitHub will accept as inline comments and ones we
  // must fold into the summary body (line not present in the diff).
  const inline: { path: string; line: number; side: "RIGHT"; body: string }[] =
    [];
  const orphans: Finding[] = [];

  for (const f of review.findings) {
    const lines = commentable.get(f.path);
    if (lines && lines.has(f.line)) {
      inline.push({
        path: f.path,
        line: f.line,
        side: "RIGHT",
        body: formatComment(f),
      });
    } else {
      orphans.push(f);
    }
  }

  const body = buildSummaryBody(review.summary, review.findings, orphans);

  try {
    await octokit.rest.pulls.createReview({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.pull_number,
      commit_id: pr.head_sha,
      event: "COMMENT",
      body,
      comments: inline,
    });
    console.log(
      `[review] PR #${pr.pull_number}: posted ${inline.length} inline comment(s), ${orphans.length} in summary.`,
    );
  } catch (err) {
    // If GitHub rejects an inline comment for any reason, don't lose the review —
    // fall back to a single summary comment containing every finding.
    console.warn(
      `[review] PR #${pr.pull_number}: inline review failed, falling back to summary-only.`,
      err instanceof Error ? err.message : err,
    );
    await octokit.rest.pulls.createReview({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.pull_number,
      commit_id: pr.head_sha,
      event: "COMMENT",
      body: buildSummaryBody(review.summary, review.findings, review.findings),
    });
  }
}

function formatComment(f: Finding): string {
  let out = `**${SEVERITY_LABEL[f.severity]} — ${f.title}**\n\n${f.comment}`;
  if (f.suggestion.trim()) {
    out += `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\``;
  }
  return out;
}

function buildSummaryBody(
  summary: string,
  all: Finding[],
  orphans: Finding[],
): string {
  const counts = countBySeverity(all);
  const parts = [
    MARKER,
    "## 🤖 Claude code review",
    "",
    summary || "_No summary provided._",
    "",
    `**Findings:** ${all.length}${counts ? ` (${counts})` : ""}`,
  ];

  if (orphans.length > 0) {
    parts.push(
      "",
      "### Notes not tied to a diff line",
      "",
      ...orphans.map(
        (f) =>
          `- **${SEVERITY_LABEL[f.severity]}** \`${f.path}:${f.line}\` — ${f.title}: ${f.comment}`,
      ),
    );
  }

  parts.push(
    "",
    "---",
    "<sub>Automated review — treat as a helpful second opinion, not a gate.</sub>",
  );
  return parts.join("\n");
}

function countBySeverity(findings: Finding[]): string {
  const counts = new Map<Finding["severity"], number>();
  for (const f of findings) {
    counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([sev, n]) => `${n} ${sev}`)
    .join(", ");
}
