/**
 * [INPUT]: Depends on no runtime modules
 * [OUTPUT]: Provides localized Agent selection, pending, eligibility, and retained-history disclosure
 * [POS]: Chat Agent switch locale leaf
 */

export const chatAgentSwitchFr = {
  "pending": "{{backend}} répondra au prochain message. L’historique reste ici.",
  "undo": "Annuler",
  "details": "Détails de reprise",
  "explanation": "Le nouvel Agent reçoit des extraits et peut lire les enregistrements conservés si cet outil est disponible. Les anciennes images et l’état des outils ne sont pas transmis.",
  "permission": "Autorisation : {{from}} → {{to}}",
  "confirming": "Confirmation de l’envoi…",
  "recovering": "Message enregistré. Récupération…",
  "stale": "Cette conversation a changé. Choisissez à nouveau l’Agent.",
  "adjacent": "Envoyez un nouveau message ou annulez le changement d’Agent.",
  "defaultsFailed": "Options enregistrées ; échec de la mise à jour des valeurs par défaut.",
  "divider": "À partir d’ici, {{backend}} répond",
  "notInjected": "Une partie de l’historique n’a pas été incluse. Les enregistrements conservés peuvent être consultables.",
  "storageTrimmed": "Certains anciens enregistrements ne sont plus conservés.",
  "lookupUnavailable": "La lecture de l’historique est indisponible pour ce tour.",
  "running": "Attendez la fin de la réponse.",
  "queue": "Traitez les messages en attente.",
  "recovery": "Terminez la récupération.",
  "readonly": "Cette conversation est en lecture seule. Reprenez-la avec l’Agent source.",
  "app-bound": "Cet Agent est défini par l’App.",
  "archived": "Une conversation archivée ne peut pas changer d’Agent.",
  "approval": "Traitez la demande d’approbation.",
  "plan-review": "Terminez la révision du Plan.",
  "paused": "Reprenez ou terminez la chaîne en pause.",
  "submission": "Confirmez le résultat du dernier envoi.",
  "selectionFailed": "Échec de sélection de l’Agent : {{message}}",
  "revision-stale": "Cette conversation a changé. Choisissez à nouveau l’Agent."
};
