/**
 * [INPUT]: Depends on shared rich-input canonical Projection combined with UI RichValue
 * [OUTPUT]: Provides renderer type RichValue→AgentUserInput sequencing and number of real wire items
 * [POS]: The thin adapter of the renderer lib; Projection truth is shared, main can be independently repositioned to the same algorithm as IPC concurrent computation
 */

import type { RichValue } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { projectRichInput } from "../../shared/rich-input-projection";

export const serializeRichValue = (value: RichValue) =>
  projectRichInput(value);

export const richValueWireItemCount = (value: RichValue) =>
  serializeRichValue(value).length;
