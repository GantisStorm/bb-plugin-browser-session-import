import type { PluginRpcContract } from "@get-bb/plugin-sdk";
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

const savedProfileBase = {
  id: idSchema,
  name: z.string().trim().min(1).max(128),
  createdAt: z.number().int().positive(),
};
export const savedProfileSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...savedProfileBase,
      kind: z.literal("native"),
      hostId: idSchema,
      family: z.string().min(1).max(64),
      sourceProfileId: idSchema,
      sourceLabel: z.string(),
      profileLabel: z.string(),
    })
    .strict(),
  z
    .object({
      ...savedProfileBase,
      kind: z.literal("json"),
      fileName: z.string().min(1).max(1024),
      cookieCount: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type SavedProfile = z.infer<typeof savedProfileSchema>;
export const sharedDefaultSchema = z
  .object({
    hostId: idSchema,
    profileId: idSchema,
    appliedAt: z.number().int().positive(),
  })
  .strict();
export type SharedDefault = z.infer<typeof sharedDefaultSchema>;
export const discoveredBrowserSchema = targetSchema
  .extend({
    title: z.string(),
    url: z.string(),
    threadTitle: z.string(),
    windowLabel: z.string(),
    profile: z.enum(["personal", "automation"]),
    profileId: z.string().nullable(),
    controlLabel: z.string().nullable(),
  })
  .strict();
export type DiscoveredBrowser = z.infer<typeof discoveredBrowserSchema>;

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
  reload: {
    input: z.object({ tabId: idSchema, wsEndpoint: z.string().url() }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
} satisfies PluginRpcContract;

export const rpcContract = {
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
  listTabs: {
    input: scopeSchema,
    output: z
      .array(
        z
          .object({
            tabId: idSchema,
            title: z.string(),
            url: z.string(),
            profile: z.enum(["personal", "automation"]),
            profileId: z.string().nullable(),
            controlLabel: z.string().nullable(),
          })
          .strict(),
      )
      .max(1000),
  },
  listSources: {
    input: z.object({ hostId: idSchema }).strict(),
    output: z.array(sourceSchema).max(32),
  },
  importProfile: {
    input: targetSchema
      .extend({
        family: z.string().min(1).max(64),
        profileId: z.string().min(1).max(256),
      })
      .strict(),
    output: z
      .object({ importedCookies: z.number().int().nonnegative() })
      .strict(),
  },
  importCookies: {
    input: targetSchema
      .extend({
        fileName: z.string().min(1).max(1024),
        cookies: z.array(cookieSchema).min(1).max(10000),
      })
      .strict(),
    output: z
      .object({ importedCookies: z.number().int().nonnegative() })
      .strict(),
  },
  profiles: {
    input: z.object({}).strict(),
    output: z
      .object({
        profiles: z.array(savedProfileSchema).max(100),
        defaults: z.array(sharedDefaultSchema),
      })
      .strict(),
  },
  saveNativeProfile: {
    input: z
      .object({
        name: savedProfileBase.name,
        hostId: idSchema,
        family: z.string().min(1).max(64),
        sourceProfileId: idSchema,
      })
      .strict(),
    output: savedProfileSchema,
  },
  saveJsonProfile: {
    input: z
      .object({
        name: savedProfileBase.name,
        fileName: z.string().min(1).max(1024),
        cookies: z.array(cookieSchema).min(1).max(10000),
      })
      .strict(),
    output: savedProfileSchema,
  },
  renameProfile: {
    input: z.object({ id: idSchema, name: savedProfileBase.name }).strict(),
    output: savedProfileSchema,
  },
  removeProfile: {
    input: z.object({ id: idSchema, confirm: z.literal(true) }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  findBrowsers: {
    input: z.object({ hostId: idSchema }).strict(),
    output: z.array(discoveredBrowserSchema),
  },
  applyProfile: {
    input: targetSchema
      .extend({ profileId: idSchema, confirmShared: z.boolean() })
      .strict(),
    output: z
      .object({
        importedCookies: z.number().int().nonnegative(),
        sharedDefault: z.boolean(),
        reloaded: z.boolean(),
      })
      .strict(),
  },
} satisfies PluginRpcContract;

export const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list-hosts") }).strict(),
  z
    .object({ operation: z.literal("list-instances"), hostId: idSchema })
    .strict(),
  z.object({ operation: z.literal("list-tabs"), target: scopeSchema }).strict(),
  z.object({ operation: z.literal("list-sources"), hostId: idSchema }).strict(),
  rpcContract.importProfile.input.extend({
    operation: z.literal("import-profile"),
  }),
  rpcContract.importCookies.input.extend({
    operation: z.literal("import-cookies"),
  }),
  rpcContract.profiles.input.extend({ operation: z.literal("profiles") }),
  rpcContract.saveNativeProfile.input.extend({
    operation: z.literal("save-native-profile"),
  }),
  rpcContract.saveJsonProfile.input.extend({
    operation: z.literal("save-json-profile"),
  }),
  rpcContract.renameProfile.input.extend({
    operation: z.literal("rename-profile"),
  }),
  rpcContract.removeProfile.input.extend({
    operation: z.literal("remove-profile"),
  }),
  rpcContract.findBrowsers.input.extend({
    operation: z.literal("find-browsers"),
  }),
  rpcContract.applyProfile.input.extend({
    operation: z.literal("apply-profile"),
  }),
]);
export type Request = z.infer<typeof requestSchema>;
