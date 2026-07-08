import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const blueprintPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "Integration RSS.blueprint.json"
);

const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
const httpModule = blueprint.flow.find((module) => module.id === 8);
const feederModule = blueprint.flow.find((module) => module.id === 20);

if (!httpModule || !feederModule) {
  throw new Error("Modules 8 and 20 are required.");
}

const body = JSON.parse(httpModule.mapper.jsonStringBodyContent);
let prompt = body.messages[0].content;

prompt = prompt
  .replace(/"value"\s*:\s*\[/g, '"items": [')
  .replace(/Include up to 10 items in value\[\]\./g, "Include up to 10 items in items[].");

body.messages[0].content = prompt;
httpModule.mapper.jsonStringBodyContent = JSON.stringify(body);
feederModule.mapper.array = "{{19.items}}";

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");
console.log("Renamed LLM JSON root array from value[] to items[].");
console.log("Iterator now uses {{19.items}}.");
