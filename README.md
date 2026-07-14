# Integration RSS — Make.com Workflow

Config-driven RSS aggregation scenario for construction and data-center industry news. Source of truth for feeds is [`feeds.config.json`](feeds.config.json).

| Item | Value |
|------|-------|
| Make scenario | Integration RSS (`5552982` on `us2.make.com`) |
| Schedule | 1st of each month, 09:00 IST |
| Live feeds | 10 of 14 configured |
| Google Sheet | Integration RSS - Trend Brief |

## Commands

```bash
npm run validate-feeds    # HTTP + RSS + recency check (30 days)
npm run push              # Deploy blueprint to Make.com
npm run run               # Trigger a test execution
npm run executions        # View recent run stats
```

---

## Pending RSS Feeds — Investigation Report

**Last checked:** 2026-07-09  
**Method:** `npm run validate-feeds` plus manual probing of configured URLs, common alternates (`/feed`, `/rss.xml`, FeedBurner), and RSS `<link rel="alternate">` tags on publisher homepages. Requests used a browser-like `User-Agent` with a 20–30s timeout.

### Summary

| Feed | Tier | Configured URL | Integrate? | Root cause |
|------|------|----------------|------------|------------|
| BDC Network | 2 | `bdcnetwork.com/rss.xml` | No | Endpoint removed; CMS RSS generator broken |
| Trimble News | 3 | `trimble.com/en/news/rss` | No* | Configured path does not exist; working feeds found elsewhere |
| For Construction Pros | 4 | `forconstructionpros.com/rss` | No | Cloudflare bot challenge blocks all automated access |
| Buildings.com | 4 | `buildings.com/rss` | No* | Legacy `/rss` path removed; working feed found elsewhere |

\* Working alternate URLs exist — see per-feed sections below. Not integrated yet; URLs in `feeds.config.json` still point at dead paths.

---

### 1. BDC Network (Tier 2)

**Configured URL:** `https://www.bdcnetwork.com/rss.xml`

#### What we tested

| URL | HTTP | Response |
|-----|------|----------|
| `https://www.bdcnetwork.com/rss.xml` | **404** | JSON error body: `{"error":true,"statusCode":404,"statusMessage":"Page Not Found"}` |
| `https://www.bdcnetwork.com/feed` | **404** | Same JSON 404 |
| `https://www.bdcnetwork.com/feed/` | **404** | Redirects to `/feed`, same JSON 404 |
| `http://feeds.feedburner.com/bdcnetwork` | **404** | Google FeedBurner "Error 404 (Not Found)" HTML page |
| `https://feeds.feedburner.com/BDCNetwork` | **404** | Same FeedBurner 404 |
| `https://www.bdcnetwork.com/__rss/website-scheduled-content.xml?input={"sectionAlias":"home"}` | **404** | `Content-Type: application/rss+xml` but **0-byte empty body** |
| Same `__rss` pattern for `news`, `latest`, `articles`, `building-design`, `construction` | **404** | All return empty body |

#### Exact problem

1. The client-listed `/rss.xml` path was retired — the site returns a structured JSON 404, not RSS.
2. The old FeedBurner syndication URL is dead (Google 404).
3. The site homepage still advertises an RSS `<link>` tag pointing at `/__rss/website-scheduled-content.xml`, but that CMS endpoint is **broken**: it responds with HTTP 404 and an empty XML body regardless of section alias. The `home` request also gets rewritten to an opaque numeric section ID and still fails.

#### Possible next step

Contact BDC Network / Building Design + Construction publisher support, or monitor whether the `__rss` endpoint is repaired. No reliable public RSS URL is available today.

---

### 2. Trimble News (Tier 3)

**Configured URL:** `https://www.trimble.com/en/news/rss`

#### What we tested

| URL | HTTP | Response |
|-----|------|----------|
| `https://www.trimble.com/en/news/rss` | **404** | Full HTML "Page Not Found" (~1.3 MB SPA page) |
| `https://www.trimble.com/en/news` | **404** | Same — `/en/news` route does not exist |
| `https://www.trimble.com/rss.xml` | **200** | HTML page (SPA shell), not RSS |
| `https://www.trimble.com/feed` | **404** | HTML 404 page |
| `https://investor.trimble.com/rss/news-releases.xml` | **403** | Cloudflare challenge ("Just a moment...") |
| `https://investor.trimble.com/rss/press-releases.xml` | **403** | Cloudflare challenge |
| `https://investor.trimble.com/news-events/news-releases` | **403** | Cloudflare challenge |

#### Working alternates found (not in config)

| URL | HTTP | Items | Recent (30d) | Notes |
|-----|------|-------|--------------|-------|
| `https://www.trimble.com/en/feed/all/blog` | **200** | 50 | 8 | Valid RSS 2.0 — corporate blog posts |
| `https://www.trimble.com/en/feed/all/resources` | **200** | 50 | 4 | Valid RSS 2.0 — resources / collateral |

These URLs are linked from Trimble HTML `<link rel="alternate" type="application/rss+xml">` tags (visible in page source of other Trimble pages). Newest blog item: 2026-07-02; newest resources item: 2026-07-08.

#### Exact problem

The client-provided `/en/news/rss` path **never resolves** — it 404s on Trimble's current Next.js site. Trimble moved RSS to `/en/feed/all/{blog,resources}` but that was not in the original feed list. Investor-relations RSS exists in principle but is behind Cloudflare and inaccessible to automated fetchers (including our validator).

#### Possible next step

Update `feeds.config.json` to use `https://www.trimble.com/en/feed/all/blog` (news-style content) or add both blog + resources feeds. Re-validate and push.

---

### 3. For Construction Pros (Tier 4)

**Configured URL:** `https://www.forconstructionpros.com/rss`

#### What we tested

| URL | HTTP | Response |
|-----|------|----------|
| `https://www.forconstructionpros.com/rss` | **403** | Cloudflare challenge page |
| `https://www.forconstructionpros.com/rss.xml` | **403** | Cloudflare challenge page |
| `https://www.forconstructionpros.com/feed` | **403** | Cloudflare challenge page |
| `https://www.forconstructionpros.com/feeds/news` | **403** | Cloudflare challenge page |
| `https://www.forconstructionpros.com/` (homepage) | **403** | Cloudflare challenge page |

#### Exact problem

The entire domain is behind **Cloudflare bot management**. Automated HTTP clients (our validator, Node `fetch`, and likely Make.com's RSS module) receive HTTP **403** with an HTML page titled **"Just a moment..."** — a JavaScript challenge that requires a real browser session to pass. No RSS `<link>` tag could be discovered because even the homepage is blocked.

This is different from ENR (which also returns 403 to scripts but **works via Make.com's RSS module**). For Construction Pros has not been tested inside Make — it may or may not bypass Cloudflare.

#### Possible next step

1. Test the URL manually in Make.com's RSS module ("Run once") to see if Make's infrastructure passes Cloudflare.
2. If still blocked, look for a third-party syndication mirror (FeedBlitz, etc.) or ask the publisher for an allowlisted feed URL.

---

### 4. Buildings.com (Tier 4)

**Configured URL:** `https://www.buildings.com/rss`

#### What we tested

| URL | HTTP | Response |
|-----|------|----------|
| `https://www.buildings.com/rss` | **404** | JSON error body: `{"error":true,"statusCode":404,"statusMessage":"Page Not Found"}` |
| `https://www.buildings.com/rss.xml` | **404** | Same JSON 404 |
| `https://www.buildings.com/feed` | **404** | Same JSON 404 |
| `https://www.buildings.com/feed/` | **404** | Redirects to `/feed`, same JSON 404 |

#### Working alternate found (not in config)

| URL | HTTP | Items | Recent (30d) | Notes |
|-----|------|-------|--------------|-------|
| `https://www.buildings.com/__rss/website-scheduled-content.xml?input=%7B%22sectionAlias%22%3A%22home%22%7D` | **200** | 25 | 25 | Valid RSS 2.0; linked from homepage `<link rel="alternate">` |

Newest item: 2026-07-06. Same CMS pattern as BDC Network (same publisher group), but **Buildings.com's `__rss` endpoint works** while BDC's does not.

#### Exact problem

The simple `/rss` path listed in the client feed inventory was **retired**. The site now only exposes RSS through a dynamic CMS endpoint (`/__rss/website-scheduled-content.xml?...`) that is not human-obvious and was not in the original URL list.

#### Possible next step

Update `feeds.config.json` URL to the working `__rss` endpoint above, validate, and push.

---

## Client URLs replaced in live config (for reference)

These original client URLs failed validation but **working alternates are already integrated**:

| Client URL | Problem | Live replacement |
|------------|---------|------------------|
| `blog.autodesk.com/feed/` | Redirects to `blogs.autodesk.com` HTML; old path is not RSS | `adsknews.autodesk.com/feed` |
| `bentley.com/.../news/rss` | HTTP 403 (nginx) | `investors.bentley.com/rss/news-releases.xml` |
| `constructiondive.com/topic/technology/feed/` | HTTP 404 | `constructiondive.com/feeds/topic/technology/` |
| `globest.com/feed/` | HTTP 404 | `feeds.feedblitz.com/globest/washington-dc` |
| `datacenterknowledge.com/feed` | Wrong path | `datacenterknowledge.com/rss.xml` |

---

## Re-running this investigation

```bash
# Validate all 14 configured feeds
npm run validate-feeds

# Probe only disabled feeds (re-run after URL changes)
node scripts/validate-feeds.mjs
```

When adding a new feed URL, always check:

1. HTTP status is 200
2. Response body contains `<rss>` or `<feed>` (not HTML)
3. At least one item has a publication date within the last 30 days
4. Make.com RSS module can fetch it (some sites block scripts but allow Make — e.g. ENR)
