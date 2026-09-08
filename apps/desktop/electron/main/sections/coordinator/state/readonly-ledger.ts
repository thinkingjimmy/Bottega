/**
 * [INPUT]: Depends only on generic JavaScript object/array structure, not any specific ledger schema
 * [OUTPUT]: Provides the DeepReadonly mapped type and deepFreeze, used in development builds to enforce that committed ledger state is never mutated
 * [POS]: Read-only boundary unit for coordinator/state; keeps selector types consistent with the runtime dev-mode freeze
 */

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
