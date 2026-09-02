/**
 * [INPUT]: Depends on browser File contracts, PromptInput acceptance/size/count limits, and host-resolved validation messages
 * [OUTPUT]: Provides selectPromptInputFiles as a pure admission calculation with one localized validation error
 * [POS]: the access rules for the attachments ui/lib; Side effects of isolation testing and React state/URL/callback
 */

export type PromptInputFileError = {
  code: "max_files" | "max_file_size" | "accept";
  message: string;
};

export type PromptInputFileMessages = Record<
  PromptInputFileError["code"],
  string
>;

type FileSelectionOptions = {
  accept?: string;
  currentCount: number;
  maxFiles?: number;
  maxFileSize?: number;
  messages: PromptInputFileMessages;
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
        message: options.messages.accept,
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
        message: options.messages.max_file_size,
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
          message: options.messages.max_files,
        },
      }
    : { files };
}
