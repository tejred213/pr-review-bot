import "dotenv/config";
import { App } from "octokit";
import { config } from "./config.js";
import { reviewPullRequest } from "./review.js";

/**
 * Review one existing PR from the command line, using your GitHub App's
 * installation on that repo — no webhook or public URL required.
 *
 *   npm run review:local -- owner/repo 123
 *
 * Great for iterating on the prompt/output before wiring up webhooks.
 */
const [slug, prArg] = process.argv.slice(2);

if (!slug || !prArg || !slug.includes("/")) {
  console.error("Usage: npm run review:local -- <owner>/<repo> <pr-number>");
  process.exit(1);
}

const [owner, repo] = slug.split("/");
const pullNumber = Number(prArg);

const app = new App({
  appId: config.githubAppId,
  privateKey: config.githubPrivateKey,
});

const { data: installation } = await app.octokit.rest.apps.getRepoInstallation({
  owner,
  repo,
});
const octokit = await app.getInstallationOctokit(installation.id);

const { data: pr } = await octokit.rest.pulls.get({
  owner,
  repo,
  pull_number: pullNumber,
});

console.log(`Reviewing ${owner}/${repo} PR #${pullNumber}: ${pr.title}`);

await reviewPullRequest(octokit, {
  owner,
  repo,
  pull_number: pullNumber,
  head_sha: pr.head.sha,
  title: pr.title,
  body: pr.body,
});

console.log("Done.");
