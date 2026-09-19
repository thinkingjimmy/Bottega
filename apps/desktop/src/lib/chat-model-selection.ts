/**
 * [INPUT]: Depends on shared Agent/Codex turn options and ability to catalog the Backend/Codex model
 * [OUTPUT]: Provides default options, catalog-addressed effort/tier fallbacks, preference-versus-effective Speed presentation, Speed reason addressing, external labels, and model switching
 * [POS]: lib's chat model chooses a pure rule layer that allows UI, perpetuation and testing to share the same set of side-effects-free decisions
 */

export { DEFAULT_QUICK_CHAT_OPTIONS, effortLabel, compactModelLabel, findModel, speedReasonKey, quickEffortIndex, optionsForModel, optionsForListModel, listModelEffortState, listModelSpeedState } from "@ai-chat/chat-ui/models/selection";
