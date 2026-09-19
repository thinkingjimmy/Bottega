/**
 * [INPUT]: The shared encrypted-sync copy contract.
 * [OUTPUT]: French setup, immediate password validation, unlock and recovery messages.
 * [POS]: Shared desktop and Web encryption presentation.
 */
import type { CloudEncryptionCopy } from "./en";
export const fr: CloudEncryptionCopy = {
  setupInProgress: "Activation de la synchronisation…", setupConnectionFailed: "La connexion a échoué. Vérifiez votre réseau et réessayez.",
  title: "Déverrouiller l’espace synchronisé", description: "Saisissez le mot de passe de synchronisation défini sur votre ordinateur.", password: "Mot de passe de synchronisation", confirmation: "Confirmer le mot de passe",
  setPassword: "Définir un mot de passe de synchronisation", setupDescription: "Utilisez au moins 8 caractères, dont une lettre de A à Z et un chiffre. Conservez ce mot de passe en lieu sûr ; Bottega ne peut pas le récupérer.",
  risk: "Je comprends que la perte de ce mot de passe peut rendre les données cloud irrécupérables.", inProgress: "Protection de la synchronisation…",
  unlock: "Déverrouiller", unlocking: "Déverrouillage…", checking: "Vérification de la synchronisation chiffrée…", remember: "Garder ce navigateur déverrouillé",
  rememberDescription: "Enregistrez une clé de déverrouillage chiffrée dans ce navigateur. Vous pourrez le verrouiller à tout moment.", remembered: "Ce navigateur conservera la clé de déverrouillage.", thisPageOnly: "Déverrouillé pour cette page uniquement.",
  saving: "Enregistrement de la clé…", saveFailed: "L’espace est déverrouillé, mais la clé n’a pas pu être enregistrée. Le mot de passe pourra être requis à la prochaine ouverture.", saveRetry: "Réessayer d’enregistrer la clé",
  cachedStorageUnavailable: "Le stockage local sécurisé est indisponible. Le mot de passe pourra être requis à la réouverture de l’application.", cacheUnreadable: "La clé enregistrée est illisible. Saisissez votre mot de passe de synchronisation.",
  cacheClearFailed: "La clé enregistrée n’a pas pu être supprimée. Réessayez pour retirer l’accès mémorisé de ce navigateur.", lock: "Verrouiller ce navigateur", locked: "L’espace synchronisé est verrouillé",
  offlineTitle: "Connectez-vous pour déverrouiller l’espace", offlineDescription: "Le navigateur doit vérifier le compte avant de déverrouiller le contenu enregistré. Le cache chiffré est conservé.",
  unavailable: "La synchronisation chiffrée n’a pas pu être vérifiée. Réessayez.",
  reviewExpired: "Cette vérification a expiré. Relancez l’analyse.", connectionFailed: "Votre connexion est indisponible. La synchronisation chiffrée reprendra une fois en ligne.", retry: "Réessayer", cancel: "Annuler", account: "Compte et appareils",
  showPassword: "Afficher le mot de passe", hidePassword: "Masquer le mot de passe", passwordMismatch: "Les mots de passe ne correspondent pas.", independentPassword: "Ce mot de passe est distinct de celui de Google et sert uniquement à déverrouiller le contenu synchronisé.",
  unrecoverableCloud: "Conservez votre mot de passe de synchronisation en lieu sûr. Récupérer votre compte Google ne permet pas de récupérer ce mot de passe. Si vous le perdez et qu’aucun appareil ne peut déchiffrer vos anciennes données, le contenu conservé uniquement dans le cloud sera irrécupérable.",
  secureSaveFailedDesktop: "La clé n’a pas pu être enregistrée de façon sécurisée sur cet ordinateur. La synchronisation reste désactivée. Réessayez l’enregistrement avant de l’activer.",
  legacyUnsupported: "Ce compte contient encore des données de l’ancien format de synchronisation. Elles doivent être traitées avant d’activer la synchronisation chiffrée.",
  passwordTooShort: "Utilisez au moins 8 caractères.",
  "sync-password-invalid": "Utilisez au moins 8 caractères et au plus 1 024 octets UTF-8. Certains caractères occupent plusieurs octets.",
  "sync-password-weak": "Incluez au moins une lettre de A à Z et un chiffre.",
  "sync-unlock-failed": "Ce mot de passe n’a pas permis de déverrouiller l’espace. Vérifiez-le et réessayez.", "sync-integrity-failed": "Ce contenu chiffré n’a pas pu être vérifié. Rechargez sa version récente.",
  "sync-encryption-unsupported": "Le chiffrement requis est indisponible sur ce navigateur ou appareil. Utilisez Chrome à jour ou Bottega sur ordinateur.",
  "sync-space-changed": "L’espace chiffré ou sa clé a changé. L’accès est suspendu ; vérifiez le compte et les informations de restauration.",
  "sync-operation-cancelled": "Déverrouillage annulé.", "sync-operation-busy": "Une autre opération de chiffrement est en cours. Patientez ou annulez-la.", "sync-locked": "Déverrouillez l’espace synchronisé pour continuer.",
  checkingDescription: "Recherche de l’espace chiffré de ce compte.",
  unavailableTitle: "Impossible de vérifier la synchronisation chiffrée", unavailableDescription: "Réessayez pour vérifier à nouveau. Votre connexion est conservée.",
  unsupportedTitle: "Ce navigateur ne peut pas exécuter la synchronisation chiffrée", lockFailedTitle: "Le verrouillage n’a pas abouti",
  cancelledDescription: "Déverrouillage annulé. Saisissez votre mot de passe de synchronisation pour réessayer.",
  lockedDescription: "Ce navigateur est verrouillé. Saisissez votre mot de passe de synchronisation pour continuer.",
  missingUnlock: "Ce navigateur n’a aucune information de déverrouillage enregistrée. Saisissez votre mot de passe de synchronisation.",
};
