/**
 * [INPUT]: Depends on zod and the AGENT_BACKEND_ORDER group of agent-ipc
 * [OUTPUT]: Provides agentBackendIdSchema The only zod of the back end of the pad id
 * [POS]: The shared back end authentication is a single source of truth; The durable file and the trans-process load cannot be written by hand respectively
 */

import { z } from "zod";
import { AGENT_BACKEND_ORDER } from "./agent-ipc";

/**
 * 与元组同源，故不存在「加了后端忘了改 schema」这类沉默失败。
 * 注意：内置工具的 `agent` **入参**不用它——那是产品面「哪些后端可被
 * 工具指派」的策略问题，与「系统认识哪些后端」不是同一个问题，
 * 硬编码在各自 spec 里才不会随注册表自动放宽。
 */
export const agentBackendIdSchema = z.enum(AGENT_BACKEND_ORDER);
