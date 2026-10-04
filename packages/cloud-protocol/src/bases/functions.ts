/**
 * [INPUT]: The encrypted Base RPC table.
 * [OUTPUT]: baseFunctions, the sole ciphertext Base registry (no plaintext alternative).
 * [POS]: Base domain table of the merged registry; kept schema-only so a caller that lists Bases does not load the operation model (OPT-31).
 *        The native JSON codecs live in operations.ts, the read header in reader.ts.
 */
import { encryptedBaseFunctions } from "./encrypted/functions";
export const baseFunctions = encryptedBaseFunctions;
