import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const blueprintPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "Integration RSS.blueprint.json"
);

const prompt = `You are an AI intelligence analyst for a Head of AI at a data center construction company. You have been given a batch of recent articles from industry RSS feeds covering construction and data center technology news.

ARTICLE BATCH:
{{escapeJSON(7.text)}}

YOUR TASK:
Analyze all articles above and identify the Top 10 AI products, solutions, or services currently being adopted by data center construction companies or real estate construction companies working on data center builds.

SCORING — rank each product on three dimensions, each out of 10:
- ADOPTION (1-10): How many named major contractors or owners are using it?
- ROI (1-10): How documented is the business outcome? Specific numbers score higher.
- RECENCY (1-10): How recent is the deployment or announcement?

RULES:
- Only include products directly used in construction delivery: scheduling, site monitoring, safety, document AI, estimating, BIM, field operations.
- Do not include data center operations tools used post-construction.
- Flag all vendor-published figures clearly.
- Do not fabricate deployments. If an article does not confirm a named deployment, do not include it.
- Plain English throughout. No jargon. No superlatives.
- If fewer than 10 products are found in the article batch, return only what you find.

OUTPUT FORMAT (mandatory):
Return ONLY one valid JSON object. No markdown, no text before or after.
Use this exact schema:
{
  "items": [
    {
      "rank": 1,
      "product": "Product name and company",
      "category": "Schedule & planning | Site intelligence | Safety AI | Document & contract AI | Platform PM | Estimating",
      "adoption_score": 8,
      "adoption_note": "one sentence",
      "roi_score": 7,
      "roi_note": "one sentence with specific outcome",
      "recency_score": 9,
      "recency_note": "one sentence with date",
      "composite": 24,
      "key_evidence": "2-3 sentences",
      "named_contractors": "comma-separated list",
      "source": "publication, URL, date",
      "source_credibility": "Independently reported | Vendor-published only"
    }
  ]
}
Include up to 10 items in items[].`;

const requestBody = {
  max_completion_tokens: 2000,
  response_format: { type: "json_object" },
  messages: [{ role: "user", content: prompt }],
};

const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
const httpModule = blueprint.flow.find((module) => module.id === 8);
const cleanJsonModule = blueprint.flow.find((module) => module.id === 18);
const feederModule = blueprint.flow.find((module) => module.id === 20);

if (!httpModule || !cleanJsonModule || !feederModule) {
  throw new Error("Modules 8, 18, and 20 are required.");
}

httpModule.mapper.jsonStringBodyContent = JSON.stringify(requestBody);
cleanJsonModule.mapper.value =
  '{{replace(replace(8.data.choices[].message.content; "```json"; ); "```"; )}}';
feederModule.mapper.array = "{{19.items}}";

writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 4)}\n`, "utf8");
console.log("Applied Option A: JSON prompt, response_format, and cleanJSON fix.");
