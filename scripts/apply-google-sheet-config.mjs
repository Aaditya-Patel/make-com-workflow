import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env.mjs";
import { makeApiRequest } from "./make-api.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const blueprintPath = join(rootDir, "Integration RSS.blueprint.json");
const projectPath = join(rootDir, "make.project.json");

const DEFAULTS = {
  spreadsheetName: "Integration RSS - Trend Brief",
  sheetTab: "Sheet1",
  connectionId: 9717356,
  moduleId: 21,
};

function loadProjectConfig() {
  return JSON.parse(readFileSync(projectPath, "utf8"));
}

function getGoogleSheetsConfig(project) {
  const config = project.googleSheets ?? {};
  return {
    spreadsheetName:
      process.env.GOOGLE_SPREADSHEET_NAME ?? config.spreadsheetName ?? DEFAULTS.spreadsheetName,
    spreadsheetId:
      process.env.GOOGLE_SPREADSHEET_ID ?? config.spreadsheetId ?? null,
    sheetTab: process.env.GOOGLE_SHEET_TAB ?? config.sheetTab ?? DEFAULTS.sheetTab,
    connectionId: Number(
      process.env.GOOGLE_CONNECTION_ID ?? config.connectionId ?? DEFAULTS.connectionId
    ),
    moduleId: Number(config.moduleId ?? DEFAULTS.moduleId),
  };
}

async function resolveSpreadsheetId({ connectionId, spreadsheetName, spreadsheetId }) {
  if (spreadsheetId) {
    return spreadsheetId.replace(/^\//, "");
  }

  const response = await makeApiRequest("/rpcs/google-sheets/2/listSpreadsheets", {
    method: "POST",
    body: {
      data: {
        __IMTCONN__: connectionId,
        from: "drive",
      },
    },
  });

  const matches = (response ?? []).filter(
    (item) => item.label === spreadsheetName || item.label?.includes(spreadsheetName)
  );

  if (matches.length === 1) {
    return matches[0].value;
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple spreadsheets match "${spreadsheetName}". Set GOOGLE_SPREADSHEET_ID in .env.`
    );
  }

  const available = (response ?? []).map((item) => item.label).join(", ") || "(none)";
  throw new Error(
    `Spreadsheet "${spreadsheetName}" not found in Google Drive for connection ${connectionId}.\n` +
      `Available spreadsheets: ${available}`
  );
}

const project = loadProjectConfig();
const config = getGoogleSheetsConfig(project);
const spreadsheetId = await resolveSpreadsheetId(config);

const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
const sheetsModule =
  blueprint.flow.find((module) => module.id === config.moduleId) ??
  blueprint.flow.find((module) => module.module === "google-sheets:addRow");

if (!sheetsModule) {
  throw new Error(
    `Google Sheets module (id ${config.moduleId} or google-sheets:addRow) not found in blueprint.`
  );
}

config.moduleId = sheetsModule.id;

sheetsModule.parameters = {
  ...sheetsModule.parameters,
  __IMTCONN__: config.connectionId,
};

sheetsModule.mapper = {
  ...sheetsModule.mapper,
  sheetId: config.sheetTab,
  spreadsheetId: `/${spreadsheetId}`,
};

sheetsModule.metadata ??= {};
sheetsModule.metadata.restore ??= {};
sheetsModule.metadata.restore.expect ??= {};
sheetsModule.metadata.restore.expect.sheetId = { label: config.sheetTab };
sheetsModule.metadata.restore.expect.spreadsheetId = {
  path: [config.spreadsheetName],
};

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");

project.googleSheets = {
  ...project.googleSheets,
  spreadsheetName: config.spreadsheetName,
  spreadsheetId,
  sheetTab: config.sheetTab,
  connectionId: config.connectionId,
  moduleId: config.moduleId,
};
writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");

console.log(`Applied Google Sheets config to module ${sheetsModule.id}:`);
console.log(`  Spreadsheet: ${config.spreadsheetName}`);
console.log(`  Spreadsheet ID: ${spreadsheetId}`);
console.log(`  Sheet tab: ${config.sheetTab}`);
console.log(`  Connection: ${config.connectionId}`);
