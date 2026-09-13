import "dotenv/config";
import express from "express";
import { App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import { config } from "./config.js";
import { reviewPullRequest } from "./review.js";

const app = new App({
  appId: config.githubAppId,
  privateKey: config.githubPrivateKey,
  webhooks: { secret: config.githubWebhookSecret },
});

app.webhooks.on(
  [
    "pull_request.opened",
    "pull_request.reopened",
    "pull_request.synchronize",
    "pull_request.ready_for_review",
  ],
  async ({ octokit, payload }) => {
    const pr = payload.pull_request;

    if (config.skipDrafts && pr.draft) {
      console.log(`[webhook] PR #${pr.number} is a draft, skipping.`);
      return;
    }

    console.log(
      `[webhook] Reviewing ${payload.repository.full_name} PR #${pr.number} (${payload.action})`,
    );

    await reviewPullRequest(octokit, {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      pull_number: pr.number,
      head_sha: pr.head.sha,
      title: pr.title,
      body: pr.body,
    });
  },
);

app.webhooks.onError((error) => {
  console.error("[webhook] error:", error.message);
});

const server = express();

server.get("/health", (_req, res) => {
  res.json({ ok: true, service: "pr-review-bot" });
});

server.use(
  createNodeMiddleware(app.webhooks, { path: "/api/github/webhooks" }),
);

server.listen(config.port, () => {
  console.log(`pr-review-bot listening on :${config.port}`);
  console.log(`  health:  http://localhost:${config.port}/health`);
  console.log(`  webhook: http://localhost:${config.port}/api/github/webhooks`);
});
