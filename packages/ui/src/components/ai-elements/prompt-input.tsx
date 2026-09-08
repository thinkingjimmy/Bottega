"use client";

/**
 * [INPUT]: Depends on the sibling context/core/controls modules that make up PromptInput's three-layer implementation
 * [OUTPUT]: Re-exports PromptInput's full public API: the value model, provider, submission core, and visual controls
 * [POS]: ai-elements' single public entry point for PromptInput; state, transaction, and control logic never live here directly
 */

export * from "./prompt-input-context";
export * from "./prompt-input-controls";
export * from "./prompt-input-core";
