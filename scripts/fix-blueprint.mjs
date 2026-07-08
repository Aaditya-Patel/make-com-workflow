import { readFileSync, writeFileSync } from "node:fs";

const path = "Integration RSS.blueprint.json";
const text = readFileSync(path, "utf8");
const zoneMarker = '        "zone": "us2.make.com"';
const orphansEnd = text.indexOf('"orphans": []');

if (orphansEnd === -1) {
  throw new Error("Could not find orphans marker");
}

const designerClose = text.indexOf("},", orphansEnd);
const zoneStart = text.indexOf(zoneMarker);

if (designerClose === -1 || zoneStart === -1) {
  throw new Error("Could not find designer close or zone marker");
}

const fixed = `${text.slice(0, designerClose + 2)}\n${text.slice(zoneStart)}`;
JSON.parse(fixed);
writeFileSync(path, fixed, "utf8");
console.log("Blueprint JSON repaired.");
