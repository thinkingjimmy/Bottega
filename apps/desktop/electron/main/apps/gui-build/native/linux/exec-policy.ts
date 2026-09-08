/**
 * [INPUT]: Depends on fixed product executable paths and an already-framed compiler request
 * [OUTPUT]: Encodes the bounded Linux Landlock policy prefix without changing the inner request
 * [POS]: Host half of the freestanding Linux executable policy transport
 */

export function encodeLinuxExecPolicy(input: Readonly<{
  nodeExecutable: string;
  compilerEntry: string;
  esbuildExecutable?: string;
}>, request: Uint8Array): Buffer {
  const paths = [input.nodeExecutable, input.compilerEntry, ...(input.esbuildExecutable ? [input.esbuildExecutable] : [])];
  if (input.nodeExecutable === input.esbuildExecutable) throw invalid();
  const header = Buffer.alloc(12);
  header.write("BTEX0001", "ascii");
  header.writeUInt32BE(paths.length - 1, 8);
  const parts = paths.map((path) => {
    const bytes = Buffer.from(path, "utf8");
    if (!path.startsWith("/") || path.includes("\0") || bytes.length > 32_768 || bytes.toString("utf8") !== path) throw invalid();
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  });
  const payload = Buffer.concat([header, ...parts]);
  if (payload.length > 2 * 1024 * 1024) throw invalid();
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  return Buffer.concat([length, payload, request]);
}

function invalid() {
  return Object.assign(new Error("Invalid Linux compiler executable policy"), { code: "GUI_COMPILER_PROTOCOL_INVALID" });
}
