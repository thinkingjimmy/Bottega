/**
 * [INPUT]: Depends on shared BuiltinTool Static spec, lease context and main toolset handler for each domain
 * [OUTPUT]: Provides BuiltinToolRegistry, starts the spec/handler test one by one, strict zod analysis, calls cancel the signal, logical results budget ((domain and lease issuer budget decreased) and calls by name
 * [POS]: The tools platform is rooted in the combination of tools and platformsbridge does not have any branch of business in any sector
 */

import {
  BUILTIN_TOOL_DOMAINS,
  BUILTIN_TOOL_SPECS,
  builtinToolSpec,
  type BuiltinToolName,
} from "../../../shared/builtin-tools";
import type { BuiltinMcpLease } from "./lease";

export type BuiltinToolContext = {
  lease: BuiltinMcpLease;
  invocationId: string;
  signal: AbortSignal;
};

export type BuiltinToolHandler = (
  args: Record<string, unknown>,
  context: BuiltinToolContext
) => Promise<unknown> | unknown;

export type BuiltinToolset = Partial<
  Record<BuiltinToolName, BuiltinToolHandler>
>;

export class BuiltinToolRegistry {
  private readonly handlers = new Map<BuiltinToolName, BuiltinToolHandler>();

  constructor(...toolsets: BuiltinToolset[]) {
    for (const toolset of toolsets) {
      for (const [name, handler] of Object.entries(toolset)) {
        if (!builtinToolSpec(name)) {
          throw new Error(`handler 引用了未知内置工具：${name}`);
        }
        if (this.handlers.has(name as BuiltinToolName)) {
          throw new Error(`内置工具 handler 重复：${name}`);
        }
        this.handlers.set(name as BuiltinToolName, handler!);
      }
    }
    const missing = BUILTIN_TOOL_SPECS.filter(
      (spec) => !this.handlers.has(spec.name)
    ).map((spec) => spec.name);
    if (missing.length) {
      throw new Error(`内置工具缺少 handler：${missing.join(", ")}`);
    }
  }

  async call(
    tool: BuiltinToolName,
    rawArgs: unknown,
    context: BuiltinToolContext
  ) {
    const spec = builtinToolSpec(tool);
    const handler = this.handlers.get(tool);
    if (!spec || !handler) throw statusError(404, `工具 ${tool} 不存在`);
    const parsed = spec.inputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      throw statusError(400, `工具参数无效：${parsed.error.message}`);
    }
    const result = await handler(parsed.data, context);
    const limit = Math.min(
      BUILTIN_TOOL_DOMAINS[spec.domainId].logicalResultByteLimit,
      context.lease.resultByteBudget
    );
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > limit) {
      throw statusError(413, `${spec.domainId} 工具逻辑结果超过预算`);
    }
    return result;
  }
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
