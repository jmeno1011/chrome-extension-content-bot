import { aiOutputSchema, type AiOutput } from "../schema/ai-output.schema.js";

type ResponsesClient = {
  responses: {
    create(input: Record<string, unknown>): Promise<unknown>;
  };
};

export type GenerateExtensionDraftInput = {
  readme: string;
  contactEmail: string;
  client: ResponsesClient;
  model?: string;
};

export async function generateExtensionDraft(input: GenerateExtensionDraftInput): Promise<AiOutput> {
  const response = await input.client.responses.create({
    model: input.model ?? "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "Return JSON only. Generate Chrome Extensions Hub metadata from README content. Do not invent Chrome Web Store URLs or GitHub URLs. Use empty strings when URLs are missing.",
      },
      {
        role: "user",
        content: buildPrompt(input.readme, input.contactEmail),
      },
    ],
  });

  const parsedJson = JSON.parse(normalizeJsonText(extractOutputText(response)));
  return aiOutputSchema.parse(normalizeDraft(parsedJson));
}

function buildPrompt(readme: string, contactEmail: string): string {
  return `Create JSON with this exact shape:
{
  "extension": {
    "id": "seo-friendly-slug",
    "name": "Extension Name",
    "slug": "seo-friendly-slug",
    "category": "Category",
    "status": "Draft",
    "platform": "Chrome Extension",
    "version": "1.0.0",
    "language": "English",
    "description": "Short SEO-friendly summary",
    "longDescription": "Long hub page description",
    "github": "",
    "chromeStore": "",
    "privacyPath": "/extensions/seo-friendly-slug/privacy",
    "privacyPolicy": {
      "productName": "Extension Name",
      "lastUpdated": "2026-07-02",
      "summary": "Privacy summary",
      "contactEmail": "${contactEmail}",
      "sections": [{ "title": "1. Overview", "body": "Policy text" }],
      "dataPractices": [{
        "category": "personal",
        "title": "Personal data",
        "collects": false,
        "description": "Practice description",
        "sharedWithThirdParties": false
      }],
      "thirdPartiesDescription": "Third-party sharing statement"
    }
  },
  "missingFields": [],
  "questions": []
}

Rules:
- Valid JSON only.
- Never invent GitHub or Chrome Web Store URLs.
- If required facts are missing, leave safe empty values and add missingFields/questions.
- privacyPolicy.contactEmail must be ${contactEmail}.

README:
${readme}`;
}

function extractOutputText(response: unknown): string {
  if (typeof response === "object" && response !== null && "output_text" in response) {
    const outputText = (response as { output_text?: unknown }).output_text;
    if (typeof outputText === "string") {
      return outputText;
    }
  }

  throw new Error("OpenAI response did not include output_text");
}

function normalizeJsonText(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeDraft(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("extension" in value)) {
    return value;
  }

  const output = value as {
    extension?: {
      slug?: unknown;
      privacyPath?: unknown;
    };
  };
  const slug = output.extension?.slug;

  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    output.extension = {
      ...output.extension,
      privacyPath: "",
    };
    return output;
  }

  const expectedPrivacyPath = `/extensions/${slug}/privacy`;
  if (output.extension?.privacyPath !== expectedPrivacyPath) {
    output.extension = {
      ...output.extension,
      privacyPath: expectedPrivacyPath,
    };
  }

  return output;
}
