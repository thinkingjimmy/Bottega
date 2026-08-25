/**
 * [INPUT]: Depends on browser File agreement with PromptInput acceptance/size/number limit
 * [OUTPUT]: Provides selectPromptInputFiles with a shared error file size, pure function calculation of the current receivable file with the only validation error
 * [POS]: the access rules for the attachments ui/lib; Side effects of isolation testing and React state/URL/callback
 */

export type PromptInputFileError = {
  code: "max_files" | "max_file_size" | "accept";
  message: string;
};

export const PROMPT_INPUT_MAX_FILE_SIZE_MESSAGE =
  "All files exceed the maximum size.";

type FileSelectionOptions = {
  accept?: string;
  currentCount: number;
  maxFiles?: number;
  maxFileSize?: number;
};

function matchesAccept(file: File, accept?: string) {
  const patterns = accept
    ?.split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  if (!patterns?.length) return true;
  return patterns.some((pattern) =>
    pattern.endsWith("/*")
      ? file.type.startsWith(pattern.slice(0, -1))
      : file.type === pattern
  );
}

export function selectPromptInputFiles(
  fileList: File[] | FileList,
  options: FileSelectionOptions
): { files: File[]; error?: PromptInputFileError } {
  const incoming = [...fileList];
  const accepted = incoming.filter((file) =>
    matchesAccept(file, options.accept)
  );
  if (incoming.length > 0 && accepted.length === 0) {
    return {
      files: [],
      error: {
        code: "accept",
        message: "No files match the accepted types.",
      },
    };
  }

  const sized = accepted.filter(
    (file) => !options.maxFileSize || file.size <= options.maxFileSize
  );
  if (accepted.length > 0 && sized.length === 0) {
    return {
      files: [],
      error: {
        code: "max_file_size",
        message: PROMPT_INPUT_MAX_FILE_SIZE_MESSAGE,
      },
    };
  }

  const capacity =
    typeof options.maxFiles === "number"
      ? Math.max(0, options.maxFiles - options.currentCount)
      : sized.length;
  const files = sized.slice(0, capacity);
  return sized.length > capacity
    ? {
        files,
        error: {
          code: "max_files",
          message: "Too many files. Some were not added.",
        },
      }
    : { files };
}
