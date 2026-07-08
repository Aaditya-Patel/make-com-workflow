import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const feedsConfigPath = join(rootDir, "feeds.config.json");

const RECENCY_DAYS = 30;
const tierArg = process.argv[2];
const tierFilter = tierArg ? Number(tierArg) : null;

function loadFeedsConfig() {
  return JSON.parse(readFileSync(feedsConfigPath, "utf8"));
}

function parseFeedDates(xml) {
  const dates = [];
  const patterns = [
    /<pubDate[^>]*>([^<]+)<\/pubDate>/gi,
    /<updated[^>]*>([^<]+)<\/updated>/gi,
    /<published[^>]*>([^<]+)<\/published>/gi,
    /<dc:date[^>]*>([^<]+)<\/dc:date>/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(xml)) !== null) {
      const parsed = Date.parse(match[1].trim());
      if (!Number.isNaN(parsed)) {
        dates.push(new Date(parsed));
      }
    }
  }

  return dates;
}

function isFeedXml(xml) {
  return /(<rss[\s>]|xmlns:atom=|<feed[\s>])/i.test(xml);
}

function countItems(xml) {
  const itemMatches = xml.match(/<item[\s>]/gi) ?? [];
  const entryMatches = xml.match(/<entry[\s>]/gi) ?? [];
  return Math.max(itemMatches.length, entryMatches.length);
}

async function validateFeed(feed) {
  const result = {
    id: feed.id,
    name: feed.name,
    tier: feed.tier,
    url: feed.url,
    enabled: feed.enabled,
    ok: false,
    status: null,
    itemCount: 0,
    recentCount: 0,
    error: null,
  };

  try {
    const response = await fetch(feed.url, {
      headers: {
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });

    result.status = response.status;
    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      return result;
    }

    const xml = await response.text();
    if (!isFeedXml(xml)) {
      result.error = "Response is not RSS/Atom XML";
      return result;
    }

    result.itemCount = countItems(xml);
    if (result.itemCount === 0) {
      result.error = "No RSS items or Atom entries found";
      return result;
    }

    const cutoff = Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000;
    const dates = parseFeedDates(xml);
    result.recentCount = dates.filter((date) => date.getTime() >= cutoff).length;

    if (result.recentCount === 0 && dates.length === 0) {
      result.error = "Could not parse publication dates";
      return result;
    }

    if (result.recentCount === 0) {
      result.error = `No items within last ${RECENCY_DAYS} days`;
      return result;
    }

    result.ok = true;
    return result;
  } catch (error) {
    result.error = error.message;
    return result;
  }
}

const config = loadFeedsConfig();
let feeds = config.feeds;
if (tierFilter) {
  feeds = feeds.filter((feed) => feed.tier === tierFilter);
}

console.log(
  tierFilter
    ? `Validating Tier ${tierFilter} feeds (${feeds.length})...`
    : `Validating all feeds (${feeds.length})...`
);
console.log("");

const results = [];
for (const feed of feeds) {
  const result = await validateFeed(feed);
  results.push(result);
  const status = result.ok ? "OK" : feed.allowValidationFailure ? "WARN" : "FAIL";
  const enabled = feed.enabled ? "enabled" : "disabled";
  const note = feed.validationNote ? ` (${feed.validationNote})` : "";
  console.log(
    `[${status}] Tier ${feed.tier} ${feed.name} (${enabled}) -> ${result.status ?? "n/a"}, items=${result.itemCount}, recent=${result.recentCount}${result.error ? `, ${result.error}` : ""}${note}`
  );
}

console.log("");
const hardFailures = results.filter(
  (result, index) => !result.ok && !feeds[index].allowValidationFailure
);
const passed = results.filter((result) => result.ok).length;
const warned = results.filter(
  (result, index) => !result.ok && feeds[index].allowValidationFailure
).length;
console.log(
  `Summary: ${passed} passed, ${warned} warned, ${hardFailures.length} failed`
);

if (hardFailures.length > 0) {
  process.exit(1);
}
