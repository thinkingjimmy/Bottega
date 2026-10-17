/**
 * [INPUT]: Main-issued Artifact identity, revision digest and lifecycle generation.
 * [OUTPUT]: Portable DesignAnchor/DesignReference types with optional Canvas typography/geometry hints for drafts and queue custody.
 * [POS]: Contract-only reference; it grants no file or execution authority.
 */
export type DesignAnchor = Readonly<{ boardId: string; boardDigest: string; selector: string | null; currentText: string;
  region: { x: number; y: number; width: number; height: number } | null;
  bounds?: { x: number; y: number; width: number; height: number };
  properties?: Readonly<Partial<Record<"color" | "background-color" | "font-size" | "padding" | "gap" | "width" | "height" |
    "font-family" | "font-weight" | "font-style" | "text-decoration" | "text-align" | "line-height" | "letter-spacing" | "left" | "top", string>>>;
  viewport?: { width: number; height: number; scrollX: number; scrollY: number }; sourceLine?: number; file?: string }>;
export type DesignReference = Readonly<{ artifactId: string; documentId: string; revision: number; readSetDigest: string; generation: string;
  anchors?: Readonly<Record<string, DesignAnchor | null>> }>;
