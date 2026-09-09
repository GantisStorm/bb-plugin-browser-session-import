import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const idSchema = z.string().min(1).max(256);
export const scopeSchema = z
  .object({
    hostId: idSchema,
    instanceId: idSchema,
    generation: idSchema,
    threadId: idSchema,
  })
  .strict();
export const targetSchema = scopeSchema.extend({ tabId: idSchema }).strict();
export const cookieSchema = z
  .object({
    name: z.string().min(1).max(4096),
    value: z.string().max(65536),
    domain: z.string().min(1).max(4096),
    path: z.string().min(1).max(4096),
    secure: z.boolean(),
    httpOnly: z.boolean(),
    sameSite: z.enum(["no_restriction", "lax", "strict", "unspecified"]),
    expirationDate: z.number().finite().positive().nullable(),
  })
  .strict();
export type Cookie = z.infer<typeof cookieSchema>;

export const profileSchema = z
  .object({ id: z.string().min(1).max(256), label: z.string().min(1).max(256) })
  .strict();
export const sourceSchema = z
  .object({
    family: z.string().min(1).max(64),
    label: z.string().min(1).max(256),
    profiles: z.array(profileSchema).max(128),
  })
  .strict();
export type CookieSource = z.infer<typeof sourceSchema>;
export const importRecordSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("profile"),
      destination: z.string().min(1).max(512),
      family: z.string().min(1).max(64),
      profileId: z.string().min(1).max(256),
      profileLabel: z.string().min(1).max(256),
      sourceLabel: z.string().min(1).max(256),
      importedCookies: z.number().int().nonnegative(),
      importedAt: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("json"),
      destination: z.string().min(1).max(512),
      fileName: z.string().min(1).max(1024),
      importedCookies: z.number().int().nonnegative(),
      importedAt: z.number().int().positive(),
    })
    .strict(),
]);
export type ImportRecord = z.infer<typeof importRecordSchema>;

export const hostContract = defineRpcContract({
  listSources: { input: z.object({}).strict(), output: z.array(sourceSchema).max(32) },
  importProfile: {
    input: z.object({ family: z.string().min(1).max(64), profileId: z.string().min(1).max(256), tabId: idSchema, wsEndpoint: z.string().url() }).strict(),
    output: z.object({ importedCookies: z.number().int().nonnegative() }).strict(),
  },
  importCookies: {
    input: z.object({ cookies: z.array(cookieSchema).min(1).max(10000), tabId: idSchema, wsEndpoint: z.string().url() }).strict(),
    output: z.object({ importedCookies: z.number().int().nonnegative() }).strict(),
  },
  clear: {
    input: z.object({ tabId: idSchema, wsEndpoint: z.string().url() }).strict(),
    output: z.object({ clearedCookies: z.number().int().nonnegative() }).strict(),
  },
});

export const rpcContract = defineRpcContract({
  listHosts: {
    input: z.object({}).strict(),
    output: z
      .array(
        z
          .object({
            id: idSchema,
            name: z.string().min(1).max(256),
            status: z.enum(["connected", "disconnected"]),
          })
          .strict(),
      )
      .max(100),
  },
  listInstances: {
    input: z.object({ hostId: idSchema }).strict(),
    output: z
      .array(
        z
          .object({
            hostId: idSchema,
            instanceId: idSchema,
            generation: idSchema,
            label: z.string(),
          })
          .strict(),
      )
      .max(100),
  },
  listTabs: { input: scopeSchema, output: z.array(z.object({ tabId: idSchema, title: z.string(), url: z.string(), profile: z.enum(["personal", "automation"]), profileId: z.string().nullable(), controlLabel: z.string().nullable(), }).strict()).max(1000) },
  listSources: {
    input: z.object({ hostId: idSchema }).strict(),
    output: z.array(sourceSchema).max(32),
  },
  history: { input: z.object({ destination: z.string().min(1).max(512).optional() }).strict(), output: z.array(importRecordSchema).max(100) },
  importProfile: { input: targetSchema.extend({ family: z.string().min(1).max(64), profileId: z.string().min(1).max(256) }).strict(), output: importRecordSchema },
  importCookies: { input: targetSchema.extend({ fileName: z.string().min(1).max(1024), cookies: z.array(cookieSchema).min(1).max(10000) }).strict(), output: importRecordSchema },
  clear: { input: targetSchema.extend({ confirm: z.literal(true) }).strict(), output: z.object({ clearedCookies: z.number().int().nonnegative() }).strict() },
  openHomepage: { input: scopeSchema, output: z.object({ tabId: idSchema }).strict() },
});

export const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list-hosts") }).strict(),
  z.object({ operation: z.literal("list-instances"), hostId: idSchema }).strict(),
  z.object({ operation: z.literal("list-tabs"), target: scopeSchema }).strict(),
  z.object({ operation: z.literal("list-sources"), hostId: idSchema }).strict(),
  z.object({ operation: z.literal("history") }).strict(),
  z.object({ operation: z.literal("import-profile"), target: targetSchema, family: z.string().min(1).max(64), profileId: z.string().min(1).max(256) }).strict(),
  z.object({ operation: z.literal("import-cookies"), target: targetSchema, fileName: z.string().min(1).max(1024), cookies: z.array(cookieSchema).min(1).max(10000) }).strict(),
  z.object({ operation: z.literal("clear"), target: targetSchema, confirm: z.literal(true) }).strict(),
  z.object({ operation: z.literal("open-homepage"), target: scopeSchema }).strict(),
]);
export type Request = z.infer<typeof requestSchema>;
