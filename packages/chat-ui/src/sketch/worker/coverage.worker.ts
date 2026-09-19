/**
 * [INPUT]: Depends on local coverage engine and stamped structured-clone messages.
 * [OUTPUT]: Provides preview/final worker replies and transferable, privately owned result buffers.
 * [POS]: Vite-packaged dedicated renderer worker; cancellation is owned by client termination.
 */
import { CoverageEngine } from "./engine";
import type { CoverageRequest, CoverageResponse } from "./protocol";
const scope = self as unknown as {
  onmessage: (event: MessageEvent<CoverageRequest>) => void;
  postMessage(message: CoverageResponse, transfer?: Transferable[]): void;
};
const engine = new CoverageEngine();
scope.onmessage = ({ data }) => {
  try {
    const response = engine.process(data);
    scope.postMessage(
      response,
      response.blocks.flatMap(
        (block) => [block.rowIndex.buffer, block.spans.buffer] as ArrayBuffer[],
      ),
    );
  } catch (error) {
    scope.postMessage({
      requestId: data.requestId,
      documentRevision: data.documentRevision,
      owner: data.owner,
      incarnationId: data.incarnationId,
      phase: data.phase,
      sampleSequence: data.sampleSequence,
      replacements: [],
      blocks: [],
      computeMs: 0,
      temporaryBytes: 0,
      error: error instanceof Error ? error.message : "SKETCH_WORKER_FAILED",
    });
  }
};
