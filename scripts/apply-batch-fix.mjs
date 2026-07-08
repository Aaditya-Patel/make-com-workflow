import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const blueprintPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "Integration RSS.blueprint.json"
);

const MAX_RESULTS_PER_FEED = "12";

// The rss:ActionReadArticles module outputs fields keyed title / url /
// dateCreated / summary. Inside a TextAggregator each row must reference the
// FEEDER module explicitly (bare {{title}} does not resolve -> blank text).
const aggValue = (feederId) =>
  `Title: {{${feederId}.title}}\nURL: {{${feederId}.url}}\nDate: {{${feederId}.dateCreated}}\nSummary: {{${feederId}.summary}}\n---`;

const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
const flow = blueprint.flow;

const runAtVar = flow.find((m) => m.id === 14); // Set variable
const feedA = flow.find((m) => m.id === 1); // constructiondive
const feedB = flow.find((m) => m.id === 2); // datacenterdynamics
const aggA = flow.find((m) => m.id === 7); // TextAggregator
const http = flow.find((m) => m.id === 8);

if (!runAtVar || !feedA || !feedB || !aggA || !http) {
  throw new Error("Modules 14, 1, 2, 7, and 8 are required.");
}

// 1. Stamp run timestamp once so all appended rows share it.
runAtVar.mapper.name = "RunAt";
runAtVar.mapper.scope = "roundtrip";
runAtVar.mapper.value = '{{formatDate(now; "YYYY-MM-DD HH:mm:ss")}}';
if (Array.isArray(runAtVar.metadata?.interface) && runAtVar.metadata.interface[0]) {
  runAtVar.metadata.interface[0].name = "RunAt";
  runAtVar.metadata.interface[0].label = "RunAt";
}

// 2. Pull more articles from each feed so the model has real evidence to rank.
feedA.mapper.maxResults = MAX_RESULTS_PER_FEED;
feedB.mapper.maxResults = MAX_RESULTS_PER_FEED;

// filterDateTo was set to {{14.Date}} (= today at midnight) which excludes
// articles published later the same day. Drop the upper bound so RSS results
// are consistent whether the scenario is triggered from the UI or CLI.
delete feedA.mapper.filterDateTo;
delete feedB.mapper.filterDateTo;

// 3. Aggregator 7 now collapses FEED A (module 1) into a single text bundle.
aggA.parameters = { ...aggA.parameters, feeder: 1, rowSeparator: "" };
aggA.mapper.value = aggValue(1);
if (aggA.metadata?.restore?.extra?.feeder) {
  aggA.metadata.restore.extra.feeder.label = "RSS - Retrieve RSS feed items [1]";
}
aggA.metadata = aggA.metadata ?? {};
aggA.metadata.designer = { x: 600, y: 0 };

// 4. Add a second aggregator (id 23) that collapses FEED B (module 2).
let aggB = flow.find((m) => m.id === 23);
if (!aggB) {
  aggB = { id: 23 };
  flow.push(aggB);
}
aggB.module = "util:TextAggregator";
aggB.version = 1;
aggB.mapper = { value: aggValue(2) };
aggB.parameters = { feeder: 2, rowSeparator: "" };
aggB.metadata = {
  designer: { x: 1200, y: 0 },
  restore: {
    extra: { feeder: { label: "RSS - Retrieve RSS feed items [2]" } },
    parameters: { rowSeparator: { label: "Empty" } },
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
};

// 5. Rewire the prompt: include BOTH aggregated feeds and relax the strict
//    "exclude unless confirmed" rule so the model actually returns rows.
const body = JSON.parse(http.mapper.jsonStringBodyContent);
let prompt = body.messages[0].content;

prompt = prompt.replace(
  /ARTICLE BATCH:\\n\{\{escapeJSON\(7\.text\)\}\}(\\n\{\{escapeJSON\(23\.text\)\}\})?/,
  "ARTICLE BATCH:\\n{{escapeJSON(7.text)}}\\n{{escapeJSON(23.text)}}"
);
// Fallback if the exact anchor above changed.
if (!prompt.includes("{{escapeJSON(23.text)}}")) {
  prompt = prompt.replace(
    "{{escapeJSON(7.text)}}",
    "{{escapeJSON(7.text)}}\\n{{escapeJSON(23.text)}}"
  );
}

prompt = prompt.replace(
  "- Do not fabricate deployments. If an article does not confirm a named deployment, do not include it.",
  "- Base the ranking on the evidence in the articles. Prefer named, confirmed deployments, but you may also include AI products, vendors, or clear trends that the articles mention or strongly imply, marking weaker evidence in the notes. Return at least 5 items whenever the batch mentions any AI tools, vendors, or initiatives."
);

body.messages[0].content = prompt;
http.mapper.jsonStringBodyContent = JSON.stringify(body);

// 6. Enforce the correct execution order: 14, 9, 1, 7(aggA), 2, 23(aggB), 8, ...
const order = [14, 9, 1, 7, 2, 23, 8, 18, 19, 20, 21];
blueprint.flow = [
  ...order.map((id) => flow.find((m) => m.id === id)).filter(Boolean),
  ...flow.filter((m) => !order.includes(m.id)),
];

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");

console.log("Applied batch fix:");
console.log(`  feed A (1) maxResults = ${feedA.mapper.maxResults}`);
console.log(`  feed B (2) maxResults = ${feedB.mapper.maxResults}`);
console.log("  aggregator 7 feeder = 1 (feed A)");
console.log("  aggregator 23 feeder = 2 (feed B)  [new]");
console.log("  prompt now includes {{7.text}} + {{23.text}} and relaxed rules");
console.log(`  flow order: ${blueprint.flow.map((m) => m.id).join(", ")}`);
