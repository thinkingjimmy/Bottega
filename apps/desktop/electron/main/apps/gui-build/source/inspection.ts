/**
 * [INPUT]: Depends on bounded filesystem inspection and shared immutable source budgets.
 * [OUTPUT]: Provides the plugin source allowlist and fingerprint inputs for the shared freeze pipeline.
 * [POS]: GUI build source leaf; package scripts, executables and dependencies never enter a plugin GUI build.
 */
import { lstat, readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { APP_GUI_BUILD_BUDGET } from "../contracts";
export async function inspectPluginSource(root:string) {
  const canonical = await realpath(root);
  const files:Array<{path:string;bytes:number}> = [];
  let totalBytes = 0;
  const visit = async (directory:string, depth:number) => {
    if(depth > APP_GUI_BUILD_BUDGET.sourceDepth) throw new Error("Plugin source depth exceeds its budget");
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const path = join(directory,entry.name);
      const name = relative(canonical,path).split(sep).join("/");
      if(name === "app.json") throw new Error("Plugin source cannot declare an App identity");
      if(name !== "plugin.json" && name !== "README.md" && name !== "SKILL.md" && name !== "gui" && !name.startsWith("gui/")) continue;
      const info = await lstat(path);
      if(info.isSymbolicLink()) throw new Error("Plugin source contains a symbolic link");
      if(info.isDirectory()) {await visit(path,depth+1);continue;}
      if(!info.isFile() || info.nlink !== 1 || (info.mode & 0o111) !== 0) throw new Error("Plugin source must contain non-executable regular files with one link");
      totalBytes += info.size;
      if(info.size > 512*1024 || totalBytes > APP_GUI_BUILD_BUDGET.sourceBytes || files.length >= APP_GUI_BUILD_BUDGET.sourceFiles) throw new Error("Plugin source exceeds its fixed budget");
      files.push({path:name,bytes:info.size});
    }
  };
  await visit(canonical,0);
  if(!files.some(file=>file.path === "plugin.json")) throw new Error("Plugin manifest is missing");
  return {files:files.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path))),totalBytes,ignored:[]};
}
