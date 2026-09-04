/**
 * [INPUT]: Depends on the English Agent failure catalog shape
 * [OUTPUT]: Provides French Agent failure presentation copy
 * [POS]: French leaf for provider-neutral Agent failures
 */

import { agentFailureEn } from "./en";

export const agentFailureFr: typeof agentFailureEn = {
  technicalDetails: "Détails techniques",
  copyDetails: "Copier les détails techniques",
  copiedDetails: "Détails techniques copiés",
  code: {
    "auth-required": { title: "Reconnectez-vous à {{backend}}", explanation: "Votre connexion a expiré ou n’a pas été terminée.", resolution: "Exécutez `{{command}}` dans un terminal, terminez la connexion, puis revenez dans Bottega et réessayez." },
    "rate-limited": { title: "{{backend}} reçoit trop de requêtes", explanation: "Le fournisseur limite temporairement les nouvelles requêtes.", resolution: "Patientez un instant et réessayez. Si le problème persiste, vérifiez le réseau et l’état du fournisseur." },
    "quota-exhausted": { title: "{{backend}} n’a plus d’utilisation disponible", explanation: "Le compte a atteint sa limite ou ne dispose plus de solde.", resolution: "Vérifiez l’offre, l’utilisation et la facturation, ou attendez l’heure de réinitialisation affichée." },
    "context-exhausted": { title: "Cette conversation est trop longue pour continuer", explanation: "L’Agent a atteint la limite de contexte ou de session de cette conversation.", resolution: "Démarrez un nouveau Chat avec une demande plus courte et moins de fichiers ou de texte collé." },
    "connection-lost": { title: "La connexion à {{backend}} a été interrompue", explanation: "Bottega n’a pas pu maintenir une connexion stable avec l’Agent.", resolution: "Vérifiez Internet, le VPN et le proxy, puis réessayez quand la connexion est stable." },
    "request-rejected": { title: "{{backend}} ne peut pas traiter cette demande", explanation: "Le modèle, la configuration ou la demande n’a pas été accepté.", resolution: "Choisissez un modèle disponible, vérifiez les réglages de l’Agent et simplifiez la demande." },
    "service-unavailable": { title: "{{backend}} est temporairement indisponible", explanation: "L’Agent ou le fournisseur de modèle a signalé un problème temporaire.", resolution: "Réessayez plus tard. Si le problème persiste, mettez l’Agent à jour et copiez les détails techniques pour le support." },
    "runtime-unavailable": { title: "Impossible de démarrer {{backend}}", explanation: "L’Agent local est absent, obsolète ou a échoué au contrôle de démarrage.", resolution: "Ouvrez les réglages de l’Agent, installez ou mettez à jour {{backend}}, puis relancez le contrôle." },
    unknown: { title: "{{backend}} n’a pas pu terminer la demande", explanation: "L’Agent a signalé un problème que Bottega ne peut pas classer de façon sûre.", resolution: "Réessayez une fois. Si cela se reproduit, ouvrez et copiez les détails techniques pour le support." },
  },
  notice: {
    title: "{{backend}} a envoyé un avis",
    explanation: "Cet avis provient de {{backend}} lui-même, pas de Bottega. Cette réponse n’est pas affectée.",
  },
};
