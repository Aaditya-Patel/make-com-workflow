import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const blueprintPath = join(rootDir, "Integration RSS.blueprint.json");
const connectionId = Number(process.argv[2] || 9717325);

const columnLabels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const googleSheetsModule = {
  id: 21,
  module: "google-sheets:addRow",
  version: 2,
  parameters: {
    __IMTCONN__: connectionId,
  },
  mapper: {
    from: "drive",
    mode: "select",
    values: {},
    sheetId: "Sheet1",
    spreadsheetId: "/1SjTS3xBQLO18BrUSHz3pQNU5DnDcDVd0OX3IbtqcySo",
    includesHeaders: true,
    insertDataOption: "INSERT_ROWS",
    useColumnHeaders: false,
    valueInputOption: "USER_ENTERED",
    insertUnformatted: false,
  },
  metadata: {
    designer: {
      x: 2700,
      y: 0,
    },
    restore: {
      expect: {
        from: { label: "My Drive" },
        mode: { label: "Search by path" },
        sheetId: { label: "Sheet1" },
        spreadsheetId: {
          path: ["Make.com Integration RSS Feed - Trend Brief"],
        },
        includesHeaders: { label: "Yes" },
        insertDataOption: { mode: "chose", label: "Insert rows" },
        useColumnHeaders: {
          label: "No",
          nested: [
            {
              name: "values",
              spec: columnLabels.map((label, index) => ({
                name: String(index),
                type: "text",
                label,
              })),
            },
          ],
        },
      },
      parameters: {
        __IMTCONN__: {
          data: {
            scoped: "true",
            connection: "google",
          },
          label: "Google Sheets",
        },
      },
    },
    parameters: [
      {
        name: "__IMTCONN__",
        type: "account",
        label: "Connection",
        required: true,
      },
    ],
    expect: [
      {
        name: "from",
        type: "select",
        label: "Drive",
        required: true,
        validate: {
          enum: ["drive", "share"],
        },
      },
      {
        name: "mode",
        type: "select",
        label: "Search Method",
        required: true,
      },
      {
        name: "spreadsheetId",
        type: "file",
        label: "Spreadsheet ID",
        required: true,
      },
      {
        name: "sheetId",
        type: "select",
        label: "Sheet Name",
        required: true,
      },
      {
        name: "includesHeaders",
        type: "boolean",
        label: "Table contains headers",
        required: true,
      },
      {
        name: "values",
        type: "collection",
        label: "Values in columns",
        spec: columnLabels.map((label, index) => ({
          name: String(index),
          type: "text",
          label,
        })),
      },
    ],
  },
};

const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
const feederIndex = blueprint.flow.findIndex((module) => module.id === 20);

if (feederIndex === -1) {
  throw new Error("Iterator module (id 20) not found in blueprint flow.");
}

if (blueprint.flow.some((module) => module.id === 21)) {
  throw new Error("Google Sheets module (id 21) already exists.");
}

blueprint.flow.splice(feederIndex + 1, 0, googleSheetsModule);
writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");
console.log(`Restored Google Sheets module with connection ${connectionId}.`);
