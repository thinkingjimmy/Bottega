/**
 * [INPUT]: The shared encrypted-sync copy contract.
 * [OUTPUT]: French setup, creation requirement checklist, immediate password validation, unlock and recovery messages.
 * [POS]: Shared desktop and Web encryption presentation.
 */
import type { CloudEncryptionCopy } from "./en";
export const fr: CloudEncryptionCopy = {
  setupInProgress: "Activation de la synchronisation…", setupConnectionFailed: "La connexion a échoué. Vérifiez votre réseau et réessayez.",
  title: "Déverrouiller l’espace synchronisé", description: "Saisissez le mot de passe de synchronisation défini sur votre ordinateur.", password: "Mot de passe de synchronisation", confirmation: "Confirmer le mot de passe",
  setPassword: "Définir un mot de passe de synchronisation", setupDescription: "Ce mot de passe est distinct de celui du compte Google. Ni Bottega ni Google ne peuvent le récupérer.",
  risk: "Je comprends que si ce mot de passe est perdu et qu’aucun appareil ne peut encore déchiffrer les données, le contenu stocké uniquement dans le cloud peut être irrécupérable.", inProgress: "Protection de la synchronisation…",
  unlock: "Déverrouiller", unlocking: "Déverrouillage…", checking: "Vérification de la synchronisation chiffrée…", remember: "Garder ce navigateur déverrouillé",
  rememberDescription: "Enregistrez une clé de déverrouillage chiffrée dans ce navigateur. Vous pourrez le verrouiller à tout moment.", remembered: "Ce navigateur conservera la clé de déverrouillage.", thisPageOnly: "Déverrouillé pour cette page uniquement.",
  saving: "Enregistrement de la clé…", saveFailed: "L’espace est déverrouillé, mais la clé n’a pas pu être enregistrée. Le mot de passe pourra être requis à la prochaine ouverture.", lastInputLost: "Les dernières frappes avant le passage en arrière-plan n’ont pas pu être enregistrées. Vérifiez le message que vous écriviez.", lastInputLostDismiss: "Fermer", saveRetry: "Réessayer d’enregistrer la clé",
  cachedStorageUnavailable: "Le stockage local sécurisé est indisponible. Le mot de passe pourra être requis à la réouverture de l’application.", cacheUnreadable: "La clé enregistrée est illisible. Saisissez votre mot de passe de synchronisation.",
  cacheClearFailed: "La clé enregistrée n’a pas pu être supprimée. Réessayez pour retirer l’accès mémorisé de ce navigateur.", lock: "Verrouiller ce navigateur", locked: "L’espace synchronisé est verrouillé",
  offlineTitle: "Connectez-vous pour déverrouiller l’espace", offlineDescription: "Le navigateur doit vérifier le compte avant de déverrouiller le contenu enregistré. Le cache chiffré est conservé.",
  unavailable: "La synchronisation chiffrée n’a pas pu être vérifiée. Réessayez.",
  reviewExpired: "Cette vérification a expiré. Relancez l’analyse.", connectionFailed: "Votre connexion est indisponible. La synchronisation chiffrée reprendra une fois en ligne.", retry: "Réessayer", cancel: "Annuler", account: "Compte et appareils",
  showPassword: "Afficher le mot de passe", hidePassword: "Masquer le mot de passe", passwordMismatch: "Les mots de passe ne correspondent pas.", confirmationMatches: "Les mots de passe correspondent", independentPassword: "Ce mot de passe est distinct de celui de Google et sert uniquement à déverrouiller le contenu synchronisé.",
  secureSaveFailedDesktop: "La clé n’a pas pu être enregistrée de façon sécurisée sur cet ordinateur. La synchronisation reste désactivée. Réessayez l’enregistrement avant de l’activer.",
  legacyUnsupported: "Ce compte contient encore des données de l’ancien format de synchronisation. Elles doivent être traitées avant d’activer la synchronisation chiffrée.",
  passwordTooShort: "Utilisez au moins 8 caractères.",
  passwordTooLong: "Utilisez au plus 1 024 octets UTF-8. Certains caractères occupent plusieurs octets.",
  passwordRules: "Exigences du mot de passe", ruleMet: "respectée", ruleUnmet: "non respectée",
  ruleLength: "Au moins 12 caractères", ruleLetter: "Au moins une lettre", ruleDigit: "Au moins un chiffre",
  ruleSimple: "Évitez les caractères répétés ou consécutifs", ruleEmail: "N’incluez pas le nom de votre adresse e-mail", ruleCommon: "Évitez les mots de passe courants et « Bottega »",
  "sync-password-invalid": "Utilisez au moins 8 caractères et au plus 1 024 octets UTF-8. Certains caractères occupent plusieurs octets.",
  "sync-password-weak": "Choisissez un mot de passe plus robuste qui respecte toutes les exigences.",
  "sync-unlock-failed": "Ce mot de passe n’a pas permis de déverrouiller l’espace. Vérifiez-le et réessayez.", "sync-integrity-failed": "Ce contenu chiffré n’a pas pu être vérifié. Rechargez sa version récente.",
  "sync-encryption-unsupported": "Le chiffrement requis est indisponible sur ce navigateur ou appareil. Utilisez Chrome à jour ou Bottega sur ordinateur.",
  "sync-space-changed": "L’espace chiffré ou sa clé a changé. L’accès est suspendu ; vérifiez le compte et les informations de restauration.",
  "sync-operation-cancelled": "Déverrouillage annulé.", "sync-operation-busy": "Une autre opération de chiffrement est en cours. Patientez ou annulez-la.", "sync-locked": "Déverrouillez l’espace synchronisé pour continuer.",
  checkingDescription: "Recherche de l’espace chiffré de ce compte.",
  unavailableTitle: "Impossible de vérifier la synchronisation chiffrée", unavailableDescription: "Réessayez pour vérifier à nouveau. Votre connexion est conservée.",
  unsupportedTitle: "Ce navigateur ne peut pas exécuter la synchronisation chiffrée", lockFailedTitle: "Le verrouillage n’a pas abouti",
  cancelledDescription: "Déverrouillage annulé. Saisissez votre mot de passe de synchronisation pour réessayer.",
  lockedDescription: "Ce navigateur est verrouillé. Saisissez votre mot de passe de synchronisation pour continuer.",
  missingUnlock: "Ce navigateur n’a aucune information de déverrouillage enregistrée. Saisissez votre mot de passe de synchronisation.",
};
