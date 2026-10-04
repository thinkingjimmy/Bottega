/**
 * [INPUT]: The wrapper's own host name and both wrappers' start functions.
 * [OUTPUT]: Starts the App surface wrapper on `srf-<lease>.surfaces.*` hosts and the artifact wrapper everywhere else.
 * [POS]: Single entry of the loader document; one static bundle (a lazily imported wrapper chunk failed to load in WebKit), the two wrappers share no runtime state.
 */
import { surfaceLeaseFromHost } from "@ai-chat/cloud-protocol/surfaces/origins";
import { startArtifact } from "./artifact/bootstrap";
import { startSurface } from "./surface/bootstrap";
if (surfaceLeaseFromHost(location.hostname)) startSurface();
else startArtifact();
