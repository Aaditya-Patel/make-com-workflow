import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env.mjs";
import {
  createScenario,
  getScenario,
  getScenarioBlueprint,
  startScenario,
  updateScenarioBlueprint,
} from "./make-api.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(rootDir, "make.project.json");
const makeCli = "make-cli";

function loadConfig() {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function saveConfig(config) {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function runNodeScript(scriptName) {
  const scriptPath = join(rootDir, "scripts", scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runMakeCli(args) {
  const result = spawnSync(makeCli, args, {
    cwd: rootDir,
    encoding: "utf8",
    shell: true,
    env: process.env,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    process.exit(result.status ?? 1);
  }

  return result.stdout;
}

function requireTeamId(config) {
  if (!config.teamId) {
    console.error(
      "No teamId in make.project.json.\n" +
        "Run: make-cli login\n" +
        "Then: npm run sync-account"
    );
    process.exit(1);
  }
  return config.teamId;
}
function requireScenarioId(config) {
  if (!config.scenarioId) {
    console.error(
      "No scenarioId in make.project.json.\n" +
        "Create one with: npm run create\n" +
        "Or set scenarioId after importing the scenario in Make."
    );
    process.exit(1);
  }
  return config.scenarioId;
}

function readBlueprintObject(config) {
  const blueprintFile = join(rootDir, config.blueprintPath);
  return JSON.parse(readFileSync(blueprintFile, "utf8"));
}

function scenarioUrl(config, scenarioId) {
  return `https://${config.zone}/scenarios/${scenarioId}/edit`;
}

const command = process.argv[2];
const config = loadConfig();

try {
  switch (command) {
    case "sync-account": {
      const whoami = JSON.parse(runMakeCli(["whoami"]));
      const orgs = JSON.parse(runMakeCli(["organizations", "list"]));
      if (!orgs.length) {
        throw new Error("No organizations found for this account.");
      }
      const org = orgs[0];
      const team = org.teams?.[0];
      if (!team) {
        throw new Error("No teams found in your organization.");
      }

      config.zone = whoami.zone;
      config.organizationId = org.id;
      config.teamId = team.id;
      config.scenarioId = null;
      saveConfig(config);

      console.log(`Signed in as ${whoami.name} (${whoami.email})`);
      console.log(`Zone: ${config.zone}`);
      console.log(`Organization: ${org.name} (${config.organizationId})`);
      console.log(`Team: ${team.name} (${config.teamId})`);
      console.log("Updated make.project.json");
      break;
    }

    case "status": {
      console.log(runMakeCli(["whoami"]));
      console.log("Project config:");
      console.log(JSON.stringify(config, null, 2));
      console.log("\nScenarios in team:");
      const teamId = requireTeamId(config);
      console.log(
        runMakeCli([
          "scenarios",
          "list",
          `--team-id=${teamId}`,
          "--output=table",
        ])
      );
      break;
    }

    case "open": {
      const scenarioId = requireScenarioId(config);
      console.log(scenarioUrl(config, scenarioId));
      break;
    }

    case "pull": {
      const scenarioId = requireScenarioId(config);
      const blueprint = await getScenarioBlueprint(scenarioId);
      const blueprintFile = join(rootDir, config.blueprintPath);
      writeFileSync(
        blueprintFile,
        `${JSON.stringify(blueprint, null, 4)}\n`,
        "utf8"
      );
      console.log(
        `Pulled blueprint from scenario ${scenarioId} -> ${config.blueprintPath}`
      );
      break;
    }

    case "push": {
      const scenarioId = requireScenarioId(config);
      runNodeScript("sync-secrets.mjs");
      runNodeScript("apply-batch-fix.mjs");
      runNodeScript("apply-azure-config.mjs");
      runNodeScript("apply-items-array-fix.mjs");
      runNodeScript("apply-bulk-sheets-fix.mjs");
      runNodeScript("apply-google-sheet-config.mjs");
      const blueprint = readBlueprintObject(config);
      await updateScenarioBlueprint({
        scenarioId,
        blueprint,
        scheduling: config.scheduling,
        name: config.scenarioName,
      });
      console.log(`Pushed ${config.blueprintPath} -> scenario ${scenarioId}`);
      console.log(`Edit in browser: ${scenarioUrl(config, scenarioId)}`);
      console.log("");
      console.log(
        "IMPORTANT: If this scenario is already open in the Make browser editor,"
      );
      console.log(
        "hard-refresh that tab (Ctrl+F5) before clicking Run once."
      );
      console.log(
        "The editor runs its in-memory draft, not the blueprint we just pushed."
      );
      break;
    }

    case "create": {
      if (config.scenarioId) {
        console.error(
          `scenarioId is already set (${config.scenarioId}). Use push to update it.`
        );
        process.exit(1);
      }

      const blueprint = readBlueprintObject(config);
      const created = await createScenario({
        teamId: config.teamId,
        scheduling: config.scheduling,
        blueprint,
      });
      const scenarioId =
        created.scenario?.id ?? created.id ?? created.scenarioId;

      if (!scenarioId) {
        console.log("Scenario created. Raw response:");
        console.log(JSON.stringify(created, null, 2));
        console.error(
          "Could not detect scenario id. Set scenarioId in make.project.json manually."
        );
        process.exit(1);
      }

      config.scenarioId = scenarioId;
      saveConfig(config);
      console.log(`Created scenario ${scenarioId} (${config.scenarioName})`);
      console.log("Saved scenarioId to make.project.json");
      console.log(`Edit in browser: ${scenarioUrl(config, scenarioId)}`);
      break;
    }

    case "activate": {
      const scenarioId = requireScenarioId(config);
      let started;
      try {
        started = await startScenario(scenarioId);
      } catch (error) {
        if (!/already running/i.test(error.message)) {
          throw error;
        }
        console.log(`Scenario ${scenarioId} is already active.`);
      }

      if (started) {
        const scenario = started.scenario ?? started;
        console.log(`Activated scenario ${scenarioId}`);
        if (scenario.isActive !== undefined) {
          console.log(`isActive: ${scenario.isActive}`);
        }
      }

      const details = await getScenario(scenarioId);
      const current = details.scenario ?? details;
      if (current.nextExec) {
        console.log(`nextExec: ${current.nextExec}`);
      }
      if (current.scheduling) {
        console.log(`scheduling: ${JSON.stringify(current.scheduling)}`);
      }
      console.log(
        "Note: Schedule time uses your Make organization timezone. Set org timezone to Asia/Kolkata for 09:00 IST."
      );
      break;
    }

    case "run": {
      const scenarioId = requireScenarioId(config);
      const dataArg = process.argv[3];
      const args = ["scenarios", "run", String(scenarioId), "--responsive"];
      if (dataArg) {
        args.push(`--data=${dataArg}`);
      }
      console.log(runMakeCli(args));
      break;
    }

    case "executions": {
      const scenarioId = requireScenarioId(config);
      console.log(
        runMakeCli([
          "executions",
          "list",
          `--scenario-id=${scenarioId}`,
          "--output=table",
        ])
      );
      break;
    }

    case "list-scenarios": {
      console.log(
        runMakeCli([
          "scenarios",
          "list",
          `--team-id=${requireTeamId(config)}`,
          "--output=table",
        ])
      );
      break;
    }

    case "list-connections": {
      console.log(
        runMakeCli([
          "connections",
          "list",
          `--team-id=${requireTeamId(config)}`,
          "--output=table",
        ])
      );
      break;
    }

    case "list-data-stores": {
      console.log(
        runMakeCli([
          "data-stores",
          "list",
          `--team-id=${requireTeamId(config)}`,
          "--output=table",
        ])
      );
      break;
    }

    default:
      console.error(
        "Usage: node scripts/make-project.mjs <status|sync-account|open|pull|push|run|create|executions|activate>"
      );
      process.exit(1);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
