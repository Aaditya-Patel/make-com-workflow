import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const blueprintPath = join(rootDir, "Integration RSS.blueprint.json");
const projectPath = join(rootDir, "make.project.json");

const DATASTORE_MODULE_ID = 9;

const project = JSON.parse(readFileSync(projectPath, "utf8"));
const dataStoreId = project.secrets?.dataStoreId;

if (!dataStoreId) {
  throw new Error("secrets.dataStoreId is required in make.project.json");
}

const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
const module = blueprint.flow.find((m) => m.id === DATASTORE_MODULE_ID);

if (!module) {
  throw new Error(`Datastore GetRecord module ${DATASTORE_MODULE_ID} not found.`);
}

module.parameters = module.parameters ?? {};
module.parameters.datastore = Number(dataStoreId);

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");

console.log(`Applied data store config to module ${DATASTORE_MODULE_ID}:`);
console.log(`  Data store ID: ${dataStoreId}`);
