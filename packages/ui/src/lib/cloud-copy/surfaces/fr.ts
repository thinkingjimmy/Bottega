/**
 * [INPUT]: The App GUI entry states of TASK-22 (approved copy, 2026-09-27) with {{app}} and {{computer}} placeholders.
 * [OUTPUT]: French App GUI entry copy.
 * [POS]: Cloud copy catalog for the App GUI entry (TASK-21 artboard 11); the state keys match Cloud Web's SurfaceStatus.
 */
import type { CloudSurfaceCopy } from "./en";
export const fr: CloudSurfaceCopy = {
  "open": "Ouvrir l’App",
  "appsDescription": "Ouvrez les Apps synchronisées ou consultez et modifiez leurs données.",
  "yourComputer": "votre ordinateur",
  "loading": "Ouverture de {{app}}…",
  "updated": "Dernière version de {{app}} chargée.",
  "expiredTitle": "Cette vue a expiré",
  "expiredBody": "{{app}} est resté inactif un moment. Rechargez pour continuer.",
  "reload": "Recharger",
  "staleTitle": "Une nouvelle version est prête",
  "staleBody": "{{app}} a été mis à jour sur {{computer}}. Rechargez pour l’utiliser.",
  "missingTitle": "{{app}} n’est pas encore synchronisé",
  "missingBody": "Certains fichiers de {{computer}} ne sont pas encore arrivés. Réessayez dans un instant.",
  "tryAgain": "Réessayer",
  "unsupportedTitle": "Ouvrez {{app}} sur votre ordinateur",
  "unsupportedBody": "Cette App utilise un ancien format qui ne fonctionne pas sur le web.",
  "offlineTitle": "{{computer}} est hors ligne",
  "offlineBody": "{{app}} sera disponible ici dès que {{computer}} sera en ligne et l’aura synchronisé.",
  "revokedTitle": "{{app}} n’est plus disponible",
  "revokedBody": "Elle a été supprimée, ou ce compte n’y a plus accès.",
  "failedTitle": "Impossible d’ouvrir {{app}}",
  "failedBody": "Un problème est survenu pendant le chargement."
};
