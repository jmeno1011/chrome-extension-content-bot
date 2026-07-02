import { z } from "zod";
import { privacyPolicySchema } from "./extension.schema.js";

const slugOrEmptySchema = z.union([z.literal(""), z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)]);
const privacyPathOrEmptySchema = z.union([
  z.literal(""),
  z.string().regex(/^\/extensions\/[a-z0-9]+(?:-[a-z0-9]+)*\/privacy$/),
]);

export const aiExtensionDraftSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  slug: slugOrEmptySchema,
  category: z.string(),
  status: z.string().min(1),
  platform: z.string().min(1),
  version: z.string().min(1),
  language: z.string().min(1),
  description: z.string().min(1),
  longDescription: z.string().min(1),
  github: z.string(),
  chromeStore: z.string(),
  privacyPath: privacyPathOrEmptySchema,
  privacyPolicy: privacyPolicySchema,
});

export const aiOutputSchema = z.object({
  extension: aiExtensionDraftSchema,
  missingFields: z.array(z.string()),
  questions: z.array(z.string()),
});

export type AiOutput = z.infer<typeof aiOutputSchema>;
