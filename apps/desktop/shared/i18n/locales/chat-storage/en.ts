/**
 * [INPUT]: Depends on no runtime modules; defines the Chat-storage copy baseline
 * [OUTPUT]: Provides English titles, explanations, recovery guidance, and diagnostic labels
 * [POS]: English authority for user-facing Chat-storage failures
 */

export const chatStorageEn = {
  technicalDetails: "Technical details",
  copyDetails: "Copy technical details",
  copiedDetails: "Technical details copied",
  code: {
    "file-quarantined": {
      title: "A chat is temporarily unavailable",
      explanation: "Bottega could not read this chat, so it preserved the original file and skipped it. Your other chats are unaffected.",
      resolution: "Update and restart Bottega. If this still appears, keep the backup and copy the technical details for support.",
    },
    "backup-failed": {
      title: "A chat could not be read or backed up",
      explanation: "Bottega stopped without changing the file to avoid further data loss.",
      resolution: "Check available disk space and file permissions, then restart Bottega. If it still fails, copy the technical details for support.",
    },
    "recovery-conflict": {
      title: "Bottega found chat copies it cannot safely restore",
      explanation: "Bottega could not determine which copy is correct, so it did not overwrite or remove any of them.",
      resolution: "Keep the files, then copy the technical details for support before making any manual changes.",
    },
  },
};
