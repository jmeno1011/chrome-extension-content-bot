import { z } from "zod";

export const privacyPolicySchema = z.object({
  productName: z.string().min(1),
  lastUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string().min(1),
  contactEmail: z.string().email(),
  sections: z
    .array(
      z.object({
        title: z.string().min(1),
        body: z.string().min(1),
      }),
    )
    .min(1),
  dataPractices: z
    .array(
      z.object({
        category: z.string().min(1),
        title: z.string().min(1),
        collects: z.boolean(),
        description: z.string().min(1),
        sharedWithThirdParties: z.boolean(),
      }),
    )
    .min(1),
  thirdPartiesDescription: z.string().min(1),
});

export const extensionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: z.string().min(1),
  status: z.string().min(1),
  platform: z.string().min(1),
  version: z.string().min(1),
  language: z.string().min(1),
  description: z.string().min(1),
  longDescription: z.string().min(1),
  github: z.string(),
  chromeStore: z.string(),
  privacyPath: z.string().regex(/^\/extensions\/[a-z0-9]+(?:-[a-z0-9]+)*\/privacy$/),
  privacyPolicy: privacyPolicySchema,
});

export type Extension = z.infer<typeof extensionSchema>;
