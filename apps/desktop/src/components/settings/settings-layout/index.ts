/**
 * [INPUT]: Depends on the three settings-layout modules: page-frame, content and controls
 * [OUTPUT]: Re-exports all sixteen Settings display primitives under the single specifier `@/components/settings/settings-layout`
 * [POS]: The barrel of settings-layout/; the split is an authoring concern, so no caller has to know which third a primitive lives in
 */

/* 桶文件不是省事，是把「拆成几块」留在文件系统里，不让它漏进调用方的
   import 路径。二十来处调用只该知道「Settings 原语在这里」，不该知道
   SettingsRow 和 SettingsSwitch 恰好不在同一个文件——那是作者的排版
   问题，不是使用者的知识。哪天再拆一层，调用方仍然一个字都不必改。 */

export { SettingsAlert, SettingsCanvas, SettingsSection } from "./page-frame";
export {
  SettingsBadge,
  SettingsEmpty,
  SettingsLinkRow,
  SettingsList,
  SettingsNoteList,
  SettingsRow,
  SettingsSurface,
} from "./content";
export {
  SettingsButton,
  SettingsChoiceRow,
  SettingsDisclosure,
  SettingsIconButton,
  SettingsLabelAction,
  SettingsSwitch,
} from "./controls";
