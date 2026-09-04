/**
 * [INPUT]: Depends on zod and shared SHA-256 digest syntax
 * [OUTPUT]: Provides strict file.export begin, binary chunk header, complete (finalize/cancel), and result contracts
 * [POS]: Shared app-gui native export boundary; destination paths and operating-system handles remain main-owned
 */

import { z } from "zod";

const FILE_EXPORT_MEDIA_TYPES = [
  "text/plain;charset=utf-8",
  "text/csv;charset=utf-8",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
type FileExportMediaTypeV1 = (typeof FILE_EXPORT_MEDIA_TYPES)[number];

export type BeginFileExportRequestV1 = Readonly<{
  version: 1;
  suggestedName: string;
  mediaType: FileExportMediaTypeV1;
  byteLength: number;
  sha256: `sha256:${string}`;
}>;
export type BeginFileExportResultV1 =
  | Readonly<{ status: "accepted"; exportId: string; maxChunkBytes: 65_536 }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "declined"; reason: "permission" | "gesture" | "busy" }>;
export type WriteFileExportChunkHeaderV1 = Readonly<{
  exportId: string;
  seq: number;
  byteLength: number;
}>;
type FileExportSurfaceV1 = Readonly<{
  appId: string;
  surfaceId: string;
  appSurfaceLeaseId: string;
}>;
export type BeginFileExportInputV1 = Readonly<{
  surface: FileExportSurfaceV1;
  request: BeginFileExportRequestV1;
  trustedGestureAt: number;
}>;
export type WriteFileExportChunkInputV1 = Readonly<{
  surface: FileExportSurfaceV1;
  header: WriteFileExportChunkHeaderV1;
  bytes: Uint8Array;
}>;
export type CompleteFileExportInputV1 = Readonly<{
  surface: FileExportSurfaceV1;
  exportId: string;
}>;
export type CompleteFileExportResultV1 =
  | Readonly<{ status: "saved"; filename: string; byteLength: number; sha256: `sha256:${string}` }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "failed"; code: "integrity" | "timeout" | "io" | "surface_closed" }>;

const digestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as `sha256:${string}`);
const exportIdSchema = z.string().trim().min(16).max(200);

export const beginFileExportRequestV1Schema: z.ZodType<BeginFileExportRequestV1> = z
  .object({
    version: z.literal(1),
    suggestedName: z.string().min(1).max(255),
    mediaType: z.enum(FILE_EXPORT_MEDIA_TYPES),
    byteLength: z.number().int().min(1).max(20 * 1024 * 1024),
    sha256: digestSchema,
  })
  .strict();
export const writeFileExportChunkHeaderV1Schema: z.ZodType<WriteFileExportChunkHeaderV1> = z
  .object({
    exportId: exportIdSchema,
    seq: z.number().int().nonnegative().max(319),
    byteLength: z.number().int().min(1).max(65_536),
  })
  .strict();

const fileExportSurfaceV1Schema: z.ZodType<FileExportSurfaceV1> = z
  .object({
    appId: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,127}$/),
    surfaceId: z.string().min(1).max(200),
    appSurfaceLeaseId: z.string().min(1).max(200),
  })
  .strict();

export const beginFileExportInputV1Schema: z.ZodType<BeginFileExportInputV1> = z
  .object({
    surface: fileExportSurfaceV1Schema,
    request: beginFileExportRequestV1Schema,
    trustedGestureAt: z.number().int().nonnegative(),
  })
  .strict();

export const completeFileExportInputV1Schema: z.ZodType<CompleteFileExportInputV1> = z
  .object({
    surface: fileExportSurfaceV1Schema,
    exportId: exportIdSchema,
  })
  .strict();

export function parseWriteFileExportChunkInputV1(value: unknown): WriteFileExportChunkInputV1 {
  const parsed = z.object({
    surface: fileExportSurfaceV1Schema,
    header: writeFileExportChunkHeaderV1Schema,
    bytes: z.instanceof(Uint8Array),
  }).strict().parse(value);
  if (parsed.bytes.byteLength !== parsed.header.byteLength) {
    throw new Error("FILE_EXPORT_CHUNK_LENGTH");
  }
  return parsed;
}

export const FILE_EXPORT_SUFFIX: Readonly<Record<FileExportMediaTypeV1, string>> = {
  "text/plain;charset=utf-8": ".txt",
  "text/csv;charset=utf-8": ".csv",
  "application/json": ".json",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
