/**
 * [INPUT]: Accepts Unbelievable codec stdin/stdout
 * [OUTPUT]: Provides 4-byte BE length forward forward DATA/TERMINAL decoding and exceeding, intercepting, trailing-byte refusing
 * [POS]: The basic rules of the database are: Any host implementation must first interpret the image bytes using this protocol
 */

export const CODEC_FRAME_BYTE_LIMIT = 16 * 1024 * 1024;
export const CODEC_STREAM_BYTE_LIMIT = 64 * 1024 * 1024;
const TERMINAL = 0;

export function encodeCodecFrames(
  chunks: readonly Buffer[],
  maxFrame = CODEC_FRAME_BYTE_LIMIT
) {
  const frames: Buffer[] = [];
  let total = 0;
  for (const chunk of chunks) {
    if (!chunk.length || chunk.length > maxFrame) {
      throw protocolError("FRAME_SIZE");
    }
    total += chunk.length;
    if (total > CODEC_STREAM_BYTE_LIMIT) throw protocolError("STREAM_SIZE");
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(chunk.length);
    frames.push(header, chunk);
  }
  frames.push(Buffer.alloc(4));
  return Buffer.concat(frames);
}

export function decodeCodecFrames(
  wire: Buffer,
  maxFrame = CODEC_FRAME_BYTE_LIMIT
) {
  const chunks: Buffer[] = [];
  let offset = 0;
  let total = 0;
  let terminal = false;
  while (offset < wire.length) {
    if (wire.length - offset < 4) throw protocolError("TRUNCATED_HEADER");
    const length = wire.readUInt32BE(offset);
    offset += 4;
    if (length === TERMINAL) {
      terminal = true;
      break;
    }
    if (length > maxFrame) throw protocolError("FRAME_SIZE");
    if (wire.length - offset < length) throw protocolError("TRUNCATED_FRAME");
    total += length;
    if (total > CODEC_STREAM_BYTE_LIMIT) throw protocolError("STREAM_SIZE");
    chunks.push(wire.subarray(offset, offset + length));
    offset += length;
  }
  if (!terminal) throw protocolError("MISSING_TERMINAL");
  if (offset !== wire.length) throw protocolError("TRAILING_BYTES");
  return chunks;
}

function protocolError(code: string) {
  return Object.assign(new Error(`CODEC_PROTOCOL_${code}`), { code });
}
