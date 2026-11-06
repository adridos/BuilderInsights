# SE Michigan Builder Intelligence

Live map + tables of new-home builders in Macomb/Oakland (and every other county they build in).

## How updating works
1. On the 1st and 15th of each month (or when you click **Run workflow**), a GitHub Action runs `scripts/update.mjs`.
2. The script asks Claude (with web search) to read each builder's site, finds changed prices, new/removed communities, and looks for brand-new builders.
3. It never edits the live site directly. It opens a **Pull Request** with a plain-English change list.
4. You read it, click **Merge**, and the site refreshes in about a minute.

Safety: a scrape that returns <50% of known communities is skipped; communities are only removed after missing twice; new pins are geocoded and labeled "pin approximate".

## One-time setup
1. Repo **Settings → Pages**: Source = deploy from branch `main` / root. Custom domain `builderinsights.stewartteam.com`. DNS: CNAME `builderinsights` → `<your-github-username>.github.io`.
2. Get an API key at console.anthropic.com (add a few dollars of credit).
3. Repo **Settings → Secrets and variables → Actions → New repository secret**: name `ANTHROPIC_API_KEY`.
4. Repo **Settings → Actions → General → Workflow permissions**: "Read and write" and tick "Allow GitHub Actions to create and approve pull requests".
5. **Actions → Update builder data → Run workflow** to test.

## Cost
Roughly $2–6 per run depending on model/search use; twice a month. Lower it by changing the cron to monthly.

## Local test
`node scripts/test.mjs` (offline) · `ANTHROPIC_API_KEY=... node scripts/update.mjs --dry --only "Toll Brothers"`

## Data notes
`verified:true` = read from the builder or listing page; `false` = estimate to be confirmed. Pins with `coordsVerified:false` are approximate.
