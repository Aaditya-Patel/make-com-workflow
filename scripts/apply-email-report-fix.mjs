import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const blueprintPath = join(rootDir, "Integration RSS.blueprint.json");
const projectPath = join(rootDir, "make.project.json");

const ITERATOR_ID = 20;
const SHEETS_ID = 21;
const PARSE_ID = 19;
const RUN_AT_ID = 14;
const LEGACY_EMAIL_MODULE_ID = 64;

function loadProject() {
  return JSON.parse(readFileSync(projectPath, "utf8"));
}

function requireEmailConfig(project) {
  const email = project.emailReport;
  if (!email?.enabled) {
    console.log("emailReport.enabled is false — skipping email report modules.");
    return null;
  }
  if (!email.connectionId) {
    throw new Error(
      "emailReport.connectionId is missing in make.project.json.\n" +
        "Create a Gmail connection in Make for stackinfraworkflow@gmail.com,\n" +
        "then set emailReport.connectionId to that connection ID.\n" +
        "Run: npm run connections"
    );
  }
  if (!email.to) {
    throw new Error("emailReport.to is required in make.project.json");
  }
  return email;
}

function emailModuleIds(email) {
  return {
    bodyAggregator: email.moduleIds?.bodyAggregator ?? 22,
    sendEmail: email.moduleIds?.sendEmail ?? 8062,
  };
}

function isEmailModule(module, ids) {
  return (
    module.id === ids.bodyAggregator ||
    module.id === ids.sendEmail ||
    module.id === LEGACY_EMAIL_MODULE_ID ||
    module.module === "google-email:sendAnEmail" ||
    module.module === "google-email:ActionSendEmail"
  );
}

function createEmailBodyAggregator(ids, designerY) {
  const productCard = [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border:1px solid #dbe3ec;border-radius:10px;background:#ffffff;">',
    '<tr><td style="padding:18px 20px;background:#f4f7fb;border-bottom:1px solid #dbe3ec;">',
    '<span style="display:inline-block;margin-right:10px;padding:4px 10px;border-radius:14px;background:#17324d;color:#ffffff;font-size:12px;font-weight:700;">#{{20.rank}}</span>',
    '<span style="font-size:19px;font-weight:700;color:#17324d;">{{20.product}}</span>',
    "</td></tr>",
    '<tr><td style="padding:16px 20px;">',
    '<p style="margin:0 0 12px;color:#526477;font-size:13px;"><strong style="color:#17324d;">Category:</strong> {{20.category}}</p>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr>',
    '<td width="25%" style="padding:10px 4px;text-align:center;background:#e8f1ff;border-right:4px solid #ffffff;"><div style="font-size:20px;font-weight:700;color:#1559a6;">{{20.composite}}</div><div style="font-size:11px;color:#526477;">COMPOSITE</div></td>',
    '<td width="25%" style="padding:10px 4px;text-align:center;background:#edf8f2;border-right:4px solid #ffffff;"><div style="font-size:20px;font-weight:700;color:#147a49;">{{20.adoption_score}}/10</div><div style="font-size:11px;color:#526477;">ADOPTION</div></td>',
    '<td width="25%" style="padding:10px 4px;text-align:center;background:#fff5e5;border-right:4px solid #ffffff;"><div style="font-size:20px;font-weight:700;color:#9a5a00;">{{20.roi_score}}/10</div><div style="font-size:11px;color:#526477;">ROI</div></td>',
    '<td width="25%" style="padding:10px 4px;text-align:center;background:#f4edff;"><div style="font-size:20px;font-weight:700;color:#6842a6;">{{20.recency_score}}/10</div><div style="font-size:11px;color:#526477;">RECENCY</div></td>',
    "</tr></table>",
    '<p style="margin:0 0 8px;color:#17324d;font-size:14px;font-weight:700;">Why it scored this way</p>',
    '<p style="margin:0 0 6px;color:#34495e;font-size:13px;line-height:1.55;"><strong>Adoption:</strong> {{20.adoption_note}}</p>',
    '<p style="margin:0 0 6px;color:#34495e;font-size:13px;line-height:1.55;"><strong>ROI:</strong> {{20.roi_note}}</p>',
    '<p style="margin:0 0 14px;color:#34495e;font-size:13px;line-height:1.55;"><strong>Recency:</strong> {{20.recency_note}}</p>',
    '<p style="margin:0 0 5px;color:#17324d;font-size:14px;font-weight:700;">Key evidence</p>',
    '<p style="margin:0 0 14px;color:#34495e;font-size:13px;line-height:1.55;">{{20.key_evidence}}</p>',
    '<p style="margin:0 0 7px;color:#34495e;font-size:13px;line-height:1.5;"><strong style="color:#17324d;">Named contractors:</strong> {{20.named_contractors}}</p>',
    '<p style="margin:0 0 7px;color:#34495e;font-size:13px;line-height:1.5;"><strong style="color:#17324d;">Source:</strong> {{20.source}}</p>',
    '<p style="margin:0 0 7px;color:#34495e;font-size:13px;line-height:1.5;"><strong style="color:#17324d;">Source credibility:</strong> {{20.source_credibility}}</p>',
    '<p style="margin:0;color:#60758a;font-size:12px;line-height:1.5;"><strong>Citation:</strong> {{20.feed_citation}}</p>',
    "</td></tr></table>",
  ].join("");

  return {
    id: ids.bodyAggregator,
    module: "util:TextAggregator",
    version: 1,
    mapper: {
      value: productCard,
    },
    parameters: {
      feeder: ITERATOR_ID,
      rowSeparator: "\n",
    },
    metadata: {
      designer: { x: 1500, y: designerY },
      restore: {
        extra: {
          feeder: {
            label: `Iterator [${ITERATOR_ID}]`,
          },
        },
        parameters: {
          rowSeparator: { label: "New row" },
        },
      },
      expect: [{ name: "value", type: "text", label: "Text" }],
      parameters: [
        {
          name: "rowSeparator",
          type: "select",
          label: "Row separator",
          validate: { enum: ["\n", "\t", "other"] },
        },
      ],
    },
  };
}

function createGmailSendModule(email, ids, designerY) {
  const sheetUrl =
    email.sheetUrl ??
    "https://docs.google.com/spreadsheets/d/1z__AJxtecScgpU6kYeirA9z3NPHtJzYwo3nmiepiWjg/edit";
  const subject =
    email.subject ?? "Integration RSS Trend Brief — {{14.RunAt}}";
  const content = [
    '<div style="margin:0;padding:0;background:#eef2f6;font-family:Arial,Helvetica,sans-serif;color:#24384b;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;"><tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#ffffff;border-radius:12px;overflow:hidden;">',
    '<tr><td style="padding:30px 34px;background:#17324d;color:#ffffff;">',
    '<div style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1.5px;color:#9fc5e8;">MONTHLY INTELLIGENCE REPORT</div>',
    '<div style="margin:0 0 8px;font-size:28px;font-weight:700;line-height:1.2;">Integration RSS Trend Brief</div>',
    '<div style="font-size:14px;color:#d4e2ee;">AI products and solutions for data center construction</div>',
    "</td></tr>",
    '<tr><td style="padding:24px 34px;border-bottom:1px solid #dbe3ec;">',
    '<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#34495e;">This newsletter contains every ranked product and all available details written to the spreadsheet during the latest workflow run.</p>',
    '<p style="margin:0 0 18px;font-size:13px;color:#60758a;"><strong>Run completed:</strong> {{14.RunAt}}</p>',
    `<a href="${sheetUrl}" style="display:inline-block;padding:11px 18px;border-radius:6px;background:#1677c8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Open complete spreadsheet</a>`,
    "</td></tr>",
    '<tr><td style="padding:26px 34px 8px;">',
    '<div style="margin:0 0 18px;font-size:21px;font-weight:700;color:#17324d;">Ranked products</div>',
    "{{" + ids.bodyAggregator + ".text}}",
    "</td></tr>",
    '<tr><td style="padding:20px 34px;background:#f4f7fb;border-top:1px solid #dbe3ec;text-align:center;">',
    '<p style="margin:0 0 5px;font-size:12px;color:#60758a;">Generated automatically by the Integration RSS Make.com scenario.</p>',
    `<p style="margin:0;font-size:12px;"><a href="${sheetUrl}" style="color:#1677c8;text-decoration:none;">View report in Google Sheets</a></p>`,
    "</td></tr></table>",
    "</td></tr></table></div>",
  ].join("");

  return {
    id: ids.sendEmail,
    module: "google-email:sendAnEmail",
    version: 4,
    parameters: {
      __IMTCONN__: Number(email.connectionId),
    },
    mapper: {
      to: [String(email.to)],
      subject,
      bodyType: "rawHtml",
      content,
    },
    metadata: {
      designer: { x: 1800, y: designerY },
      parameters: [
        {
          name: "__IMTCONN__",
          type: "account:google-email",
          label: "Connection",
          required: true,
        },
      ],
      expect: [
        {
          name: "to",
          type: "array",
          label: "To",
          spec: {
            name: "value",
            type: "email",
            label: "Recipient email address",
            required: true,
            validate: true,
          },
          required: true,
        },
        {
          name: "subject",
          type: "text",
          label: "Subject",
        },
        {
          name: "bodyType",
          type: "select",
          label: "Body type",
          required: true,
          validate: { enum: ["rawHtml", "collection"] },
        },
        {
          name: "content",
          type: "text",
          label: "Content",
        },
      ],
      restore: {
        expect: {
          bodyType: { label: "Raw HTML" },
        },
        parameters: {
          __IMTCONN__: {
            data: {
              scoped: "true",
              connection: "google-email",
            },
            label: email.connectionLabel ?? "My Gmail connection",
          },
        },
      },
    },
  };
}

const project = loadProject();
const email = requireEmailConfig(project);
const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
const ids = emailModuleIds(email ?? {});

blueprint.flow = blueprint.flow.filter((module) => !isEmailModule(module, ids));

if (!email) {
  writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");
  process.exit(0);
}

const iterator = blueprint.flow.find((module) => module.id === ITERATOR_ID);
const sheets = blueprint.flow.find((module) => module.id === SHEETS_ID);
const parse = blueprint.flow.find((module) => module.id === PARSE_ID);
const runAt = blueprint.flow.find((module) => module.id === RUN_AT_ID);

if (!iterator || !sheets || !parse || !runAt) {
  throw new Error("Modules 14, 19, 20, and 21 are required for the email report.");
}

const designerY = sheets.metadata?.designer?.y ?? 1000;
const emailAgg = createEmailBodyAggregator(ids, designerY);
const gmailSend = createGmailSendModule(email, ids, designerY);

const sheetsIndex = blueprint.flow.findIndex((module) => module.id === SHEETS_ID);
if (sheetsIndex < 0) {
  throw new Error("Google Sheets module 21 not found in flow.");
}

blueprint.flow.splice(sheetsIndex + 1, 0, emailAgg, gmailSend);

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");

console.log("Applied email report modules:");
console.log(`  Text Aggregator ${ids.bodyAggregator} (feeder=${ITERATOR_ID})`);
console.log(`  Gmail Send Email ${ids.sendEmail}`);
console.log(`  To: ${email.to}`);
console.log(`  From account: ${email.from ?? "(connection default)"}`);
console.log(`  Connection ID: ${email.connectionId}`);
console.log(
  `  flow order: ${blueprint.flow.map((module) => module.id).join(", ")}`
);
