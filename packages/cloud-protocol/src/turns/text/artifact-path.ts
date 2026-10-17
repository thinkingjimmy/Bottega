/**
 * [INPUT]: Zod; no fence, text renderer or design contracts.
 * [OUTPUT]: Closed relative Artifact/Surface file names.
 * [POS]: Resource-path scalar shared by archive and surface readers without loading design metadata.
 */
import { z } from "zod";
export const artifactRelativePathSchema = z.string().min(1).max(1024).refine(value =>
  !/[\\\p{Cc}:]/u.test(value) && !value.startsWith("/") &&
  value.split("/").every(part => part !== "" && part !== "." && part !== ".." && !part.startsWith(".")));
