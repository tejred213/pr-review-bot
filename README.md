# 🤖 PR Review Bot

A **GitHub App** that reviews pull requests with Claude and leaves **inline comments** on the exact lines it's talking about — like a tireless senior engineer on every PR.

Built with Node + TypeScript, the Octokit GitHub App SDK, and the Anthropic SDK with **structured outputs** so every finding is schema-validated before it's posted.

---

## What it does

When a PR is opened, reopened, updated, or marked ready for review:

1. The webhook fires and the bot authenticates as a per-repo **installation** (short-lived token — no personal access token sitting around).
2. It pulls the PR's changed files and their diffs.
3. It sends the annotated diffs to Claude, which returns a **strictly-typed** list of findings (path, line, severity, comment, optional code suggestion).
4. Each finding is **validated against the actual diff** and posted as an inline review comment; anything that can't anchor to a diff line is folded into a summary comment.

## Why it's more than "call an API"

The interesting engineering is in the parts that make it reliable:

- **Diff-aware line mapping** (`src/diff.ts`). GitHub rejects an *entire* review if any inline comment points at a line that isn't part of the diff. The bot parses each patch, tracks the new-file line numbers, and only posts comments on lines it knows GitHub will accept — everything else degrades gracefully into the summary.
- **Schema-validated model output** (`src/reviewer.ts`). Findings come back through Claude's structured-output mode against a Zod schema, so the posting code never parses free-form text or guesses at JSON.
- **Webhook signature verification** for free via the Octokit App SDK — unsigned requests are rejected with a 400.
- **Graceful fallback**: if a review call is rejected, it retries as a single summary comment instead of dropping the review.

## Architecture

```
GitHub ──webhook──▶ Express (/api/github/webhooks)
                        │  signature verified
                        ▼
                  App.webhooks.on("pull_request.*")
                        │  installation-authenticated Octokit
                        ▼
   listFiles ─▶ parsePatch ─▶ reviewCode (Claude, structured output)
                        │
                        ▼
   validate findings against commentable lines ─▶ createReview (inline comments)
```

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Express server + webhook wiring |
| `src/config.ts` | Environment config and ignore-list |
| `src/diff.ts` | Unified-diff parser → commentable line map |
| `src/reviewer.ts` | Claude client, review schema, prompt |
| `src/review.ts` | Orchestration: fetch → review → validate → post |
| `src/local.ts` | Review an existing PR from the CLI (no webhook) |

---

## Setup

### 1. Create the GitHub App

Go to **Settings → Developer settings → GitHub Apps → New GitHub App** and set:

- **Webhook URL**: your public URL + `/api/github/webhooks` (use a [smee.io](https://smee.io) channel for local dev — see below).
- **Webhook secret**: any long random string (you'll reuse it as `GITHUB_WEBHOOK_SECRET`).
- **Repository permissions**:
  - **Pull requests**: Read & write  *(to post reviews)*
  - **Contents**: Read-only  *(to read the diff)*
  - **Metadata**: Read-only  *(default)*
- **Subscribe to events**: **Pull request**.

Then:
- Note the **App ID**.
- **Generate a private key** and download the `.pem`.
- **Install the App** on a repo you own (top of the App's page → Install App).

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, the private key (inline or via `GITHUB_PRIVATE_KEY_PATH`), and `ANTHROPIC_API_KEY`.

### 3. Install & run

```bash
npm install
npm run dev      # watch mode (tsx)
# or
npm run build && npm start
```

`GET /health` should return `{"ok":true,...}`.

---

## Local development with smee

Real GitHub webhooks need a public URL. For local dev, forward them through smee:

```bash
npx smee-client --url https://smee.io/YOUR_CHANNEL --target http://localhost:3000/api/github/webhooks
```

Set the App's **Webhook URL** to your smee channel URL, run `npm run dev`, and open a PR.

## Test against a real PR (no webhook)

Once the App is installed on a repo, you can review any existing PR straight from the CLI — great for iterating on the prompt:

```bash
npm run review:local -- owner/repo 123
```

This authenticates as the App's installation and posts a real review, without needing the webhook loop running.

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_MODEL` | `claude-opus-5` | Review model. Opus is the strongest reviewer; set to `claude-sonnet-5` for a cheaper/faster option. |
| `SKIP_DRAFTS` | `true` | Don't review draft PRs. |
| `MAX_DIFF_CHARS` | `60000` | Cap on diff text sent to the model per PR. |
| `PORT` | `3000` | HTTP port. |

Generated/vendored paths (lockfiles, `dist/`, `.min.js`, etc.) are skipped — see `DEFAULT_IGNORE` in `src/config.ts`.

## Cost note

The bot makes one Claude call per PR event. Opus gives the best review quality; if you're running it on a busy repo and want to cut cost, switch `ANTHROPIC_MODEL` to `claude-sonnet-5`.

## Deploy

It's a plain Node HTTP server — deploy anywhere (Render, Railway, Fly, a container, a VM). Set the same environment variables, point the App's webhook URL at the deployed `/api/github/webhooks`, and you're live.

## Possible next steps

- Deduplicate: dismiss the bot's previous review when a PR is updated.
- Add an `APPROVE` / `REQUEST_CHANGES` verdict based on severity.
- Persist reviews and build a tiny dashboard of findings over time.
- A small eval set of known-buggy diffs to measure review quality across prompt/model changes.

## License

MIT
