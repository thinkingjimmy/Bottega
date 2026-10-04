/**
 * [INPUT]: Depends on node:crypto/fs/path, the git runner (bounded, repository-aware) and DurableJson-free content-addressed files.
 * [OUTPUT]: Provides EvidenceStore (content-addressed evidence bodies), captureCodeEvidence (the exact commit, every changed file counted and 200 listed, and a 2 MiB diff of uncommitted work with new files included — partial, naming what it leaves out, when they do not all fit — with its digest), CodeEvidence / CommandEvidence and reviewEvidenceSection (what the reviewer is handed, read-only, within a UTF-8 byte budget — inline, by path and digest, or the whole section stored — with anything missing named as missing).
 * [POS]: Review evidence for TASK-17 (06 §9, W16): the host records facts after the development step; the reviewer never runs anything and never sees the developer's claims presented as results.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { resolveGitTopLevel, runGit, tryGit } from "../projects/git/git-runner";

export const DIFF_BYTE_LIMIT = 2 * 1024 * 1024;
/** How many changed files are listed, and how many omitted paths are named; neither caps what the diff holds (A-08). */
const FILE_LIMIT = 200;
/**
 * `changedCount` is every uncommitted file; `changedFiles` lists at most 200 of them. The diff is `included` whole, `partial` when
 * new files beyond the 2 MiB budget were left out (`omitted` names them, `omittedCount` counts them), or `too-large` when even
 * the tracked changes exceed it.
 */
export type CodeEvidence = { state: "captured" | "not-a-repository" | "unavailable"; commit: string | null; changedFiles: string[]; filesTruncated: boolean;
  changedCount: number;
  diff: { state: "included" | "partial" | "too-large" | "none"; ref: string | null; digest: string | null; bytes: number; omitted: string[]; omittedCount: number };
  detail: string | null };
/**
 * A command the development turn really ran, from its recorded tool calls; nothing here comes from the Agent's report. `exitCode`
 * is the exact code the Provider reported, or null when it reports none (never inferred); `status` is the tool's own outcome.
 */
export type CommandEvidence = { command: string; exitCode: number | null; status?: "completed" | "failed"; outputTail: string };

export class EvidenceStore {
  constructor(private readonly root: string) {}
  async put(text: string) {
    const digest = createHash("sha256").update(text).digest("hex");
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, `ev_${digest}`), text);
    return { ref: `ev_${digest}`, digest: `sha256:${digest}` };
  }
  /** The store's directory: outside every workspace, granted to review turns as a read-only root. */
  get directory() { return this.root; }
  pathOf(ref: string) { return join(this.root, ref); }
  read(ref: string) {
    if (!/^ev_[a-f0-9]{64}$/.test(ref)) return Promise.reject(new Error("evidence-ref-invalid"));
    return readFile(join(this.root, ref), "utf8");
  }
  async readVerified(ref: string) {
    if (!/^ev_[a-f0-9]{64}$/.test(ref)) throw new Error("workflow-evidence-unavailable");
    const file = await open(join(this.root, ref), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > DIFF_BYTE_LIMIT) throw new Error("workflow-evidence-unavailable");
      const bytes = await file.readFile();
      if (bytes.length > DIFF_BYTE_LIMIT || createHash("sha256").update(bytes).digest("hex") !== ref.slice(3)) throw new Error("workflow-evidence-unavailable");
      return bytes.toString("utf8");
    } finally { await file.close(); }
  }
}

/** `status -z` records: "XY path", and a rename or copy carries its source as the next record. */
function statusEntries(output: string) {
  const records = output.split("\0").filter(Boolean), entries: { code: string; path: string }[] = [];
  for (let index = 0; index < records.length; index++) {
    const code = records[index]!.slice(0, 2);
    entries.push({ code, path: records[index]!.slice(3) });
    if (code[0] === "R" || code[0] === "C") index++;
  }
  return entries;
}

/* Status paths are relative to the repository's top level, like the diff's. `git diff HEAD` leaves new files out, and a new file is most of what a development step writes: each one is added as a
   new-file hunk from its bytes (a regular file only, never through a link; binary content is named, not shown). */
async function untrackedHunks(topLevel: string, paths: readonly string[], budget: number) {
  let text = "";
  const omitted: string[] = [];
  for (const path of paths) {
    const absolute = join(topLevel, path), info = await lstat(absolute).catch(() => null);
    if (!info?.isFile()) continue;
    const bytes = info.size <= budget - Buffer.byteLength(text) ? await readFile(absolute) : null;
    const header = `diff --git a/${path} b/${path}\nnew file mode 100644\n`;
    const hunk = bytes === null ? null : bytes.includes(0) ? `${header}Binary files /dev/null and b/${path} differ\n` : (() => {
      const lines = bytes.toString("utf8").split("\n");
      if (lines.at(-1) === "") lines.pop();
      return `${header}--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}\n`).join("")}`;
    })();
    /* A file that does not fit is left out and named; the ones after it may still fit (A-08). */
    if (hunk === null || Buffer.byteLength(text) + Buffer.byteLength(hunk) > budget) { omitted.push(path); continue; }
    text += hunk;
  }
  return { text, omitted };
}

export async function captureCodeEvidence(workspace: string, store: EvidenceStore): Promise<CodeEvidence> {
  const none = { state: "none" as const, ref: null, digest: null, bytes: 0, omitted: [], omittedCount: 0 };
  try {
    const head = await tryGit(workspace, ["rev-parse", "--verify", "HEAD"]);
    if (head === null) return { state: "not-a-repository", commit: null, changedFiles: [], filesTruncated: false, changedCount: 0, diff: none, detail: null };
    const entries = statusEntries(await runGit(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { maxBytes: 512 * 1024 }));
    const files = entries.map(entry => entry.path);
    let diff: CodeEvidence["diff"] = none;
    if (files.length) {
      const tracked = await runGit(workspace, ["diff", "--no-ext-diff", "--no-textconv", "HEAD"], { maxBytes: DIFF_BYTE_LIMIT }).catch(() => null);
      const untracked = tracked === null ? null
        : await untrackedHunks(await resolveGitTopLevel(workspace), entries.filter(entry => entry.code === "??").map(entry => entry.path), DIFF_BYTE_LIMIT - Buffer.byteLength(tracked));
      const text = tracked === null || untracked === null ? null : tracked + untracked.text;
      const omitted = untracked?.omitted ?? [];
      diff = text === null ? { ...none, state: "too-large", bytes: DIFF_BYTE_LIMIT }
        : text || omitted.length ? { state: omitted.length ? "partial" : "included", ...await store.put(text), bytes: Buffer.byteLength(text),
          omitted: omitted.slice(0, FILE_LIMIT), omittedCount: omitted.length } : none;
    }
    return { state: "captured", commit: head.trim(), changedFiles: files.slice(0, FILE_LIMIT), filesTruncated: files.length > FILE_LIMIT, changedCount: files.length, diff, detail: null };
  } catch (cause) {
    return { state: "unavailable", commit: null, changedFiles: [], filesTruncated: false, changedCount: 0, diff: none, detail: (cause instanceof Error ? cause.message : String(cause)).slice(0, 300) };
  }
}

/**
 * What the reviewer is handed (W16): the exact commit, the changed files, the diff and every command the development turn ran
 * with its exit code. Missing evidence is said to be missing, so it can never read as passed. `budget` is the UTF-8 bytes this
 * section may take in the review turn (A-10): the diff is inline only when the whole section fits, otherwise by path and digest;
 * if even that does not fit, the complete section is stored and handed by path and digest. Nothing is truncated silently.
 */
export async function reviewEvidenceSection(code: CodeEvidence | null, commands: readonly CommandEvidence[] | null, store: EvidenceStore, budget: number) {
  const diffText = code?.state === "captured" && code.diff.ref && code.diff.state !== "too-large" ? await store.read(code.diff.ref).catch(() => null) : null;
  const inline = evidenceSection(code, commands, store, diffText);
  if (Buffer.byteLength(inline) <= budget) return inline;
  const referenced = evidenceSection(code, commands, store, null);
  if (Buffer.byteLength(referenced) <= budget) return referenced;
  const whole = await store.put(inline);
  return `## Evidence recorded by Bottega (read-only; nothing here was reported by the developer)\n\nThe evidence is ${Buffer.byteLength(inline)} bytes, `
    + `too long to include here. Read all of it with your file-reading tool at ${store.pathOf(whole.ref)} — it is read-only, and what you read must match ${whole.digest}. `
    + "Treat anything you do not read as missing, not as passed.";
}

function evidenceSection(code: CodeEvidence | null, commands: readonly CommandEvidence[] | null, store: EvidenceStore, diffText: string | null) {
  const lines = ["## Evidence recorded by Bottega (read-only; nothing here was reported by the developer)"];
  if (!code || code.state !== "captured") lines.push(`Code snapshot: not recorded (${code?.state ?? "missing"}${code?.detail ? `: ${code.detail}` : ""}). Treat it as missing.`);
  else {
    const more = code.changedCount - code.changedFiles.length;
    lines.push(`Commit: ${code.commit}`, code.changedFiles.length ? `Uncommitted files:\n${code.changedFiles.map(file => `- ${file}`).join("\n")}${more > 0 ? `\n- …and ${more} more file${more === 1 ? "" : "s"}` : ""}` : "Uncommitted files: none");
    if ((code.diff.state === "included" || code.diff.state === "partial") && code.diff.ref) {
      const at = `Read the full diff with your file-reading tool at ${store.pathOf(code.diff.ref)} — it is read-only, and what you read must match that digest.`;
      lines.push(diffText !== null ? `Diff (${code.diff.digest}):\n\`\`\`diff\n${diffText}\n\`\`\``
        : `Diff: ${code.diff.bytes} bytes (${code.diff.digest}), too long to include here. ${at}`);
      if (code.diff.state === "partial") {
        const unnamed = code.diff.omittedCount - code.diff.omitted.length;
        lines.push(`The diff is partial: it was limited to ${DIFF_BYTE_LIMIT} bytes, and these new files are not in it:\n${code.diff.omitted.map(file => `- ${file}`).join("\n")}${unnamed > 0 ? `\n- …and ${unnamed} more` : ""}\nRead them yourself if your review needs them; name what you did not read.`);
      }
    } else if (code.diff.state === "included") lines.push(`Diff: recorded as ${code.diff.digest} but unreadable now. Treat it as missing.`);
    else if (code.diff.state === "too-large") lines.push(`Diff: larger than ${DIFF_BYTE_LIMIT} bytes, not recorded. Your review covers only the files you read; name them in your result.`);
  }
  if (!commands) lines.push("Commands the developer ran: not recorded. Treat test results as missing, not as passed.");
  else if (!commands.length) lines.push("Commands the developer ran: none. No tests were run.");
  else {
    const outcome = (item: CommandEvidence) => item.exitCode !== null ? `exit ${item.exitCode}`
      : `exit code not recorded${item.status ? ` (the tool reported ${item.status === "failed" ? "a failure" : "completion"})` : ""}`;
    lines.push(`Commands the developer ran:\n${commands.map(item => `- \`${item.command}\` → ${outcome(item)}${item.outputTail ? `\n  ${item.outputTail.replace(/\n/g, "\n  ")}` : ""}`).join("\n")}`);
    /* 06: a test result counts only with its command, exit code and snapshot; without an exit code it stays claimed. */
    if (commands.some(item => item.exitCode === null)) lines.push("A result that rests on a command with no recorded exit code is claimed, not verified: do not treat it as passed.");
  }
  return lines.join("\n\n");
}
