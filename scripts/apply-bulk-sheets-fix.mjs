import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const blueprintPath = join(rootDir, "Integration RSS.blueprint.json");
const projectPath = join(rootDir, "make.project.json");

// Column order A..N = LLM fields below; O = run_at; P = feed_citation; Q = product_summary
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
];
const PARSE_FIELD_NAMES = [...FIELD_NAMES, "feed_citation", "product_summary"];
const RUN_AT_COLUMN = "14";
const RUN_AT_VALUE = "{{14.RunAt}}";
const FEED_CITATION_COLUMN = "15";
const PRODUCT_SUMMARY_COLUMN = "16";

const COLUMN_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function isNumeric(name) {
  return name === "rank" || name === "composite" || name.endsWith("_score");
}

function loadProject() {
  return JSON.parse(readFileSync(projectPath, "utf8"));
}

function findSheetsModule(blueprint, project) {
  const configuredId = project.googleSheets?.moduleId;
  if (configuredId != null) {
    const byId = blueprint.flow.find((module) => module.id === Number(configuredId));
    if (byId) return byId;
  }
  return blueprint.flow.find((module) => module.module === "google-sheets:addRow");
}

const project = loadProject();
const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));

const cleanModule = blueprint.flow.find((module) => module.id === 18);
const parseModule = blueprint.flow.find((module) => module.id === 19);
const feederModule = blueprint.flow.find((module) => module.id === 20);
const sheetsModule = findSheetsModule(blueprint, project);

if (!cleanModule || !parseModule || !feederModule || !sheetsModule) {
  throw new Error(
    "Modules 18, 19, 20, and a Google Sheets addRow module are required."
  );
}

cleanModule.mapper.value =
  '{{replace(replace(8.data.choices[].message.content; "```json"; ); "```"; )}}';

parseModule.parameters = {};
parseModule.metadata.interface = [
  {
    name: "items",
    type: "array",
    label: "items",
    spec: PARSE_FIELD_NAMES.map((name) => ({
      name,
      type: isNumeric(name) ? "number" : "text",
      label: name,
    })),
  },
];

feederModule.mapper.array = "{{19.items}}";
if (Array.isArray(feederModule.metadata?.expect?.[0]?.spec)) {
  feederModule.metadata.expect[0].spec = PARSE_FIELD_NAMES.map((name) => ({
    name,
    type: isNumeric(name) ? "number" : "text",
    label: name,
  }));
}

const values = {};
FIELD_NAMES.forEach((name, index) => {
  values[String(index)] = `{{20.${name}}}`;
});
values[RUN_AT_COLUMN] = RUN_AT_VALUE;
values[FEED_CITATION_COLUMN] = "{{20.feed_citation}}";
values[PRODUCT_SUMMARY_COLUMN] = "{{20.product_summary}}";

const connectionId =
  sheetsModule.parameters?.__IMTCONN__ ??
  project.googleSheets?.connectionId ??
  9717356;
const spreadsheetId =
  sheetsModule.mapper?.spreadsheetId ??
  `/${project.googleSheets?.spreadsheetId ?? "1z__AJxtecScgpU6kYeirA9z3NPHtJzYwo3nmiepiWjg"}`;
const sheetId =
  sheetsModule.mapper?.sheetId ?? project.googleSheets?.sheetTab ?? "Sheet1";

sheetsModule.module = "google-sheets:addRow";
sheetsModule.version = 2;
sheetsModule.parameters = { __IMTCONN__: Number(connectionId) };
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

sheetsModule.metadata = sheetsModule.metadata ?? {};
sheetsModule.metadata.expect = [
  {
    name: "from",
    type: "select",
    label: "Drive",
    required: true,
    validate: { enum: ["drive", "share"] },
  },
  { name: "mode", type: "select", label: "Search Method", required: true },
  {
    name: "spreadsheetId",
    type: "file",
    label: "Spreadsheet ID",
    required: true,
  },
  { name: "sheetId", type: "select", label: "Sheet Name", required: true },
  {
    name: "includesHeaders",
    type: "boolean",
    label: "Table contains headers",
    required: true,
  },
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

if (project.googleSheets) {
  project.googleSheets.moduleId = sheetsModule.id;
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
}

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");

console.log("Applied clean Google Sheets addRow mapping:");
console.log(`  sheets module id: ${sheetsModule.id}`);
console.log("  cleanJSON:", cleanModule.mapper.value);
console.log("  iterator :", feederModule.mapper.array);
console.log("  col A -> ", values["0"]);
console.log("  col N -> ", values["13"]);
console.log("  col O -> ", values[RUN_AT_COLUMN]);
console.log("  col P -> ", values[FEED_CITATION_COLUMN]);
console.log("  col Q -> ", values[PRODUCT_SUMMARY_COLUMN]);
