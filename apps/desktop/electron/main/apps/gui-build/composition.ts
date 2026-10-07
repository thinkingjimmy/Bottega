/**
 * [INPUT]: Depends on the bundled Node, native esbuild resolver, the loaded sandbox module path, packaged compiler/toolchain bytes, signed component snapshots, private staging, and release-pinned Linux system/stable component selection
 * [OUTPUT]: Provides production App and plugin GUI build compositions with hashed runtime custody, offline component scaffolding, and a never-throwing create whose missing payload becomes a typed GUI_COMPILER_SANDBOX_UNAVAILABLE build failure compilerProgram (TASK-35 C6).
 * [POS]: apps/gui-build composition leaf wired by AppsService; a damaged toolchain payload closes authoring only and leaves every other App runnable
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { app } from "electron";
import { AppSourcePreparer } from "./pipeline/source-preparer";
import { createCompilerSandbox, sandboxAdapterEntryPath } from "./pipeline/sandbox";
import { AppGuiBuildService } from "./service";
import { AppGuiComponentScaffolder } from "./scaffold/component-scaffolder";
import { AppGuiAdmissionPolicy } from "./admission";
import type { CompilerSandboxPort } from "./contracts";
import { LinuxCompilerLocator } from "./native/linux/locator";
import { resolveEsbuildExecutable } from "./native/esbuild";
import { inspectPluginSource } from "./source/inspection";
import { runtimePort } from "../../runtime";

const require = createRequire(import.meta.url);

/**
 * AppsService 在构造期调用这里。载荷残缺时抛出，等于让一个 authoring 能力的缺失
 * 顺手打死全部 App（含 legacy static）——PRD D23 的 fail-closed 只覆盖「不许编译」，
 * 不覆盖「不许运行」。所以创建永不抛：把原因留到 probe，编译时才 fail-closed。
 */
export function createAppGuiBuildService(userData: string, subject: "app" | "plugin" = "app") {
  const stagingRoot = join(userData, `${subject}-gui-compiler-staging`);
  try {
    return compilerService(stagingRoot, subject === "plugin");
  } catch (cause) {
    return new AppGuiBuildService(
      new AppSourcePreparer(subject === "plugin" ? inspectPluginSource : undefined),
      unavailableSandbox(cause instanceof Error ? cause.message : String(cause)),
      new AppGuiComponentScaffolder(resolveComponentSnapshotRoot(null)),
      AppGuiAdmissionPolicy.fromEnvironment(),
      { stagingRoot, compilerEntry: "", sandboxAdapterEntry: "", nativePayloads: [] }
    );
  }
}

/** 没有已验证载荷就没有编译：探针即拒绝，compile 永远拿不到执行权。 */
function unavailableSandbox(reason: string): CompilerSandboxPort {
  const message = `App GUI compiler payload is unavailable: ${reason}`;
  return {
    platform: process.platform === "win32" || process.platform === "linux" ? process.platform : "darwin",
    probe: () => Promise.reject(Object.assign(new Error(message), { code: "GUI_COMPILER_SANDBOX_UNAVAILABLE" })),
    compile: async () => ({
      status: "failed",
      findings: [{ code: "GUI_COMPILER_SANDBOX_UNAVAILABLE", file: "app.json", message }],
    }),
  };
}

/**
 * The compiler's program (TASK-35 C6): the bundled Node and the digest-checked compiler entry, each resolved when asked. The entry is
 * small and is checked when the service is composed; the Node (a 121 MB hash) only on the first probe or compile.
 */
export function compilerProgram() {
  return { node: () => runtimePort().node().path, entry: () => runtimePort().entryPath("app-gui-compiler") };
}

export function createPluginGuiBuildService(userData: string) {
  return createAppGuiBuildService(userData, "plugin");
}

function compilerService(stagingRoot: string, plugin = false) {
  const program = compilerProgram();
  const compilerEntry = program.entry();
  const esbuildExecutable = resolveEsbuildExecutable(require.resolve("esbuild/package.json"));
  const oxideNative = resolveOxideNative();
  const resourcesRoot = app?.isPackaged === true && typeof process.resourcesPath === "string" && process.resourcesPath
    ? process.resourcesPath
    : null;
  const componentSnapshotRoot = resolveComponentSnapshotRoot(resourcesRoot);
  const metadataRoot = resolveMetadataRoot(resourcesRoot);
  if (!existsSync(join(metadataRoot, "toolchain-manifest.json"))) {
    throw new Error("App GUI packaged metadata payload is missing");
  }
  const dependencyRoots = [
    dirname(compilerEntry),
    nodeModulesRoot(esbuildExecutable),
    ...(resourcesRoot ? [resourcesRoot] : []),
    metadataRoot,
  ];
  const nativePayloads = [esbuildExecutable, ...(oxideNative ? [oxideNative] : [])];
  const sandboxPayload = process.platform === "darwin"
    ? "/usr/bin/sandbox-exec"
    : (resourcesRoot
          ? join(resourcesRoot, "app-gui-toolchain/native/win32-x64/bottega-compiler-sandbox.exe")
          : join(dirname(process.execPath), "bottega-compiler-sandbox.exe"));
  const linuxLocator = new LinuxCompilerLocator({
    execPolicy: join(metadataRoot, "native/linux-x64/exec-policy"),
    manifest: async () => {
      const bytes = await readFile(join(metadataRoot, "native/linux-x64/trust-manifest.json"));
      if (bytes.length > 32 * 1024) throw new Error("Linux compiler trust manifest exceeds its budget");
      return JSON.parse(bytes.toString("utf8"));
    },
  });
  const sandbox = createCompilerSandbox({
    compilerEntry,
    nodeExecutable: program.node,
    dependencyRoots,
    esbuildExecutable,
    metadataRoot,
    linuxResolver: (stableOnly) => linuxLocator.resolve(stableOnly),
    windowsWrapper: resourcesRoot
      ? join(resourcesRoot, "app-gui-toolchain/native/win32-x64/bottega-compiler-sandbox.exe")
      : join(dirname(process.execPath), "bottega-compiler-sandbox.exe"),
  });
  return new AppGuiBuildService(
    new AppSourcePreparer(plugin ? inspectPluginSource : undefined),
    sandbox,
    new AppGuiComponentScaffolder(componentSnapshotRoot),
    AppGuiAdmissionPolicy.fromEnvironment(),
    {
      stagingRoot,
      compilerEntry,
      sandboxAdapterEntry: sandboxAdapterEntryPath(),
      nativePayloads: [
        { id: "compiler-esbuild", path: nativePayloads[0]! },
        ...(nativePayloads[1] ? [{ id: "tailwind-oxide", path: nativePayloads[1] }] : []),
        ...(process.platform === "linux" ? [] : [{ id: `sandbox-${process.platform}-${process.arch}`, path: sandboxPayload }]),
      ],
    }
  );
}

function resolveMetadataRoot(resourcesRoot: string | null) {
  const candidates = resourcesRoot
    ? [join(resourcesRoot, "app-gui-toolchain")]
    : [
        resolve(process.cwd(), "resources/app-gui-toolchain"),
        resolve(process.cwd(), "apps/desktop/resources/app-gui-toolchain"),
        resolve(__dirname, "../../../../resources/app-gui-toolchain"),
        resolve(__dirname, "../../resources/app-gui-toolchain"),
      ];
  return candidates.find((path) => existsSync(join(path, "toolchain-manifest.json"))) ?? candidates[0]!;
}

function resolveComponentSnapshotRoot(resourcesRoot: string | null) {
  if (resourcesRoot) return join(resourcesRoot, "app-gui-components");
  const candidates = [
    resolve(__dirname, "../../resources/app-gui-components"),
    resolve(__dirname, "../../../../resources/app-gui-components"),
  ];
  return candidates.find((path) => existsSync(join(path, "catalog.json"))) ?? candidates[0]!;
}


function resolveOxideNative() {
  const oxideRequire = createRequire(require.resolve("@tailwindcss/oxide"));
  const identity = process.platform === "darwin" && process.arch === "arm64"
    ? ["@tailwindcss/oxide-darwin-arm64", "darwin-arm64"]
    : process.platform === "linux" && process.arch === "x64"
      ? ["@tailwindcss/oxide-linux-x64-gnu", "linux-x64-gnu"]
      : process.platform === "win32" && process.arch === "x64"
        ? ["@tailwindcss/oxide-win32-x64-msvc", "win32-x64-msvc"]
        : null;
  if (!identity) return null;
  const root = dirname(oxideRequire.resolve(`${identity[0]}/package.json`));
  const native = unpacked(join(root, `tailwindcss-oxide.${identity[1]}.node`));
  if (!existsSync(native)) throw new Error(`Tailwind Oxide native payload is missing: ${native}`);
  return native;
}

function nodeModulesRoot(path: string) {
  const marker = `${join("node_modules", "")}`;
  const index = path.indexOf(marker);
  return index < 0 ? dirname(path) : path.slice(0, index + marker.length);
}

function unpacked(path: string) {
  const candidate = path.replace(`${join("app.asar", "")}`, `${join("app.asar.unpacked", "")}`);
  return existsSync(candidate) ? candidate : path;
}
