/**
 * [INPUT]: Fixed seven-day client search and measured incomplete-cache states.
 * [OUTPUT]: Shared localized command groups, search, coverage and refresh-protection copy.
 * [POS]: Cloud copy catalog; index progress never implies that chat drafts are saved.
 */
import type { CloudSearchCopy } from "./en";
export const fr: CloudSearchCopy = {
  "results": "Résultats",
  "actions": "Actions rapides",
  "label": "Rechercher des discussions",
  "placeholder": "Mots à rechercher",
  "scope": "Rechercher les titres et les messages des 7 derniers jours.",
  "preparing": "Préparation de la recherche sur les 7 derniers jours. Les résultats peuvent être incomplets.",
  "updating": "Mise à jour de la recherche. Les résultats peuvent être incomplets.",
  "ready": "La recherche est prête.",
  "limited": "La couverture est incomplète : certaines dates manquent ou certains contenus dépassent les limites de ressources actuelles.",
  "paused": "La recherche est en pause. Connectez-vous et réessayez.",
  "storageFailed": "Le cache de recherche chiffré n’a pas pu être enregistré. La recherche reste disponible sur cette page, mais une actualisation peut nécessiter une reconstruction.",
  "unsaved": "La recherche est en préparation. Une actualisation peut nécessiter de retraiter la progression non enregistrée.",
  "progress": "{titles} titres · {messages} messages indexés",
  "searching": "Recherche…",
  "empty": "Aucun résultat.",
  "emptyPartial": "Aucun résultat dans le contenu déjà préparé. La recherche est encore incomplète.",
  "resultsLimited": "Affichage des 100 premiers résultats. Ajoutez des mots pour affiner la recherche.",
  "stale": "Ce résultat a changé ou n’est plus accessible. Relancez la recherche.",
  "retry": "Réessayer la préparation",
  "untitled": "Discussion sans titre",
  "titleHit": "Titre de discussion",
  "messageHit": "Message",
  "queryInvalid": "Utilisez au maximum 256 caractères et 16 mots."
};
