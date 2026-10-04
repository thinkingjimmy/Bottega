/**
 * [INPUT]: Depends on the shared verified App package export kernel.
 * [OUTPUT]: Exposes published source export to the cloud synchronization producer.
 * [POS]: Main cloud adapter; installation verification uses the same package kernel.
 */
export { exportPublishedAppSource } from "../../../apps/share/package/cloud-source";
