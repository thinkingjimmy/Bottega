/**
 * [INPUT]: Depends on zod; Chrome profile and cookie domain names that are explicitly selected by the user
 * [OUTPUT]: Provides Browser Import IPC channel, platform availability, profile/domain schema, results, and BrowserImportBridgeApi
 * [POS]: The Chrome Login Import Agreement for shared Chrome Login is a contract for the import of shared Chrome loginsOnly select and count, without revealing Keychain keys, cookie values or machine paths
 */

import { z } from "zod";

export const chromeProfileDirectorySchema = z
  .string()
  .regex(/^(?:Default|Profile [1-9][0-9]{0,3})$/);
export const chromeCookieDomainSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^\.?[A-Za-z0-9.-]+$/);
export const previewCookieDomainsSchema = z
  .object({ profileDirectory: chromeProfileDirectorySchema })
  .strict();
export const importChromeCookiesSchema = z
  .object({
    profileDirectory: chromeProfileDirectorySchema,
    domains: z.array(chromeCookieDomainSchema).max(10_000),
  })
  .strict();

export type ChromeProfile = {
  directory: string;
  name: string;
};

export type ChromeCookieDomain = {
  domain: string;
  cookieCount: number;
};

export type BrowserImportFailure =
  | "keychain-denied"
  | "key-unavailable"
  | "unsupported-encryption";

export type BrowserImportResult = {
  status: "ok" | BrowserImportFailure;
  imported: number;
  skipped: number;
  failed: number;
  domains: string[];
  message?: string;
};

export const BROWSER_IMPORT_CHANNEL = {
  availability: "browser-import:availability",
  detectProfiles: "browser-import:detect-profiles",
  previewCookieDomains: "browser-import:preview-cookie-domains",
  importCookies: "browser-import:import-cookies",
} as const;

export type BrowserImportBridgeApi = {
  availability(): Promise<{ available: boolean }>;
  detectProfiles(): Promise<ChromeProfile[]>;
  previewCookieDomains(input: {
    profileDirectory: string;
  }): Promise<ChromeCookieDomain[]>;
  importCookies(input: {
    profileDirectory: string;
    domains: string[];
  }): Promise<BrowserImportResult>;
};
