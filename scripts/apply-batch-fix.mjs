import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const blueprintPath = join(rootDir, "Integration RSS.blueprint.json");
const feedsConfigPath = join(rootDir, "feeds.config.json");
const mapPromptPath = join(rootDir, "prompts", "map.txt");
const mergePromptPath = join(rootDir, "prompts", "merge.txt");

const TAIL_MODULE_IDS = [8, 18, 19, 20, 21];
const HEAD_MODULE_IDS = [14, 9];
const AGGREGATOR_IDS = [7, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35];
const MAP_HTTP_IDS = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63];
const RESERVED_MODULE_IDS = new Set([
  ...HEAD_MODULE_IDS,
  ...TAIL_MODULE_IDS,
  ...AGGREGATOR_IDS,
  ...MAP_HTTP_IDS,
]);

const VENDOR_RULE =
  "- This feed is sourceType vendor. Flag items in source_credibility as Vendor-published only unless the article cites independent third-party deployments. Deprioritize pure vendor claims.";

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
    `Feed URL: ${feed.url}`,
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

function fillTemplate(template, values) {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{{${key}}}`).join(String(value));
  }
  return result;
}

function emptyCandidatesJson(feed) {
  return JSON.stringify({
    feed_name: feed.name,
    feed_url: feed.url,
    candidates: [],
  });
}

function createRssResumeHandler(feed, designerX, designerY) {
  return {
    id: 7000 + feed.id,
    module: "builtin:Resume",
    version: 1,
    metadata: {
      designer: { x: designerX, y: designerY + 120 },
    },
    mapper: {
      title: "",
      summary: "",
      description: "",
      url: "",
      dateCreated: "",
    },
    parameters: {},
  };
}

function createMapResumeHandler(feed, designerX, designerY) {
  return {
    id: 8000 + feed.mapHttpId,
    module: "builtin:Resume",
    version: 1,
    metadata: {
      designer: { x: designerX, y: designerY + 120 },
    },
    mapper: {
      data: {
        choices: [
          {
            message: {
              content: emptyCandidatesJson(feed),
            },
          },
        ],
      },
    },
    parameters: {},
  };
}

function createRssModule(feed, template, designerX, designerY) {
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
  module.metadata.designer = { x: designerX, y: designerY };
  module.parameters = { include: [] };
  // Flaky publisher blocks (403) must not abort later feeds / merge.
  module.onerror = [createRssResumeHandler(feed, designerX, designerY)];
  return module;
}

function createAggregator(feed, designerX, designerY) {
  return {
    id: feed.aggId,
    module: "util:TextAggregator",
    version: 1,
    mapper: { value: aggValue(feed) },
    parameters: { feeder: feed.id, rowSeparator: "" },
    metadata: {
      designer: { x: designerX, y: designerY },
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

function buildMapPrompt(feed, mapPromptTemplate, maxCandidates) {
  const vendorRule =
    feed.sourceType === "vendor"
      ? VENDOR_RULE
      : "- If content looks vendor-published, flag source_credibility accordingly.";

  return fillTemplate(mapPromptTemplate, {
    FEED_NAME: feed.name,
    FEED_URL: feed.url,
    FEED_TIER: feed.tier,
    FEED_SOURCE_TYPE: feed.sourceType,
    ARTICLE_BATCH: `{{escapeJSON(${feed.aggId}.text)}}`,
    MAX_CANDIDATES: maxCandidates,
    VENDOR_RULE: vendorRule,
  });
}

function createMapHttpModule(feed, httpTemplate, mapPromptTemplate, maxCandidates, designerX, designerY) {
  const module = cloneJson(httpTemplate);
  module.id = feed.mapHttpId;
  module.metadata = module.metadata ?? {};
  module.metadata.designer = { x: designerX, y: designerY };

  const prompt = buildMapPrompt(feed, mapPromptTemplate, maxCandidates);
  const body = {
    max_completion_tokens: 16000,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  };
  module.mapper = {
    ...module.mapper,
    method: "post",
    timeout: "300",
    contentType: "json",
    inputMethod: "jsonString",
    shareCookies: false,
    parseResponse: true,
    allowRedirects: true,
    stopOnHttpError: true,
    requestCompressedContent: true,
    headers: [
      { name: "api-key", value: "{{9.value}}" },
      { name: "content-type", value: "application/json" },
    ],
    jsonStringBodyContent: JSON.stringify(body),
  };
  // Azure timeouts / 403s on one feed should yield empty candidates, not abort merge.
  module.onerror = [createMapResumeHandler(feed, designerX, designerY)];
  return module;
}

function buildFeedReference(enabledFeeds) {
  return enabledFeeds.map((feed) => `- ${feed.name}: ${feed.url}`).join("\n");
}

function buildCandidatesBatch(enabledFeeds) {
  return enabledFeeds
    .map(
      (feed) =>
        `--- FEED: ${feed.name} ---\n{{escapeJSON(${feed.mapHttpId}.data.choices[].message.content)}}`
    )
    .join("\n\n");
}

function updateMergePrompt(http, enabledFeeds, mergePromptTemplate) {
  const prompt = fillTemplate(mergePromptTemplate, {
    CANDIDATES_BATCH: buildCandidatesBatch(enabledFeeds),
    FEED_REFERENCE: buildFeedReference(enabledFeeds),
  });

  const body = {
    max_completion_tokens: 16000,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  };
  http.mapper.jsonStringBodyContent = JSON.stringify(body);
  http.mapper.headers = [
    { name: "api-key", value: "{{9.value}}" },
    { name: "content-type", value: "application/json" },
  ];
  http.mapper.method = "post";
  http.mapper.timeout = "300";
  http.mapper.contentType = "json";
  http.mapper.inputMethod = "jsonString";
  http.mapper.parseResponse = true;
  http.mapper.stopOnHttpError = true;
}

function validateFeedIds(enabledFeeds) {
  const used = new Set();
  for (const feed of enabledFeeds) {
    for (const [label, id] of [
      ["id", feed.id],
      ["aggId", feed.aggId],
      ["mapHttpId", feed.mapHttpId],
    ]) {
      if (id == null) {
        throw new Error(`Feed "${feed.name}" is missing ${label}.`);
      }
      if (used.has(id)) {
        throw new Error(`Duplicate module id ${id} on feed "${feed.name}" (${label}).`);
      }
      used.add(id);
    }
    if (RESERVED_MODULE_IDS.has(feed.id)) {
      throw new Error(
        `Feed "${feed.name}" uses reserved module id ${feed.id}. Choose a feed id that does not conflict with system modules (8, 9, 14, 18-21), aggregators (7, 23-35), or map HTTP modules (50-63).`
      );
    }
    if (!MAP_HTTP_IDS.includes(feed.mapHttpId)) {
      throw new Error(
        `Feed "${feed.name}" mapHttpId ${feed.mapHttpId} must be in 50-63.`
      );
    }
  }
}

const feedsConfig = loadFeedsConfig();
const mapPromptTemplate = readFileSync(mapPromptPath, "utf8");
const mergePromptTemplate = readFileSync(mergePromptPath, "utf8");
const maxCandidates = feedsConfig.defaults.mapCandidatesMax ?? 5;

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

validateFeedIds(enabledFeeds);

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

const preservedById = new Map(
  flow
    .filter((module) => HEAD_MODULE_IDS.includes(module.id) || TAIL_MODULE_IDS.includes(module.id))
    .map((module) => [module.id, module])
);

const rowHeight = 250;
const feedsByTier = new Map();
for (const feed of enabledFeeds) {
  if (!feedsByTier.has(feed.tier)) {
    feedsByTier.set(feed.tier, []);
  }
  feedsByTier.get(feed.tier).push(feed);
}

const orderedModules = [];
const sortedTiers = [...feedsByTier.keys()].sort((a, b) => a - b);
for (const tier of sortedTiers) {
  const tierFeeds = feedsByTier.get(tier);
  tierFeeds.forEach((feed, indexInTier) => {
    const designerY = (tier - 1) * rowHeight;
    const designerX = indexInTier * 900;
    orderedModules.push(createRssModule(feed, rssTemplate, designerX, designerY));
    orderedModules.push(createAggregator(feed, designerX + 300, designerY));
    orderedModules.push(
      createMapHttpModule(
        feed,
        http,
        mapPromptTemplate,
        maxCandidates,
        designerX + 600,
        designerY
      )
    );
  });
}

updateMergePrompt(http, enabledFeeds, mergePromptTemplate);
http.metadata = http.metadata ?? {};
http.metadata.designer = {
  x: 0,
  y: sortedTiers.length * rowHeight,
};

const tailModules = TAIL_MODULE_IDS.map((id) => {
  const module = preservedById.get(id);
  if (!module) {
    return null;
  }
  if (id !== 8) {
    module.metadata = module.metadata ?? {};
    const offset = TAIL_MODULE_IDS.indexOf(id);
    module.metadata.designer = {
      x: offset * 300,
      y: sortedTiers.length * rowHeight,
    };
  }
  return module;
}).filter(Boolean);

const headModules = HEAD_MODULE_IDS.map((id) => preservedById.get(id)).filter(Boolean);
if (headModules[0]?.metadata) {
  headModules[0].metadata.designer = { x: -600, y: -200 };
}
if (headModules[1]?.metadata) {
  headModules[1].metadata.designer = { x: -300, y: -200 };
}

blueprint.flow = [...headModules, ...orderedModules, ...tailModules];

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");

console.log("Applied map-reduce batch fix from feeds.config.json:");
for (const feed of enabledFeeds) {
  console.log(
    `  feed ${feed.id} (${feed.name}) maxResults=${feed.maxResults} -> agg ${feed.aggId} -> map HTTP ${feed.mapHttpId}`
  );
}
console.log(`  map candidates max: ${maxCandidates}`);
console.log(`  merge HTTP 8 consumes ${enabledFeeds.length} map outputs`);
console.log(`  LLM calls per run: ${enabledFeeds.length} map + 1 merge = ${enabledFeeds.length + 1}`);
console.log(`  flow order: ${blueprint.flow.map((module) => module.id).join(", ")}`);
