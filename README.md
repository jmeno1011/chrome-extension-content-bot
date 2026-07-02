# Chrome Extension Content Bot

Node.js/TypeScript Slack automation server for generating structured Chrome Extensions Hub entries from README content.

## Current Scope

- Slack Events API endpoint: `POST /api/slack/events`
- Slack URL verification challenge response
- Slack `app_mention` thread replies
- Slack request signature verification
- OpenAI README -> extension draft JSON generation
- Zod draft and final extension validation
- GitHub PR creation

README file uploads are not connected yet. Current input is pasted Slack message text.

## Run Locally

```bash
npm install
cp .env.example .env
PORT=3100 npm run dev
```

Health check:

```bash
curl http://localhost:3100/health
```

## Slack Setup

Slack needs a public HTTPS URL to call the local server.

Example:

```bash
ngrok http 3100
```

Slack App settings:

- Event Subscriptions Request URL: `https://YOUR-NGROK-DOMAIN/api/slack/events`
- Subscribe to bot events: `app_mention`
- OAuth scope: `chat:write`

Invite the bot to a channel, then test:

```text
@bot ping
```

Expected reply:

```text
Connection confirmed. Send a README and I will generate structured data.
```

Generate a structured preview:

```text
@bot generate
# My Chrome Extension

README content...
```

Add URL values to the current thread draft:

```text
@bot add_github https://github.com/owner/repo
@bot add_chrome https://chromewebstore.google.com/detail/...
```

Overwrite URL values:

```text
@bot edit_github https://github.com/owner/repo
@bot edit_chrome https://chromewebstore.google.com/detail/...
```

Add or overwrite category:

```text
@bot add_category Automation Tool
@bot edit_category Productivity
```

Show the current draft:

```text
@bot preview
```

Validate and create a GitHub PR:

```text
@bot approve
```

If approval succeeds, the bot creates a GitHub branch, appends the current draft to `data/extensions.json`, commits it, and opens a pull request.

Show deployment health URL:

```text
@bot health
```

Show commands:

```text
@bot /h
```

`add_github`, `add_chrome`, and `add_category` only fill empty values. Use `edit_github`, `edit_chrome`, and `edit_category` to overwrite existing values.

## GitHub PR Settings

`approve` requires:

```env
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=doh-kim-chrome-extensions
GITHUB_BASE_BRANCH=main
```

The GitHub token needs contents write and pull request write permissions for the target repository.

## OpenAI CLI Check

```bash
npm run check:openai -- /path/to/README.md
```

Success prints:

```json
{
  "extension": {},
  "missingFields": [],
  "questions": []
}
```

The output is printed only after passing Zod validation.

## Verify

```bash
npm test
npm run build
```
