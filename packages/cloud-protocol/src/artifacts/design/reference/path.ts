/**
 * [INPUT]: Zod; no file access or workspace contracts.
 * [OUTPUT]: Closed relative design source paths.
 * [POS]: Source-only scalar kept out of static fence and composer reference readers.
 */
import { z } from "zod";
export const sourcePath = z.string().min(1).max(240).refine(value => value.split("/").length <= 4 &&
  value.split("/").every(part => /^[A-Za-z0-9_][A-Za-z0-9_. -]*$/.test(part)) && !value.split("/").includes("node_modules"));
