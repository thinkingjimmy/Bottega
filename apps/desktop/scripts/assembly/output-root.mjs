export function resolveOutputRoot(args = [], _environment = process.env, allowedFlags = []) {
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error("Duplicate build argument: " + flag);
    seen.add(flag);
    if (flag === "--output-root") {
      if (args[++index] !== "out") throw new Error("Public builds require output root out");
    } else if (!allowedFlags.includes(flag)) {
      throw new Error("Unknown build argument: " + flag);
    }
  }
  return "out";
}
