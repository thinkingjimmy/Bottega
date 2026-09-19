/**
 * [INPUT]: Fixed seven-day client search and measured incomplete-cache states.
 * [OUTPUT]: Shared localized command groups, search, coverage and refresh-protection copy.
 * [POS]: Cloud copy catalog; index progress never implies that chat drafts are saved.
 */
export const en = {
  "results": "Results",
  "actions": "Quick actions",
  "label": "Search chats",
  "placeholder": "Search words",
  "scope": "Search chat titles and messages from the last 7 days.",
  "preparing": "Preparing search for the last 7 days. Current results may be incomplete.",
  "updating": "Updating search. Current results may be incomplete.",
  "ready": "Search is ready.",
  "limited": "Search coverage is incomplete. Some content has missing time information or exceeds the current resource limits.",
  "paused": "Search is paused. Connect and retry to update results.",
  "storageFailed": "The encrypted search cache could not be saved. You can search this page, but refreshing may require rebuilding.",
  "unsaved": "Search is still preparing. Refreshing may require reprocessing progress that has not been saved.",
  "progress": "{titles} titles · {messages} messages indexed",
  "searching": "Searching…",
  "empty": "No matches found.",
  "emptyPartial": "No matches in the content prepared so far. Search is still incomplete.",
  "resultsLimited": "Showing the first 100 matches. Add more words to narrow the search.",
  "stale": "This result has changed or is no longer available. Search again.",
  "retry": "Retry search preparation",
  "untitled": "Untitled chat",
  "titleHit": "Chat title",
  "messageHit": "Message",
  "queryInvalid": "Use up to 256 characters and 16 words."
};
export type CloudSearchCopy = Record<keyof typeof en, string>;
