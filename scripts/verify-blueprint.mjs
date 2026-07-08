import { readFileSync } from "node:fs";

const bp = JSON.parse(readFileSync("Integration RSS.blueprint.json", "utf8"));
const content = JSON.parse(
  bp.flow.find((module) => module.id === 8).mapper.jsonStringBodyContent
).messages[0].content;

console.log("items schema:", content.includes('"items": ['));
console.log("value schema:", content.includes('"value": ['));
console.log("feeder:", bp.flow.find((module) => module.id === 20).mapper.array);
console.log("rank mapping:", bp.flow.find((module) => module.id === 21).mapper.values["0"]);
