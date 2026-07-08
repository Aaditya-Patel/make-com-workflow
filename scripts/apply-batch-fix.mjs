import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const blueprintPath = join(rootDir, "Integration RSS.blueprint.json");
const feedsConfigPath = join(rootDir, "feeds.config.json");

const TAIL_MODULE_IDS = [8, 18, 19, 20, 21];
const HEAD_MODULE_IDS = [14, 9];

function loadFeedsConfig() {
  return JSON.parse(readFileSync(feedsConfigPath, "utf8"));
}

function maxResultsForTier(defaults, tier) {
  switch (tier) {
    case 1:
      return String(defaults.maxResultsTier1 ?? 6);
    case 2:
      return String(defaults.maxResultsTier2 ?? 4);
    case 3:
      return String(defaults.maxResultsTier3 ?? 4);
    case 4:
      return String(defaults.maxResultsTier4 ?? 3);
    default:
      return "6";
  }
}

function aggValue(feed) {
  return [
    `Source: ${feed.name} (Tier ${feed.tier}, ${feed.sourceType})`,
    `Title: {{${feed.id}.title}}`,
    `URL: {{${feed.id}.url}}`,
    `Date: {{${feed.id}.dateCreated}}`,
    `Summary: {{${feed.id}.summary}}`,
    "---",
  ].join("\n");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRssModule(feed, template, designerX) {
  const module = cloneJson(template);
  module.id = feed.id;
  module.mapper = {
    url: feed.url,
    gzip: true,
    password: "",
    username: "",
    maxResults: feed.maxResults,
    filterDateFrom: feed.filterDateFrom,
  };
  delete module.mapper.filterDateTo;
  module.module = "rss:ActionReadArticles";
  module.version = 4;
  module.metadata = module.metadata ?? {};
  module.metadata.designer = { x: designerX, y: 0 };
  module.parameters = { include: [] };
  return module;
}

function createAggregator(feed, designerX) {
  return {
    id: feed.aggId,
    module: "util:TextAggregator",
    version: 1,
    mapper: { value: aggValue(feed) },
    parameters: { feeder: feed.id, rowSeparator: "" },
    metadata: {
      designer: { x: designerX, y: 0 },
      restore: {
        extra: {
          feeder: {
            label: `RSS - Retrieve RSS feed items [${feed.id}]`,
          },
        },
        parameters: {
          rowSeparator: { label: "Empty" },
        },
      },
      expect: [{ name: "value", type: "text", label: "Text" }],
      parameters: [
        {
          name: "rowSeparator",
          type: "select",
          label: "Row separator",
          validate: { enum: ["\n", "\t", "other"] },
        },
      ],
    },
  };
}

function buildArticleBatch(enabledFeeds) {
  return enabledFeeds
    .map((feed) => `{{escapeJSON(${feed.aggId}.text)}}`)
    .join("\\n");
}

function updatePrompt(http, enabledFeeds) {
  const body = JSON.parse(http.mapper.jsonStringBodyContent);
  let prompt = body.messages[0].content;
  const articleBatch = buildArticleBatch(enabledFeeds);

  if (/ARTICLE BATCH:\\n/.test(prompt)) {
    prompt = prompt.replace(
      /ARTICLE BATCH:\\n(?:\{\{escapeJSON\(\d+\.text\)\}\}\\n?)*/,
      `ARTICLE BATCH:\\n${articleBatch}`
    );
  } else {
    prompt = prompt.replace(
      "{{escapeJSON(7.text)}}",
      articleBatch.replace(/\\n/g, "\n")
    );
  }

  const vendorRule =
    "- Articles tagged sourceType vendor in the batch are vendor-published. Flag them in source_credibility and deprioritize unless they cite independent third-party deployments.";
  if (enabledFeeds.some((feed) => feed.sourceType === "vendor")) {
    if (!prompt.includes("sourceType vendor")) {
      prompt = prompt.replace(
        "- Flag all vendor-published figures clearly.",
        `- Flag all vendor-published figures clearly.\n${vendorRule}`
      );
    }
  }

  if (!prompt.includes("Return at least 5 items")) {
    prompt = prompt.replace(
      "- Do not fabricate deployments. If an article does not confirm a named deployment, do not include it.",
      "- Base the ranking on the evidence in the articles. Prefer named, confirmed deployments, but you may also include AI products, vendors, or clear trends that the articles mention or strongly imply, marking weaker evidence in the notes. Return at least 5 items whenever the batch mentions any AI tools, vendors, or initiatives."
    );
  }

  body.messages[0].content = prompt;
  http.mapper.jsonStringBodyContent = JSON.stringify(body);
}

const feedsConfig = loadFeedsConfig();
const enabledFeeds = feedsConfig.feeds
  .filter((feed) => feed.enabled)
  .map((feed) => ({
    ...feed,
    maxResults: maxResultsForTier(feedsConfig.defaults, feed.tier),
    filterDateFrom:
      feedsConfig.defaults.filterDateFrom ?? "{{addDays(now; -30)}}",
  }));

if (enabledFeeds.length === 0) {
  throw new Error("No enabled feeds in feeds.config.json");
}

const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
const flow = blueprint.flow;

const runAtVar = flow.find((module) => module.id === 14);
const http = flow.find((module) => module.id === 8);
const rssTemplate = flow.find((module) => module.id === 1);

if (!runAtVar || !http || !rssTemplate) {
  throw new Error("Modules 14, 1, and 8 are required.");
}

runAtVar.mapper.name = "RunAt";
runAtVar.mapper.scope = "roundtrip";
runAtVar.mapper.value = '{{formatDate(now; "YYYY-MM-DD HH:mm:ss")}}';
if (Array.isArray(runAtVar.metadata?.interface) && runAtVar.metadata.interface[0]) {
  runAtVar.metadata.interface[0].name = "RunAt";
  runAtVar.metadata.interface[0].label = "RunAt";
}

const enabledFeedIds = new Set(enabledFeeds.map((feed) => feed.id));
const enabledAggIds = new Set(enabledFeeds.map((feed) => feed.aggId));
const reservedIds = new Set([
  ...HEAD_MODULE_IDS,
  ...TAIL_MODULE_IDS,
  ...enabledFeedIds,
  ...enabledAggIds,
]);

const preservedModules = flow.filter((module) => reservedIds.has(module.id));
const preservedById = new Map(preservedModules.map((module) => [module.id, module]));

const feedModules = [];
const aggModules = [];
enabledFeeds.forEach((feed, index) => {
  const designerX = index * 600;
  feedModules.push(createRssModule(feed, rssTemplate, designerX));
  aggModules.push(createAggregator(feed, designerX + 300));
});

updatePrompt(http, enabledFeeds);

const tailModules = TAIL_MODULE_IDS.map((id) => preservedById.get(id)).filter(Boolean);
const headModules = HEAD_MODULE_IDS.map((id) => preservedById.get(id)).filter(Boolean);

const orderedModules = [];
for (const feed of enabledFeeds) {
  orderedModules.push(feedModules.find((module) => module.id === feed.id));
  orderedModules.push(aggModules.find((module) => module.id === feed.aggId));
}

blueprint.flow = [
  ...headModules,
  ...orderedModules,
  ...tailModules,
];

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");

console.log("Applied batch fix from feeds.config.json:");
for (const feed of enabledFeeds) {
  console.log(
    `  feed ${feed.id} (${feed.name}) maxResults=${feed.maxResults} -> agg ${feed.aggId}`
  );
}
console.log(`  prompt includes ${enabledFeeds.length} aggregated feed blocks`);
console.log(`  flow order: ${blueprint.flow.map((module) => module.id).join(", ")}`);
