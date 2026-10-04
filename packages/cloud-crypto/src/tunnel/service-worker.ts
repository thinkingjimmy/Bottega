/**
 * [INPUT]: Statically imported pinned libsodium and the verified tunnel primitive adapter.
 * [OUTPUT]: createServiceWorkerTunnelPrimitive without dynamic import at runtime.
 * [POS]: Service Workers reject dynamic import, so their dormant entry owns eager initialization.
 */
import sodium from "libsodium-wrappers-sumo";
import { createTunnelPrimitive } from "./primitive";
export const createServiceWorkerTunnelPrimitive = () => createTunnelPrimitive(sodium);
