/**
 * [INPUT]: The composer translate function a host already owns.
 * [OUTPUT]: Provides InteractionTranslation and useInteractionTranslation.
 * [POS]: The one seam carrying a host's language into conversation/interactions; it holds no copy of its own.
 */
import { createContext, useContext } from "react";
import type { ComposerTranslate } from "../../composer/controls/copy/translation";
export const InteractionTranslation = createContext<ComposerTranslate>(key => key);
export const useInteractionTranslation = () => ({ t: useContext(InteractionTranslation) });
