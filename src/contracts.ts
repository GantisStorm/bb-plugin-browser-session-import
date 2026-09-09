import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const idSchema = z.string().min(1).max(256);
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
  .object({ id: idSchema, label: z.string().min(1).max(256) })
  .strict();
export const sourceSchema = z
  .object({
    family: z.string().min(1).max(64),
    label: z.string().min(1).max(256),
    profiles: z.array(profileSchema).max(128),
  })
  .strict();
export type CookieSource = z.infer<typeof sourceSchema>;

export const currentImportSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("profile"),
      sourceLabel: z.string(),
      profileLabel: z.string(),
      importedCookies: z.number().int().nonnegative(),
      importedAt: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("json"),
      fileName: z.string().min(1).max(1024),
      importedCookies: z.number().int().nonnegative(),
      importedAt: z.number().int().positive(),
    })
    .strict(),
]);
export type CurrentImport = z.infer<typeof currentImportSchema>;

export const hostContract = {
  listSources: {
    input: z.object({}).strict(),
    output: z.array(sourceSchema).max(32),
  },
  importProfile: {
    input: z
      .object({
        family: z.string().min(1).max(64),
        profileId: z.string().min(1).max(256),
        tabId: idSchema,
        wsEndpoint: z.string().url(),
      })
      .strict(),
    output: z
      .object({ importedCookies: z.number().int().nonnegative() })
      .strict(),
  },
  importCookies: {
    input: z
      .object({
        cookies: z.array(cookieSchema).min(1).max(10000),
        tabId: idSchema,
        wsEndpoint: z.string().url(),
      })
      .strict(),
    output: z
      .object({ importedCookies: z.number().int().nonnegative() })
      .strict(),
  },
  clear: {
    input: z.object({ tabId: idSchema, wsEndpoint: z.string().url() }).strict(),
    output: z
      .object({ clearedCookies: z.number().int().nonnegative() })
      .strict(),
  },
  reload: {
    input: z.object({ tabId: idSchema, wsEndpoint: z.string().url() }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
} satisfies PluginRpcContract;

export const rpcContract = {
  listSources: {
    input: z.object({ hostId: idSchema }).strict(),
    output: z.array(sourceSchema).max(32),
  },
  importProfile: {
    input: z
      .object({
        hostId: idSchema,
        family: z.string().min(1).max(64),
        profileId: z.string().min(1).max(256),
      })
      .strict(),
    output: z
      .object({
        importedCookies: z.number().int().nonnegative(),
        hostId: idSchema,
      })
      .strict(),
  },
  importCookies: {
    input: z
      .object({
        hostId: idSchema,
        fileName: z.string().min(1).max(1024),
        cookies: z.array(cookieSchema).min(1).max(10000),
      })
      .strict(),
    output: z
      .object({
        importedCookies: z.number().int().nonnegative(),
        hostId: idSchema,
      })
      .strict(),
  },
  clear: {
    input: z.object({ hostId: idSchema, confirm: z.literal(true) }).strict(),
    output: z
      .object({ clearedCookies: z.number().int().nonnegative() })
      .strict(),
  },
  current: {
    input: z.object({}).strict(),
    output: z
      .object({
        hostId: z.string().nullable(),
        hostName: z.string().nullable(),
        current: currentImportSchema.nullable(),
      })
      .strict(),
  },
} satisfies PluginRpcContract;

export const requestSchema = z.discriminatedUnion("operation", [
  rpcContract.listSources.input.extend({
    operation: z.literal("list-sources"),
  }),
  rpcContract.importProfile.input.extend({
    operation: z.literal("import-profile"),
  }),
  rpcContract.importCookies.input.extend({
    operation: z.literal("import-cookies"),
  }),
  rpcContract.clear.input.extend({ operation: z.literal("clear") }),
  rpcContract.current.input.extend({ operation: z.literal("current") }),
]);
export type Request = z.infer<typeof requestSchema>;
