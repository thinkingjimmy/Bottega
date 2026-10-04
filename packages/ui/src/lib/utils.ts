/**
 * [INPUT]: Depends on clsx for conditional class lists and tailwind-merge for conflict resolution.
 * [OUTPUT]: Provides cn, the single class-merging helper every shared component composes its class strings with.
 * [POS]: lib's root utility; components/ui and every downstream surface import it instead of concatenating classes by hand.
 */
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
