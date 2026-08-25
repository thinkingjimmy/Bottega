/**
 * [INPUT]: Depends on the standardized GitHub URL and product-free single-wheel server context
 * [OUTPUT]: Provides createInstallAnalysisPrompt, requiring only the maintenance Agent to read the inference manifest and trigger the sublayer contract
 * [POS]: An analysis instruction template for Apps/install sub-modules that defines the boundaries between the App GUI and the server Agent, and does not assume execution or trust decisions
 */

export function createInstallAnalysisPrompt(repoUrl: string) {
  return `${repoUrl} 已被 clone 到当前目录。你的任务是**只读分析**：不要安装依赖、不要执行
仓库内的任何脚本或构建命令。

1. 阅读 README、package.json 与关键源码，判断这个应用的运行形态：
   - 若它是纯前端应用（构建产物可静态托管，无自定义 server/middleware/API），型别为 static；
   - 若它依赖自身的 dev server、middleware 或后端进程才能完整工作，型别为 server。
2. 推断 installCmd（如 "pnpm install"）。static 型推断 buildCmd 与产物目录 staticDir
   ——若仓库本身就是可直接托管的静态站点（已有可用的 index.html），buildCmd 置 null、
   staticDir 指向该目录（可为 "."）。server 型推断 startCmd。
   staticDir 必须是仓库内的相对路径，禁止绝对路径与 ".."。
3. 若 README/skills 表明该应用需要一个 Agent 会话在项目目录伺服其请求
   （如监听状态文件的 watcher 脚本），输出 serveAgentPrompt 与 serveTrigger：
   - serveTrigger.watchPath 按优先级选择（仓库内相对路径）：
     ① 应用的"专用触发文件"——内容当且仅当新请求到达时变化；② 没有
     专用触发文件时，写应用保存请求的状态文件本身（Agent 自身写入只会
     造成少量空查轮，可接受）。只有应用的请求根本不落盘时，
     serveAgentPrompt、serveTrigger、agentRequirements 才整体置 null。
   - serveAgentPrompt 会被逐字作为一轮 \`codex exec\` 的唯一输入，在 App
     目录内无头执行——没有 widget 宿主、没有对话 UI、没有用户消息；应用
     GUI 已由产品托管，用户操作只会落盘到状态文件。宿主在 watchPath
     变化时唤醒新一轮，因此提示词必须描述单轮语义：「读取状态定位
     待处理请求 → 有则处理并把结果（含失败信息）回写 → 无则立即结束
     本轮」。对"处理中/已认领"状态的请求：仅当应用自身文档定义了
     认领/租约协议、且能按该协议机械判定原认领者已失效时才接管；
     否则一律不触碰——应用可能有自己的 worker 或并行会话在处理。
     必须明确写入：本轮结束即退出，宿主会按需再次唤醒；即使应用 skills
     文档要求启动或重启 watcher/服务器/浏览器，也一律不执行。
   - 若 README 同时描述 widget 模式与 localhost/状态文件模式，只提炼后者。
   同时从 .agent-plugin/plugin.json、.mcp.json、.agent/config.toml 与
   skills 目录提取精确工具要求：agentRequirements.mcpServers 写 MCP 配置
   键名，agentRequirements.skills 写 SKILL.md 所在目录名。
4. 以最终消息输出符合 schema 的 JSON manifest。**所有字段都必须出现，不适用的字段
   显式置 null**。startCmd 中的端口必须写成 {PORT} 占位符（查明该应用通过哪个参数或
   环境变量指定端口）；服务必须绑定 127.0.0.1，若启动命令支持指定 host，将其写成
   {HOST} 占位符。healthPath 必须以单个 "/" 开头。图标选一个贴切的 emoji。`;
}
