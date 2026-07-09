import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const blueprintPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "Integration RSS.blueprint.json"
);

// Column order must match the sheet header row (A..P).
const FIELD_NAMES = [
  "rank",
  "product",
  "category",
  "adoption_score",
  "adoption_note",
  "roi_score",
  "roi_note",
  "recency_score",
  "recency_note",
  "composite",
  "key_evidence",
  "named_contractors",
  "source",
  "source_credibility",
  "feed_citation",
];
const RUN_AT_COLUMN = "14";
const RUN_AT_VALUE = "{{14.RunAt}}";
const FEED_CITATION_COLUMN = "15";

const COLUMN_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function isNumeric(name) {
  return name === "rank" || name === "composite" || name.endsWith("_score");
}

const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));

// Remove any Array Aggregator experiment (module 22) — not needed and the
// module slug is not available on this zone.
blueprint.flow = blueprint.flow.filter((module) => module.id !== 22);

const cleanModule = blueprint.flow.find((module) => module.id === 18);
const parseModule = blueprint.flow.find((module) => module.id === 19);
const feederModule = blueprint.flow.find((module) => module.id === 20);
const sheetsModule = blueprint.flow.find((module) => module.id === 21);

if (!cleanModule || !parseModule || !feederModule || !sheetsModule) {
  throw new Error("Modules 18, 19, 20, and 21 are required.");
}

// 1. cleanJSON: extract the model's message text and strip any ```json / ```
//    fences. Make IML does not support numeric bracket indexing ([1]); the
//    empty-bracket map operator ([]) is the correct way to reach into the
//    single-element choices array (mirrors the original content[].text).
cleanModule.mapper.value =
  '{{replace(replace(8.data.choices[].message.content; "```json"; ); "```"; )}}';

// 2. ParseJSON: parse dynamically (no data structure) and advertise the
//    items[] shape so the Iterator/Sheets designer can see the fields.
parseModule.parameters = {};
parseModule.metadata.interface = [
  {
    name: "items",
    type: "array",
    label: "items",
    spec: FIELD_NAMES.map((name) => ({
      name,
      type: isNumeric(name) ? "number" : "text",
      label: name,
    })),
  },
];

// 3. Iterator: iterate the parsed items array.
feederModule.mapper.array = "{{19.items}}";

// 4. addRow: map LLM fields to A..N, run_at in O, feed_citation in P.
const values = {};
FIELD_NAMES.slice(0, 14).forEach((name, index) => {
  values[String(index)] = `{{20.${name}}}`;
});
values[RUN_AT_COLUMN] = RUN_AT_VALUE;
values[FEED_CITATION_COLUMN] = `{{20.feed_citation}}`;

const connectionId = sheetsModule.parameters?.__IMTCONN__ ?? 9717356;
const spreadsheetId =
  sheetsModule.mapper?.spreadsheetId ??
  "/1z__AJxtecScgpU6kYeirA9z3NPHtJzYwo3nmiepiWjg";
const sheetId = sheetsModule.mapper?.sheetId ?? "Sheet1";

sheetsModule.module = "google-sheets:addRow";
sheetsModule.version = 2;
sheetsModule.parameters = { __IMTCONN__: connectionId };
sheetsModule.mapper = {
  from: "drive",
  mode: "select",
  values,
  sheetId,
  spreadsheetId,
  includesHeaders: true,
  insertDataOption: "INSERT_ROWS",
  useColumnHeaders: false,
  valueInputOption: "USER_ENTERED",
  insertUnformatted: false,
};

// Ensure the addRow value spec exists so the columns render correctly.
sheetsModule.metadata = sheetsModule.metadata ?? {};
sheetsModule.metadata.expect = [
  { name: "from", type: "select", label: "Drive", required: true, validate: { enum: ["drive", "share"] } },
  { name: "mode", type: "select", label: "Search Method", required: true },
  { name: "spreadsheetId", type: "file", label: "Spreadsheet ID", required: true },
  { name: "sheetId", type: "select", label: "Sheet Name", required: true },
  { name: "includesHeaders", type: "boolean", label: "Table contains headers", required: true },
  {
    name: "values",
    type: "collection",
    label: "Values",
    spec: COLUMN_LABELS.map((label, index) => ({
      name: String(index),
      type: "text",
      label,
    })),
  },
];

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");

console.log("Applied clean Google Sheets addRow mapping:");
console.log("  cleanJSON:", cleanModule.mapper.value);
console.log("  iterator :", feederModule.mapper.array);
console.log("  col A -> ", values["0"]);
console.log("  col N -> ", values["13"]);
console.log("  col O -> ", values[RUN_AT_COLUMN]);
console.log("  col P -> ", values[FEED_CITATION_COLUMN]);
