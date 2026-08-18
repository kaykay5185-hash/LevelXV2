# LevelX — GitHub Pages + GitHub CSV + Cloudflare Worker

## Architecture

GitHub Pages hosts the public HTML.
Cloudflare Worker is the free serverless API.
`levelx_database.csv` stays in your GitHub repository.
The GitHub token and Admin password stay ONLY in Cloudflare Worker secrets.

## Files

- `index.html` — LevelX website/admin UI
- `levelx_database.csv` — member database
- `levelx-worker.js` — serverless API
- `wrangler.toml` — Worker configuration

## Setup

1. Put `index.html` and `levelx_database.csv` in your GitHub repository.
2. Enable GitHub Pages for the repository.
3. Create a Cloudflare Worker and paste `levelx-worker.js`.
4. In Worker variables, set:
   - `GITHUB_OWNER`
   - `GITHUB_REPO`
   - `GITHUB_BRANCH=main`
   - `GITHUB_CSV_PATH=levelx_database.csv`
   - `ALLOWED_ORIGIN=https://YOUR_GITHUB_USERNAME.github.io`
5. Add two Worker secrets:
   - `GITHUB_TOKEN`
   - `ADMIN_PASSWORD`
6. The GitHub token needs repository Contents write permission. GitHub's Contents API supports creating/updating files and requires Contents write for a fine-grained token. 
7. Deploy the Worker.
8. In `index.html`, replace:
   `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev`
   with the deployed Worker URL.
9. Open the site. Click **Admin**. Enter the Admin password.
10. Edit a member and save. The Worker reads the current CSV, updates it, and commits the new CSV back to GitHub.

## Important security note

Do NOT put `GITHUB_TOKEN` in `index.html`. The browser is public. The token belongs in a Worker secret.

The simple Admin-password flow is suitable for a private/small project but is not a full identity/authentication system. For a serious public deployment, use proper authentication and rate limiting.

## Free limits

Cloudflare documents a Workers Free plan with limited usage; current limits include 100,000 requests/day. GitHub's Contents API is used by the Worker to update the CSV.
