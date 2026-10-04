/**
 * [INPUT]: No runtime dependencies; translated Dock plugin copy.
 * [OUTPUT]: Provides dock catalog strings for fr.
 * [POS]: Nested workbench plugin catalog, consumed by Dock cards, settings and health.
 */
export const dock = {
  "name": "Bottega Dock",
  "summary": "Raccourcis d’Apps et widgets d’utilisation à côté du Dock macOS. Désactivé par défaut.",
  "description": "Le Bottega Dock se place à côté du Dock macOS, avec des raccourcis vers vos Apps et des widgets d’utilisation.\n\nIl est désactivé par défaut. Configurez-le pour choisir son apparence et quand il s’affiche.",
  "running": "Le Dock est actif",
  "off": "Désactivé",
  "loading": "Vérification du Dock…",
  "unsupported": "Indisponible sur cet ordinateur",
  "recoveryPending": "La restauration nécessite votre attention. Réessayez la restauration dans les réglages du Dock.",
  "coexist": "À côté du Dock système",
  "replace": "Remplace le Dock système",
  "replacementPending": "Indisponible en 0.2.0 ; validation de sécurité en attente",
  "autohide": "Masquer automatiquement",
  "pinned": "Toujours visible",
  "settings": {
    "showHandle": "Afficher la poignée",
    "privacyMask": "Masquer les valeurs sensibles",
    "showRunning": "Afficher les Apps ouvertes",
    "scale": "Taille",
    "visibility": "Visibilité"
  },
  "labels": {
    "mode": "Mode",
    "phase": "État d’exécution",
    "registration": "Agent de restauration",
    "accessibility": "Accessibilité",
    "automation": "Automatisation Finder",
    "recovery": "Dernière restauration",
    "sync": "Synchronisation du Dock",
    "replacement": "Mode de remplacement"
  },
  "phase": {
    "inactive": "Inactif",
    "preparing": "Préparation",
    "active": "Actif",
    "restoring": "Restauration",
    "suspended": "En pause"
  },
  "registration": {
    "notRegistered": "Non enregistré",
    "enabled": "Enregistré",
    "requiresApproval": "En attente d’autorisation",
    "notFound": "Service de restauration absent",
    "unsupported": "Indisponible dans cette version",
    "unknown": "Enregistrement non vérifié"
  },
  "permission": {
    "granted": "Autorisé",
    "notGranted": "Non autorisé",
    "unsupported": "Non vérifié",
    "unknown": "Non vérifié",
    "needsPrompt": "Demander lors de l’utilisation",
    "denied": "Refusé",
    "unavailable": "Indisponible"
  },
  "recovery": {
    "none": "Aucune restauration enregistrée",
    "restored": "Restauré",
    "keptExternal": "Vos modifications système ont été conservées",
    "failed": "Restauration non confirmée"
  },
  "sync": {
    "localOnly": "Local uniquement",
    "synced": "Synchronisé ; continue lorsque le Dock est désactivé",
    "pending": "Modifications en attente",
    "offline": "Hors ligne ; disposition conservée localement",
    "conflict": "Modifications à vérifier",
    "blocked": "Synchronisation indisponible",
    "error": "Échec de synchronisation ; disposition conservée"
  },
  "unsupportedReason": {
    "platform": "Nécessite macOS 15 ou ultérieur",
    "architecture": "Nécessite une puce Apple",
    "osVersion": "Nécessite macOS 15 ou ultérieur",
    "helperMissing": "Le programme auxiliaire du Dock est absent. Réinstallez Bottega."
  },
  "effects": {
    "restore": "Restaurer le Dock système avant l’arrêt.",
    "unregister": "Désenregistrer l’agent après confirmation de la restauration.",
    "hide": "Masquer le Dock, son menu et ses widgets. Conserver la disposition et continuer la synchronisation si disponible."
  },
  "capabilities": {
    "launch": "Ouvre les Apps et raccourcis système sur ce Mac",
    "usage": "Lit les données locales d’utilisation et de quota",
    "sync": "Maintient la synchronisation même lorsque le Dock est désactivé",
    "permissions": "Les autorisations facultatives d’accessibilité et d’automatisation Finder restent sous votre contrôle"
  }
};
