/**
 * [INPUT]: Depends on the closed Base image contract and the preload-owned invoke function.
 * [OUTPUT]: Exposes only bounded image staging, record saving and owner preview commands.
 * [POS]: Native Base bridge leaf; no arbitrary channels, filesystem paths or Electron objects are exposed.
 */
import { BASE_IMAGE_CHANNEL, type BaseImagesBridge } from "@ai-chat/base-ui/attachments/native-images";
export function createBaseImagesBridge(invoke: (channel: string, input: unknown) => Promise<unknown>): BaseImagesBridge {
  const call = <K extends keyof BaseImagesBridge>(key: K, input: Parameters<BaseImagesBridge[K]>[0]) =>
    invoke(BASE_IMAGE_CHANNEL[key], input) as ReturnType<BaseImagesBridge[K]>;
  return { begin: input => call("begin", input), part: input => call("part", input), finish: input => call("finish", input),
    cancel: input => call("cancel", input), commitRecord: input => call("commitRecord", input), thumbnail: input => call("thumbnail", input) };
}
