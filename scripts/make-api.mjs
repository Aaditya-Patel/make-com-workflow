import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import "./load-env.mjs";

export function loadMakeCredentials() {
  if (process.env.MAKE_API_KEY && process.env.MAKE_ZONE) {
    return {
      apiKey: process.env.MAKE_API_KEY,
      zone: process.env.MAKE_ZONE,
    };
  }

  const configFile =
    process.platform === "win32"
      ? join(process.env.APPDATA, "make-cli", "config.json")
      : join(homedir(), ".config", "make-cli", "config.json");

  if (!existsSync(configFile)) {
    throw new Error(
      "Make CLI is not authenticated. Run: make-cli login"
    );
  }

  const saved = JSON.parse(readFileSync(configFile, "utf8"));
  if (!saved.apiKey || !saved.zone) {
    throw new Error("Invalid make-cli config. Run: make-cli login");
  }

  return { apiKey: saved.apiKey, zone: saved.zone };
}

export async function makeApiRequest(path, { method = "GET", body, searchParams } = {}) {
  const { apiKey, zone } = loadMakeCredentials();
  const url = new URL(`https://${zone}/api/v2${path}`);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Token ${apiKey}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null
        ? JSON.stringify(payload, null, 2)
        : String(payload);
    throw new Error(`Make API ${method} ${path} failed (${response.status}):\n${detail}`);
  }

  if (payload?.code === "OK" && payload.response !== undefined) {
    return payload.response;
  }

  return payload;
}

export async function createScenario({ teamId, scheduling, blueprint, confirmed = true }) {
  return makeApiRequest("/scenarios", {
    method: "POST",
    searchParams: { confirmed: confirmed ? "true" : undefined },
    body: {
      teamId,
      scheduling: JSON.stringify(scheduling),
      blueprint: JSON.stringify(blueprint),
    },
  });
}

export async function updateScenarioBlueprint({
  scenarioId,
  blueprint,
  scheduling,
  name,
  confirmed = true,
}) {
  const body = {
    blueprint: JSON.stringify(blueprint),
  };

  if (scheduling) {
    body.scheduling = JSON.stringify(scheduling);
  }
  if (name) {
    body.name = name;
  }

  return makeApiRequest(`/scenarios/${scenarioId}`, {
    method: "PATCH",
    searchParams: { confirmed: confirmed ? "true" : undefined },
    body,
  });
}

export async function getScenarioBlueprint(scenarioId) {
  const response = await makeApiRequest(`/scenarios/${scenarioId}/blueprint`);
  return response.blueprint ?? response;
}

export async function getScenario(scenarioId) {
  return makeApiRequest(`/scenarios/${scenarioId}`);
}

export async function startScenario(scenarioId) {
  return makeApiRequest(`/scenarios/${scenarioId}/start`, { method: "POST" });
}
