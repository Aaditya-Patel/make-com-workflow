import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(rootDir, ".env");

const ZONES = [
  "eu1.make.com",
  "eu2.make.com",
  "us1.make.com",
  "us2.make.com",
];

async function probeZone(apiKey, zone) {
  const response = await fetch(`https://${zone}/api/v2/users/me`, {
    headers: {
      Accept: "application/json",
      Authorization: `Token ${apiKey}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  if (payload.code && payload.code !== "OK") {
    return null;
  }

  return payload.authUser ?? payload.user ?? payload;
}

function configPath() {
  return process.platform === "win32"
    ? join(process.env.APPDATA, "make-cli", "config.json")
    : join(homedir(), ".config", "make-cli", "config.json");
}

function updateEnvZone(zone) {
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  let zoneUpdated = false;

  const updated = lines.map((line) => {
    if (/^\s*#?\s*MAKE_ZONE\s*=/.test(line)) {
      zoneUpdated = true;
      return `MAKE_ZONE=${zone}`;
    }
    return line;
  });

  if (!zoneUpdated) {
    updated.push(`MAKE_ZONE=${zone}`);
  }

  writeFileSync(envPath, `${updated.join("\n").replace(/\n?$/, "\n")}`, "utf8");
  process.env.MAKE_ZONE = zone;
}

async function main() {
  const apiKey = process.env.MAKE_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "Missing MAKE_API_KEY in .env\n\n" +
        "Add this line to .env:\n" +
        "MAKE_API_KEY=your-api-key-here"
    );
    process.exit(1);
  }

  let zone = process.env.MAKE_ZONE?.trim();
  let user;

  if (zone) {
    user = await probeZone(apiKey, zone);
    if (!user) {
      console.error(`MAKE_ZONE=${zone} did not accept your API key.`);
      process.exit(1);
    }
  } else {
    console.log("MAKE_ZONE not set. Detecting your Make zone...");
    for (const candidate of ZONES) {
      user = await probeZone(apiKey, candidate);
      if (user) {
        zone = candidate;
        break;
      }
    }

    if (!zone || !user) {
      console.error(
        "Could not detect zone automatically. Add MAKE_ZONE to .env, for example:\n" +
          "MAKE_ZONE=us1.make.com"
      );
      process.exit(1);
    }
  }

  updateEnvZone(zone);

  const file = configPath();
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ zone, apiKey }, null, 2)}\n`,
    "utf8"
  );

  const name = user?.name ?? "unknown";
  const email = user?.email ?? "unknown";
  console.log(`Authenticated as ${name} (${email})`);
  console.log(`Zone: ${zone}`);
  console.log(`Saved credentials to ${file}`);
  console.log("\nNext: npm run sync-account");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
