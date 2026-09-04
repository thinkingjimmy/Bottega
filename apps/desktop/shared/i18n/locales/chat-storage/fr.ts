/**
 * [INPUT]: Depends on the English Chat-storage catalog shape
 * [OUTPUT]: Provides French Chat-storage failure copy
 * [POS]: French leaf for user-facing Chat-storage failures
 */

import { chatStorageEn } from "./en";

export const chatStorageFr: typeof chatStorageEn = {
  technicalDetails: "Détails techniques",
  copyDetails: "Copier les détails techniques",
  copiedDetails: "Détails techniques copiés",
  reportIssue: "Signaler sur GitHub",
  warningResolution: "Redémarrez Bottega. Si cela continue d’apparaître, signalez-le sur GitHub pour que nous puissions l’examiner.",
  code: {
    "file-quarantined": {
      title: "Un Chat est temporairement indisponible",
      explanation: "Bottega n’a pas pu lire ce Chat. Le fichier d’origine a été conservé et ignoré. Vos autres Chats ne sont pas affectés.",
      resolution: "Mettez Bottega à jour et redémarrez-le. Si le problème persiste, conservez la sauvegarde et copiez les détails techniques pour le support.",
    },
    "backup-failed": {
      title: "Un Chat n’a pas pu être lu ni sauvegardé",
      explanation: "Bottega s’est arrêté sans modifier le fichier afin d’éviter toute perte de données supplémentaire.",
      resolution: "Vérifiez l’espace disque et les autorisations, puis redémarrez Bottega. Si le problème persiste, copiez les détails techniques pour le support.",
    },
    "recovery-conflict": {
      title: "Des copies de Chat ne peuvent pas être restaurées en toute sécurité",
      explanation: "Bottega ne peut pas déterminer quelle copie est correcte et n’a donc écrasé ni supprimé aucun fichier.",
      resolution: "Conservez les fichiers et copiez les détails techniques pour le support avant toute modification manuelle.",
    },
    "self-check-failed": {
      title: "L’autocontrôle des Chats a échoué",
      explanation: "Bottega vérifie régulièrement la cohérence de sa base de Chats. Cette vérification a signalé un problème, mais vos Chats restent lisibles et Bottega n’a modifié aucune donnée.",
      resolution: "Redémarrez Bottega pour relancer la vérification. Si cela continue d’apparaître, signalez-le sur GitHub ; les détails techniques sont joints automatiquement.",
    },
  },
};
