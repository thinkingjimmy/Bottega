/**
 * [INPUT]: Depends on the Memory plugin metadata, settings and pause impact contracts.
 * [OUTPUT]: Provides fr copy for the official Memory plugin.
 * [POS]: Localized Memory feature copy within the workbench catalog.
 */
export const memoryPluginCopy = {
  "name": "Memory",
  "summary": "Retrouvez le contexte utile des chats dans le périmètre de partage choisi.",
  "description": "Memory retient le contexte utile de vos chats et le ramène quand il sert, comme une décision de la semaine dernière ou votre façon préférée de rédiger un rapport.\n\nVous choisissez jusqu’où il est partagé, dans chaque chat, dans chaque Project ou entre tous les chats. L’extraction utilise le modèle choisi et peut être facturée, donc Bottega demande avant de l’activer. L’historique existant est exclu.",
  "settings": {
    "backend": {
      "label": "Moteur Memory"
    },
    "sharingMode": {
      "label": "Périmètre de partage"
    },
    "phoneFacade": {
      "label": "État et commandes de Memory sur téléphone et Web"
    },
    "workflowRoles": {
      "label": "Autoriser les rôles des workflows à lire Memory"
    }
  },
  "sharing": {
    "chat": "Ce chat",
    "group": "Ce projet",
    "personal": "Tous les chats"
  },
  "capability": {
    "recall": "Retrouver le contexte dans votre périmètre de partage",
    "capture": "Enregistrer le contexte admissible avec votre accord",
    "backfill": "Traiter uniquement l’historique autorisé"
  },
  "confirmation": {
    "title": "Confirmer la modification de Memory",
    "cutover": "Utiliser ce moteur. L’extraction utilise {{model}} sur {{hostname}} et peut entraîner des frais de modèle. L’historique existant est exclu.",
    "chat": "Limiter désormais Memory à chaque chat. L’extraction utilise {{model}} sur {{hostname}} et peut entraîner des frais de modèle. L’historique existant est exclu.",
    "group": "Partager désormais Memory au sein de chaque projet. L’extraction utilise {{model}} sur {{hostname}} et peut entraîner des frais de modèle. L’historique existant est exclu.",
    "personal": "Partager désormais Memory entre tous les chats. L’extraction utilise {{model}} sur {{hostname}} et peut entraîner des frais de modèle. L’historique existant est exclu."
  },
  "effects": {
    "recall": "Suspendre le rappel pour les nouveaux tours des chats et workflows.",
    "capture": "Suspendre la nouvelle capture et conserver les souvenirs enregistrés.",
    "backfill": "Suspendre le traitement habituel de l’historique.",
    "phone": "Suspendre Memory pour les chats sur téléphone et Web.",
    "rebuild": "Une reconstruction déjà autorisée continue et peut entraîner des frais de modèle."
  },
  "health": {
    "backend": "Moteur",
    "version": "Version installée",
    "sharing": "Périmètre de partage",
    "service": "État",
    "directory": "Dossier des données",
    "unknown": "Pas encore connu",
    "unsupported": "Memory est disponible sur macOS.",
    "missing": "Installez le moteur choisi dans les réglages Memory.",
    "configuration": "Terminez la configuration du moteur dans les réglages Memory.",
    "repair": "Vérifiez ou réparez le moteur dans les réglages Memory.",
    "off": "Configurez Memory pour commencer.",
    "paused": "En pause ; les souvenirs enregistrés sont conservés.",
    "ready": "Prêt",
    "checking": "Vérification du moteur…"
  }
};
