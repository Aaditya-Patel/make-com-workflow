// Local due-diligence replica of the Make scenario pipeline.
// Fetches the same RSS feeds, runs the same map/merge prompts on the same
// Azure deployment, then strictly audits product names and source URLs.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const feedsConfig = JSON.parse(
  readFileSync(join(rootDir, "feeds.config.json"), "utf8")
);
const mapTemplate = readFileSync(join(rootDir, "prompts", "map.txt"), "utf8");
const mergeTemplate = readFileSync(
  join(rootDir, "prompts", "merge.txt"),
  "utf8"
);

const env = Object.fromEntries(
  readFileSync(join(rootDir, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const AZURE_URL = `${env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${env.AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${env.AZURE_OPENAI_API_VERSION}`;
const VENDOR_RULE =
  "- This feed is sourceType vendor. Flag items in source_credibility as Vendor-published only unless the article cites independent third-party deployments. Deprioritize pure vendor claims.";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function fillTemplate(template, values) {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{{${key}}}`).join(String(value));
  }
  return result;
}

function decode(s) {
  return (s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

function parseFeed(xml) {
  const items = [];
  const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of rssItems) {
    items.push({
      title: decode(tag(block, "title")),
      url: decode(tag(block, "link")) || (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || "",
      date: decode(tag(block, "pubDate")) || decode(tag(block, "dc:date")),
      summary: decode(tag(block, "description")) || decode(tag(block, "content:encoded")).slice(0, 1500),
    });
  }
  if (!items.length) {
    const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const block of entries) {
      const linkAlt =
        (block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i) || [])[1] ||
        (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] ||
        "";
      items.push({
        title: decode(tag(block, "title")),
        url: linkAlt,
        date: decode(tag(block, "published")) || decode(tag(block, "updated")),
        summary: decode(tag(block, "summary")) || decode(tag(block, "content")).slice(0, 1500),
      });
    }
  }
  return items;
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      redirect: "follow",
    });
    if (!res.ok) return { feed, error: `HTTP ${res.status}`, items: [] };
    const xml = await res.text();
    let items = parseFeed(xml);
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    items = items.filter((it) => {
      const t = Date.parse(it.date);
      return Number.isNaN(t) ? true : t >= cutoff;
    });
    return { feed, items: items.slice(0, 20) };
  } catch (err) {
    return { feed, error: err.message, items: [] };
  }
}

function buildArticleBatch(items) {
  return items
    .map((it) => `Title: ${it.title}\nURL: ${it.url}\nDate: ${it.date}\nSummary: ${it.summary}\n---`)
    .join("\n");
}

async function callLLM(prompt, label) {
  const res = await fetch(AZURE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": env.OPENAI_API_KEY },
    body: JSON.stringify({
      max_completion_tokens: 16000,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`${label}: Azure HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  const content = data.choices[0].message.content.replace(/```json|```/g, "").trim();
  return JSON.parse(content);
}

async function checkUrl(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    return res.status;
  } catch (err) {
    return `ERR ${err.name}`;
  }
}

const enabledFeeds = feedsConfig.feeds.filter((f) => f.enabled);
console.log(`Fetching ${enabledFeeds.length} feeds...`);
const fetched = await Promise.all(enabledFeeds.map(fetchFeed));

const allArticleUrls = new Set();
for (const f of fetched) {
  console.log(
    `  ${f.feed.name}: ${f.items.length} items${f.error ? ` (FETCH FAILED: ${f.error})` : ""}`
  );
  for (const it of f.items) if (it.url) allArticleUrls.add(it.url.trim());
}

console.log("\nRunning map calls...");
const mapOutputs = [];
await Promise.all(
  fetched.map(async (f) => {
    if (!f.items.length) {
      mapOutputs.push({ feed: f.feed, output: { feed_name: f.feed.name, feed_url: f.feed.url, candidates: [] } });
      return;
    }
    const prompt = fillTemplate(mapTemplate, {
      FEED_NAME: f.feed.name,
      FEED_URL: f.feed.url,
      FEED_TIER: f.feed.tier,
      FEED_SOURCE_TYPE: f.feed.sourceType,
      ARTICLE_BATCH: buildArticleBatch(f.items),
      MAX_CANDIDATES: feedsConfig.defaults.mapCandidatesMax,
      VENDOR_RULE: f.feed.sourceType === "vendor" ? VENDOR_RULE : "",
    });
    const output = await callLLM(prompt, `map ${f.feed.name}`);
    console.log(`  ${f.feed.name}: ${output.candidates?.length ?? 0} candidates`);
    mapOutputs.push({ feed: f.feed, output });
  })
);

const candidatesBatch = mapOutputs
  .map((m) => JSON.stringify(m.output))
  .join("\n\n");
const feedReference = enabledFeeds.map((f) => `- ${f.name}: ${f.url}`).join("\n");

console.log("\nRunning merge call...");
const merged = await callLLM(
  fillTemplate(mergeTemplate, {
    CANDIDATES_BATCH: candidatesBatch,
    FEED_REFERENCE: feedReference,
  }),
  "merge"
);

writeFileSync(
  join(rootDir, "audit-output.json"),
  JSON.stringify({ mapOutputs: mapOutputs.map((m) => m.output), merged }, null, 2)
);

console.log(`\nMerged items: ${merged.items?.length ?? 0}\n`);
console.log("=== AUDIT ===");
const urlRegex = /https?:\/\/[^\s,")]+/;
let failures = 0;
for (const item of merged.items || []) {
  const problems = [];
  if (!/^.+\(.+\)\s*$/.test(item.product || "")) {
    problems.push(`product not in "Name (Vendor)" form`);
  }
  const m = (item.source || "").match(urlRegex);
  const url = m ? m[0].replace(/[.,;]+$/, "") : null;
  let status = "no URL";
  let verbatim = false;
  if (url) {
    verbatim = allArticleUrls.has(url);
    status = await checkUrl(url);
    if (!verbatim) problems.push("URL not verbatim from any fetched feed item");
    if (String(status) !== "200") problems.push(`URL returned ${status}`);
  } else {
    problems.push("no URL in source field");
  }
  const ok = problems.length === 0;
  if (!ok) failures++;
  console.log(`\n#${item.rank} ${item.product}`);
  console.log(`  summary words: ${(item.product_summary || "").split(/\s+/).length}`);
  console.log(`  contractors: ${item.named_contractors}`);
  console.log(`  url: ${url ?? "-"} [http ${status}] [verbatim: ${verbatim}]`);
  console.log(ok ? "  PASS" : `  FAIL: ${problems.join("; ")}`);
}
console.log(`\n${failures === 0 ? "ALL ITEMS PASS" : failures + " item(s) FAILED"}`);
