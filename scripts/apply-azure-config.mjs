import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const blueprintPath = join(rootDir, "Integration RSS.blueprint.json");
const projectPath = join(rootDir, "make.project.json");

function loadProjectConfig() {
  return JSON.parse(readFileSync(projectPath, "utf8"));
}

function normalizeEndpoint(endpoint) {
  return endpoint.replace(/\/+$/, "");
}

function getAzureConfig() {
  const project = loadProjectConfig();
  const endpoint = normalizeEndpoint(
    process.env.AZURE_OPENAI_ENDPOINT ??
      project.azureOpenAI?.endpoint ??
      "https://make-com.openai.azure.com"
  );
  const deployment =
    process.env.AZURE_OPENAI_DEPLOYMENT ?? project.azureOpenAI?.deployment;
  const apiVersion =
    process.env.AZURE_OPENAI_API_VERSION ??
    project.azureOpenAI?.apiVersion ??
    "2024-10-21";

  if (!deployment) {
    throw new Error(
      "Missing AZURE_OPENAI_DEPLOYMENT in .env.\n" +
        "Set it to your Azure deployment name from:\n" +
        "Azure Portal -> Azure OpenAI -> Deployments"
    );
  }

  return { endpoint, deployment, apiVersion };
}

function buildAzureUrl({ endpoint, deployment, apiVersion }) {
  return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
}

// gpt-5-mini is a reasoning model: reasoning tokens are drawn from
// max_completion_tokens. A small budget (e.g. 2000) is fully consumed by
// reasoning and returns EMPTY content (finish_reason=length), which breaks the
// downstream parse/iterator/sheet chain. Give the model enough room.
const MIN_COMPLETION_TOKENS = 16000;

function normalizeRequestBody(jsonBody) {
  let body = jsonBody
    .replace(/"model":\s*"[^"]*",\r?\n\s*/g, "")
    .replace(/"model":\s*"[^"]*",\s*/g, "")
    .replace(/"max_tokens"/g, '"max_completion_tokens"');

  if (/"max_completion_tokens":\s*\d+/.test(body)) {
    body = body.replace(
      /"max_completion_tokens":\s*(\d+)/,
      (match, n) =>
        `"max_completion_tokens":${Math.max(Number(n), MIN_COMPLETION_TOKENS)}`
    );
  } else {
    body = body.replace(
      /^\{/,
      `{"max_completion_tokens":${MIN_COMPLETION_TOKENS},`
    );
  }

  if (!body.includes('"response_format"')) {
    body = body.replace(
      /"max_completion_tokens":\s*\d+,?/,
      (match) =>
        `${match.replace(/,?$/, ",")}\r\n  "response_format": { "type": "json_object" },`
    );
  }

  return body;
}

function applyAzureToHttpModule(httpModule, azure) {
  httpModule.mapper.url = buildAzureUrl(azure);
  httpModule.mapper.headers = [
    {
      name: "api-key",
      value: "{{9.value}}",
    },
    {
      name: "content-type",
      value: "application/json",
    },
  ];

  if (httpModule.mapper.jsonStringBodyContent) {
    httpModule.mapper.jsonStringBodyContent = normalizeRequestBody(
      httpModule.mapper.jsonStringBodyContent
    );
  }
}

const azure = getAzureConfig();
const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
const httpModules = blueprint.flow.filter(
  (module) => module.module === "http:MakeRequest"
);

if (httpModules.length === 0) {
  throw new Error("No http:MakeRequest modules found in blueprint.");
}

for (const httpModule of httpModules) {
  applyAzureToHttpModule(httpModule, azure);
}

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");

console.log(
  `Applied Azure OpenAI config to ${httpModules.length} HTTP module(s): ${httpModules
    .map((module) => module.id)
    .join(", ")}`
);
console.log(`  Endpoint:   ${azure.endpoint}`);
console.log(`  Deployment: ${azure.deployment}`);
console.log(`  API version: ${azure.apiVersion}`);
