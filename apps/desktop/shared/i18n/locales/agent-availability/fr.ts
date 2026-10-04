/**
 * [INPUT]: Depends on the shared availability state vocabulary.
 * [OUTPUT]: Provides localized Agent availability and recovery copy.
 * [POS]: Availability locale leaf.
 */
export const agentAvailabilityFr = {
  "state": {
    "recent-sign-in": "Connexion requise récemment",
    "connection": "Problème de connexion",
    "service": "Problème de service",

    "ready": "Prêt",
    "custom-route": "Point de terminaison personnalisé · connexion non vérifiée",
    "unverified": "Non vérifié",
    "checking": "Vérification",
    "missing": "Non installé",
    "unsupported": "Mise à jour disponible",
    "sign-in": "Non connecté",
    "cannot-check": "Vérification impossible",
    "cannot-start": "Démarrage impossible",
    "usage-limit": "Limite atteinte",
    "unavailable": "Indisponible"
  },
  "unavailableReason": {
    "package-disabled": "Désactivé dans Plugins",
    "package-removed": "Supprimé de cet ordinateur",
    "package-refused": "Chargement impossible",
    "trust-refused": "Non approuvé sur cet ordinateur"
  },
  "imagesPreserved": "Cet Agent ne peut pas envoyer ces images. Vos pièces jointes sont conservées.",
  "managementUnavailable": "Ouvrez la fenêtre principale pour gérer les Agents.",
  "openMenu": "Ouvrir le menu Agent",
  "manage": "Gérer les Agents",
  "login": "Se connecter",
  "retry": "Réessayer",
  "locked": "Cet Agent ne peut pas être changé dans ce chat.",
  "blocked": "{{backend}} est indisponible. Votre brouillon est conservé.",
  "retrySending": "Réessayer l’envoi",
  "retryExplanation": "Déjà connecté ou résultat incorrect ? Essayez d’envoyer ce message.",
  "customRoute": "{{backend}} envoie les requêtes vers un point de terminaison que vous avez configuré. Bottega ne peut pas vérifier que la connexion y fonctionne ; si une requête échoue, la raison sera indiquée.",
  "isolatedConfig": "Bottega exécute {{backend}} avec sa propre configuration. Les fournisseurs configurés dans ~/.config/opencode ou dans le fichier opencode.json d’un projet ne sont pas utilisés ici.",
  "unverifiedReason": {
    "provider-scoped": "{{backend}} vérifie la connexion par projet ; elle est donc confirmée lorsqu’un Chat s’exécute.",
    "not-supported": "{{backend}} ne peut pas indiquer son état de connexion à Bottega. S’il faut vous connecter, le Chat vous le dira."
  }
};
