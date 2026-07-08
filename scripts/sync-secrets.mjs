import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env.mjs";
import { makeApiRequest } from "./make-api.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = join(rootDir, "make.project.json");

function loadProjectConfig() {
  return JSON.parse(readFileSync(projectPath, "utf8"));
}

async function ensureDataStructure(teamId, structureId, structureName) {
  if (structureId) {
    return structureId;
  }

  const created = await makeApiRequest("/data-structures", {
    method: "POST",
    body: {
      teamId,
      name: structureName,
      strict: false,
      spec: [
        {
          name: "value",
          type: "text",
          label: "value",
          required: true,
        },
      ],
    },
  });

  return created.dataStructure?.id ?? created.id;
}

async function ensureDatastoreStructure(dataStoreId, dataStructureId) {
  const store = await makeApiRequest(`/data-stores/${dataStoreId}`);
  const currentId = store.dataStore?.datastructureId ?? store.datastructureId;

  if (currentId === dataStructureId) {
    return;
  }

  await makeApiRequest(`/data-stores/${dataStoreId}`, {
    method: "PATCH",
    body: { datastructureId: dataStructureId },
  });
}

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  throw new Error(
    "Missing OPENAI_API_KEY in .env (use your Azure OpenAI API key)."
  );
}

const project = loadProjectConfig();
const {
  dataStoreId = 113753,
  dataStoreKey = "x-api-key",
  dataStructureId = null,
  dataStructureName = "API Key Store",
} = project.secrets ?? {};

const structureId = await ensureDataStructure(
  project.teamId,
  dataStructureId,
  dataStructureName
);
await ensureDatastoreStructure(dataStoreId, structureId);

try {
  await makeApiRequest(`/data-stores/${dataStoreId}/data`, {
    method: "DELETE",
    body: { keys: [dataStoreKey] },
  });
} catch {
  // Record may not exist yet.
}

await makeApiRequest(`/data-stores/${dataStoreId}/data`, {
  method: "POST",
  body: {
    key: dataStoreKey,
    data: { value: apiKey },
  },
});

console.log(
  `Synced ${dataStoreKey} to data store ${dataStoreId} from .env (OPENAI_API_KEY).`
);
