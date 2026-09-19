/**
 * [INPUT]: Native Project actions, appearance and General settings vocabulary in five locales.
 * [OUTPUT]: projectActionCopy and template interpolation for portable Project presentation.
 * [POS]: Shared Project labels; hosts omit commands outside their capabilities.
 */
import { workspaceCopy } from "../copy";
export const projectActionCopy = (locale: string) => workspaceCopy(locale).project;
export const projectLabel = (text: string, name: string) => text.replaceAll("{{name}}", name);
