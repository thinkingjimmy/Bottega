/**
 * [INPUT]: Depends on the projectsEn structural type
 * [OUTPUT]: Provides projectsFr, the French Sidebar Projects catalog
 * [POS]: French leaf of shared/i18n/locales/projects; loaded on demand by the matching top-level locale
 */
import { workspaceCopy } from "@ai-chat/ui/workspace-copy/fr";


import type { projectsEn } from "./en";

export const projectsFr: typeof projectsEn = {
  provider: {
    loadFailed: "Échec du chargement des Projects : {{message}}",
    addFailed: "Échec de l’ajout du Project : {{message}}",
    appProjectFailed: "Échec de la création du Project de l’App : {{message}}",
    renameFailed: "Échec du renommage du Project : {{message}}",
    appearanceFailed: "Échec de l’enregistrement de l’apparence du Project : {{message}}",
    revealFailed: "Impossible d’afficher le Project dans le gestionnaire de fichiers système : {{message}}",
    sortFailed: "Échec de l’enregistrement du tri des Projects : {{message}}",
    coordinatorUnavailable: "Le coordinateur d’importation de Project est indisponible.",
  },
  sortAria: workspaceCopy.project.sortLabel,
  sortLastUpdated: workspaceCopy.project.recent,
  sortManual: workspaceCopy.project.manual,
  add: "Ajouter un Project",
  empty: "Cliquez sur + pour ajouter un dossier",
  showMore: "Afficher plus",
  moreActions: workspaceCopy.project.more,
  newChatIn: "Nouvelle tâche dans {{name}}",
  missingRecord: "L’enregistrement du Project est introuvable",
  missingName: "Project perdu",
  missingFolder: "Dossier du Project introuvable : {{dir}}",
  editBadge: "Édition",
  baseTag: "Base",
  rename: workspaceCopy.project.rename,
  renameTitle: workspaceCopy.project.renameTitle,
  renameDescription:
    workspaceCopy.project.renameDescription,
  moveChatsToRoot: "Remettre les chats à la racine",
  rescue: {
    title: "Déplacer les chats hors de ce Project ?",
    description: "L’enregistrement local de ce Project est introuvable. Les chats confirmés seront déplacés à la racine comme chats ordinaires. Une nouvelle session Agent commencera à la reprise.",
    retry: "Vérifier la récupération",
    pending: "En attente de confirmation du cloud. Le chat d’origine est conservé.",
    conflicted: "La version cloud a changé. Conservez le chat d’origine pour abandonner cette récupération.",
    confirmed: "Confirmation reçue. Le déplacement local se termine.",
    keepOriginal: "Conserver le chat d’origine",
    failed: "Le déplacement est incomplet. Vérifiez son état et réessayez.",
    more: "D’autres chats attendent. Examinez ce groupe pour afficher le suivant.",
    untitled: "Chat sans titre",
  },
  unbound: {
    badge: "Dossier requis",
    tooltip:
      "Ce Project n'a pas encore de dossier sur cet ordinateur. Choisissez-en un pour y travailler.",
    chooseFolder: "Choisir un dossier…",
    chooseFailed: "Impossible de définir le dossier du Project : {{message}}",
    turnRefused:
      "Ce Project n'a pas de dossier sur cet ordinateur. Choisissez-en un dans le menu du Project avant de lancer une tâche.",
  },
  removeLocal: "Retirer le Project local",
  removeLocalTitle: "Retirer {{name}} ?",
  removeLocalDescription:
    "Cette action retire uniquement le Project local de l’application. Les fichiers de votre ordinateur et les chats existants ne seront pas supprimés.",
  archiveInsteadTitle: "Archiver plutôt {{name}} ?",
  archiveInsteadBase:
    "Ce Project possède une Project Base et ne peut pas être retiré en toute sécurité. Archivez-le plutôt pour conserver le Project, la Base, les fichiers et les chats.",
  archiveInsteadMemory:
    "La mémoire de groupe partagée appartient à ce Project, qui ne peut donc pas être retiré en toute sécurité. Archivez-le plutôt pour conserver le Project, la mémoire, les fichiers et les chats.",
  archiveInsteadManaged:
    "Ce Project possède encore un chat avec worktree géré ; son dossier de travail ne peut pas être dissocié en toute sécurité. Archivez-le plutôt ou supprimez définitivement ce chat d’abord.",
  archiveInsteadBoth:
    "Ce Project possède une Project Base et une mémoire de groupe partagée ; il ne peut pas être retiré en toute sécurité. Archivez-le plutôt pour conserver toutes ses données.",
  archiveInsteadConfirm: "Archiver le Project",
  archive: workspaceCopy.project.archive,
  hideAppProject: "Masquer dans Projects",
  archiveTitle: workspaceCopy.project.archiveTitle,
  archiveDescription:
    "« {{name}} » et ses {{chats}} chats quitteront la Sidebar. Restaurez-les ou supprimez-les définitivement dans Settings › Archive ; les dossiers de travail externes ou liés à une App ne sont jamais supprimés.",
  archiveRootBases: "Bases racine archivées avec lui : {{bases}}.",
  appearance: workspaceCopy.project.appearance,
};
