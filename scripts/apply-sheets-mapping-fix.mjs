import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const blueprintPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "Integration RSS.blueprint.json"
);

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

function rowValue(fieldName) {
  return `{{get(get(19.items; add(20.__IMTINDEX__; 1)); "${fieldName}")}}`;
}

const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
const parseModule = blueprint.flow.find((module) => module.id === 19);
const feederModule = blueprint.flow.find((module) => module.id === 20);
const sheetsModule = blueprint.flow.find((module) => module.id === 21);

if (!parseModule || !feederModule || !sheetsModule) {
  throw new Error("Modules 19, 20, and 21 are required.");
}

parseModule.parameters = {};
parseModule.metadata.interface = [
  {
    name: "items",
    type: "array",
    label: "items",
    spec: FIELD_NAMES.map((name) => ({
      name,
      type:
        name.endsWith("_score") || name === "rank" || name === "composite"
          ? "number"
          : "text",
      label: name,
    })),
  },
];

feederModule.mapper.array = "{{19.items}}";

const values = {};
for (const fieldName of FIELD_NAMES) {
  values[fieldName] = rowValue(fieldName);
}

sheetsModule.mapper = {
  ...sheetsModule.mapper,
  values,
  includesHeaders: true,
  useColumnHeaders: true,
  insertDataOption: "INSERT_ROWS",
  valueInputOption: "USER_ENTERED",
};

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");

console.log("Applied header-based map/get Google Sheets mapping.");
console.log("Example:", values.rank);
