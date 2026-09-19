/**
 * [INPUT]: Depends on the settingsSkillsEn structural type
 * [OUTPUT]: Provides settingsSkillsFr, the French Settings › Skills catalog
 * [POS]: French leaf of shared/i18n/locales/settings/skills; loaded on demand by the matching top-level locale
 */

import type { settingsSkillsEn } from "./en";

export const settingsSkillsFr: typeof settingsSkillsEn = {
  tabs: { skills: "Skills", extensions: "Extensions" }, refresh: "Actualiser les Skills", importTitle: "Ajouter des Skills",
  description: "Importez une fois dans votre Library personnelle, puis utilisez les Skills activés dans chaque conversation compatible.",
  back: "Retour", localFolder: "Dossier local", chooseFolder: "Choisir un dossier…", importPrimary: "Tout importer", importSelected: "Importer et activer {{count}}",
  backend: { codex: "Codex", claude: "Claude", kimi: "Kimi", opencode: "OpenCode" },
  sourceKind: { "local-folder": "Local", adopted: "Importé", extension: "Extension" },
  selectSkill: "Sélectionner {{name}}", enable: "Activer", disable: "Désactiver", delete: "Supprimer", gotoPackage: "Voir l’extension",
  batch: { selected: "{{count}} sélectionnés", done: "Terminé" },
  emptyTitle: "Aucun Skill personnel", emptyScanning: "Recherche de Skills dans vos Agents installés…",
  emptyLead: "{{count}} Skills trouvés dans vos Agents. Importez-les une fois pour les utiliser dans chaque conversation compatible.",
  emptyNothingHint: "Aucun Skill importable. Installez une Extension ou choisissez un dossier local.",
  readOnly: "La gestion des Skills est en lecture seule",
  budget: "{{count}} activés · liste de session ≈ {{size}} (estimation des Skills activés de la Library)", search: "Rechercher des Skills", noMatches: "Aucun Skill correspondant.",
  confirmDeleteTitle: "Supprimer les Skills ?", confirmDeleteBody: "Supprimer définitivement {{count}} Skills de votre Library personnelle.", confirmDeleteAction: "Supprimer",
  footerImport: "Importer vos Skills existants →", footerManage: "Gérer les Skills",
  contentState: { downloading: "Téléchargement…", missing: "Absent de cet appareil" },
  noticeSlugConflict: "Renommé sur un autre appareil",
  error: { failed: "L’opération Skill a échoué. Réessayez." },
  reason: {
    "missing-skill-md": "SKILL.md manque", "invalid-frontmatter": "Les métadonnées SKILL.md sont invalides", "invalid-name": "Le nom du Skill est invalide",
    "skill-md-too-large": "SKILL.md est trop volumineux", "too-many-directories": "Trop de dossiers imbriqués", "too-many-candidates": "Trop de candidats",
    symlink: "Les liens symboliques sont refusés", "unsafe-path": "Un chemin sort du dossier Skill", "not-a-directory": "Ce n’est pas un dossier",
    unreadable: "Le dossier est illisible", missing: "Le dossier manque", changed: "Le dossier a changé pendant la lecture", timeout: "La détection a expiré",
    "source-gone": "La source est indisponible", "postcondition-changed": "L’état a changé pendant l’opération", "acquisition-failed": "L’import a échoué",
    "ref-invalid": "La référence Skill est invalide", unknown: "L’état ne peut pas être vérifié",
  },
};
