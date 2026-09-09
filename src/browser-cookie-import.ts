import type { Cookie } from "./contracts.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Cookie ${index + 1} has no ${field}`);
  }
  return value;
}

function requiredBoolean(
  value: unknown,
  field: string,
  index: number,
): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Cookie ${index + 1} has no ${field}`);
  }
  return value;
}

function cookieSameSite(
  value: unknown,
  index: number,
): Cookie["sameSite"] {
  if (value === "no_restriction" || value === "None") return "no_restriction";
  if (value === "lax" || value === "Lax") return "lax";
  if (value === "strict" || value === "Strict") return "strict";
  if (value === "unspecified" || value === undefined) return "unspecified";
  throw new Error(`Cookie ${index + 1} has an unsupported sameSite value`);
}

function cookieExpiry(value: unknown, index: number): number | null {
  if (value === undefined || value === null || value === 0) return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  throw new Error(`Cookie ${index + 1} has an invalid expirationDate`);
}

function parseCookie(
  value: unknown,
  index: number,
): Cookie {
  const cookie = asRecord(value);
  if (cookie === null) throw new Error(`Cookie ${index + 1} is not an object`);
  if (typeof cookie.value !== "string") {
    throw new Error(`Cookie ${index + 1} has no string value`);
  }
  return {
    name: requiredString(cookie.name, "name", index),
    value: cookie.value,
    domain: requiredString(cookie.domain, "domain", index),
    path:
      typeof cookie.path === "string" && cookie.path.length > 0
        ? cookie.path
        : "/",
    secure: requiredBoolean(cookie.secure, "secure", index),
    httpOnly: requiredBoolean(cookie.httpOnly, "httpOnly", index),
    sameSite: cookieSameSite(cookie.sameSite, index),
    expirationDate: cookieExpiry(cookie.expirationDate ?? cookie.expiry, index),
  };
}

export function parseBrowserCookieImport(
  value: unknown,
): Cookie[] {
  const root = asRecord(value);
  const cookies = Array.isArray(value)
    ? value
    : root !== null && Array.isArray(root.cookies)
      ? root.cookies
      : null;
  if (cookies === null || cookies.length === 0) {
    throw new Error(
      "Choose a JSON cookie export with a non-empty cookies array",
    );
  }
  return cookies.map(parseCookie);
}
