/**
 * [INPUT]: Depends on the settingsToolsEn structural type
 * [OUTPUT]: Provides settingsToolsFr, the French Settings Tools catalog
 * [POS]: French leaf of shared/i18n/locales/settings/tools; loaded on demand by the matching top-level locale
 */

import type { settingsToolsEn } from "./en";

export const settingsToolsFr: typeof settingsToolsEn = {
  globalScopeNote: "Ces réglages sont globaux. Chaque Project peut les remplacer sans modifier cette page.",
  supportReason: {
    "runtime-unavailable": "Runtime indisponible", "builtin-tools-unsupported": "Outils intégrés non pris en charge", "transport-unsupported": "Transport non pris en charge",
    "turn-origin-unsupported": "Indisponible pour cette origine de tour", "plan-mode-unsupported": "Indisponible dans les tours Plan", "security-policy": "Bloqué par la politique de sécurité", unknown: "Backend indisponible",
    minimumRuntimeVersion: "Nécessite le runtime {{minimumVersion}} ou ultérieur (détecté : {{detectedVersion}})", unknownVersion: "version inconnue",
  },
  builtin: {
    title: "Outils intégrés", saveFailed: "Impossible d’enregistrer le réglage de l’outil intégré", disabledCount: "{{count}} désactivés",
    globalDescription: "Les valeurs globales s’appliquent au prochain tour ; chaque Project peut remplacer chaque outil.",
    projectDescription: "Choisissez l’intention de ce Project pour chaque outil. Réinitialiser restaure la valeur globale.",
    resetAll: "Réinitialiser tous les remplacements du Project", resetOne: "Réinitialiser {{name}} à la valeur globale",
    source: { "global-default": "Valeur globale", "project-override": "Remplacement du Project" },
    effective: { enabled: "Activé", disabled: "Désactivé", unavailable: "Intention activée ; Backend indisponible" },
    domain: { sections: "Sections", subagents: "Sous-agents", projects: "Projects", bases: "Bases", search: "Recherche", browser: "Browser", design: "Design", apps: "Apps" },
    items: {
      list_sections: { label: "Lister les Sections", hint: "Afficher tous les Chats persistants et leur résumé Base." },
      read_section: { label: "Lire une Section", hint: "Lire la transcription enregistrée d’un autre Chat." },
      send_to_section: { label: "Envoyer à une Section", hint: "Mettre un message en file pour un autre Chat et démarrer son Agent." },
      create_section: { label: "Créer une Section", hint: "Créer un Chat collaboratif visible et persistant." },
      promote_result_to_section: { label: "Promouvoir le résultat du sous-agent", hint: "Transformer un résultat de sous-agent détenu par ce tour en Section inactive ; un appel tardif ne récupère qu’une copie tronquée." },
      export_attachment: { label: "Exporter une pièce jointe", hint: "Exporter les images du message sur cet ordinateur ; réservé aux tours humains." },
      spawn_subagent: { label: "Démarrer un sous-agent", hint: "Déléguer une sous-tâche ponctuelle dans ce tour et attendre son résultat." },
      convert_chat_to_project: { label: "Convertir le Chat en Project", hint: "Promouvoir le Chat actuel en Project ; réservé aux tours humains Codex ou Claude." },
      base_describe: { label: "Décrire la Base", hint: "Lire les métadonnées, colonnes et revision d’une Base." },
      read_base: { label: "Lire une Base", hint: "Filtrer, trier et paginer les lignes d’une Base : celle de ce chat, celle d’une autre Section ou celle d’une App attachée." },
      base_export_csv: { label: "Exporter la Base en CSV", hint: "Exporter les résultats d’une requête Base en CSV." },
      base_set_view: { label: "Définir la vue Base", hint: "Mettre à jour la configuration de la vue Base actuelle." },
      base_update_columns: { label: "Modifier les colonnes Base", hint: "Renommer ou ajuster les colonnes existantes." },
      base_add_columns: { label: "Ajouter des colonnes Base", hint: "Ajouter de nouvelles colonnes à une Base." },
      base_insert_rows: { label: "Insérer des lignes Base", hint: "Insérer des lignes dans la Base actuelle ou celle d’une App attachée." },
      base_patch_rows: { label: "Modifier des lignes Base", hint: "Mettre à jour les lignes d’une Base par champ." },
      base_delete_rows: { label: "Supprimer des lignes Base", hint: "Supprimer les lignes indiquées d’une Base." },
      search_chat_history: { label: "Rechercher dans l’historique", hint: "Trouver titres et transcriptions dans toutes les Sections." },
      read_chat_history: { label: "Lire cet historique", hint: "Lire les messages précédents enregistrés dans ce chat." },
      search_bases: { label: "Rechercher dans les Bases", hint: "Trouver noms, colonnes et texte des cellules parmi les propriétaires de Base." },
      browser_open: { label: "Ouvrir une page web", hint: "Ouvrir une page HTTP(S) ; indisponible dans les tours Plan." },
      browser_snapshot: { label: "Lire l’instantané web", hint: "Lire l’arbre d’accessibilité ; indisponible dans les tours Plan." },
      browser_act: { label: "Agir sur une page web", hint: "Exécuter un lot d’actions web ; indisponible dans les tours Plan." },
      browser_tabs: { label: "Lister les onglets web", hint: "Afficher les onglets visibles et ceux de cette Section ; indisponible dans les tours Plan." },
      browser_close: { label: "Fermer un onglet web", hint: "Fermer un onglet appartenant à cette Section ; indisponible dans les tours Plan." },
      design_render_check: { label: "Vérifier le rendu Design", hint: "Rendre le canevas Design actuel et renvoyer une capture avec les avertissements anti-slop." },
      validate_app: { label: "Valider l’App", hint: "Valider le package actuel dans une session d’édition d’App." },
    },
  },
  mcp: {
    title: "Serveurs MCP", add: "Ajouter un serveur", edit: "Modifier", delete: "Supprimer {{name}}", emptyTitle: "Aucun serveur MCP", addTitle: "Ajouter un serveur MCP", editTitle: "Modifier le serveur MCP", dialogDescription: "Seul stdio est pris en charge et la commande doit être un chemin absolu. Après enregistrement, le serveur entier est injecté au prochain tour humain non Plan.", name: "Nom", command: "Chemin absolu de la commande", args: "Arguments (un par ligne)", environment: "Variables d’environnement", addVariable: "Ajouter une variable", envName: "Nom de variable d’environnement", envNewValue: "Nouvelle valeur de {{name}}", envFallbackName: "variable d’environnement", retainValue: "Laisser vide pour conserver la valeur", value: "Valeur", removeVariable: "Supprimer {{name}}", envNameRequired: "Le nom de la variable ne peut pas être vide", envValueRequired: "Saisissez une nouvelle valeur pour {{name}}", descriptionLine: "{{transport}} · {{target}} · {{eligibility}} · {{health}}",
    globalDescription: "Gérez les serveurs MCP globaux. Les Projects peuvent les hériter ou les remplacer sans modifier cette liste.",
    projectDescription: "Les serveurs du Project lui sont privés. Les serveurs globaux hérités peuvent être remplacés ici.",
    globalEmptyHint: "Ajoutez ici un serveur global. Les serveurs propres aux Projects n’apparaissent jamais sur cette page.",
    bridgeMissing: "Les réglages des serveurs MCP sont indisponibles dans cet environnement.",
    projectGroup: "Serveurs du Project", projectGroupEmpty: "Aucun serveur propre au Project",
    inheritedGroup: "Serveurs globaux hérités", inheritedGroupEmpty: "Aucun serveur global à hériter",
    allInherited: "Ce Project utilise actuellement uniquement les réglages globaux hérités.",
    editGlobally: "Modifier les serveurs MCP globaux dans Settings", resetOne: "Réinitialiser {{name}} à la valeur globale",
    conflict: "Le serveur a changé ailleurs. Le dernier état a été chargé et votre brouillon est conservé.",
    source: { "global-default": "Valeur globale", "project-override": "Remplacement du Project", "project-owned": "Propre au Project" },
    effective: { enabled: "Activé", disabled: "Désactivé", unavailable: "Intention activée ; Backend indisponible" },
    eligibility: { eligible: "Actif au prochain tour humain non Plan", "remote-policy-unsupported": "Les canaux Remote ne sont pas encore disponibles", "authenticated-remote-unsupported": "Remote authentifié avec headers statiques non pris en charge", "query-remote-unsupported": "URL remote avec paramètres query non prise en charge" },
    health: { unobserved: "État non observé", healthy: "Protocole réussi", degraded: "Échec du protocole, nouvelle tentative en attente", quarantined: "État du processus inconnu, mis en quarantaine" },
  },
};
