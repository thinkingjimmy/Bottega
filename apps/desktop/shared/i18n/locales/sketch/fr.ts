/**
 * [INPUT]: Defines pure fr Sketch interface copy.
 * [OUTPUT]: Provides sketchFr for editor and attachment lifecycle messages.
 * [POS]: Feature locale leaf assembled by the matching language catalog.
 */
export const sketchFr = {
  title: "Croquis",
  description: "Dessinez une image pour votre message.",
  done: "Terminer",
  processing: "Traitement du croquis",
  discardTitle: "Abandonner les modifications ?",
  discardDescription: "Vos modifications ne seront pas enregistrées.",
  continueEditing: "Continuer à modifier",
  discardChanges: "Abandonner",
  edit: "Cliquer pour modifier le croquis",
  select: "Sélection",
  pen: "Crayon",
  text: "Texte",
  shapeTool: "Formes",
  eraser: "Gomme",
  undo: "Annuler",
  redo: "Rétablir",
  canvas: "Canevas du croquis",
  canvasHelp:
    "Dessinez ou sélectionnez. Les flèches déplacent, Suppr supprime, Commande ou Contrôle Z annule.",
  penWidth: "Épaisseur du crayon",
  eraserWidth: "Diamètre de la gomme",
  color: "Couleur {{value}}",
  customColor: "Couleur personnalisée",
  sampleColor: "Prélever sur le canevas",
  red: "Rouge",
  green: "Vert",
  blue: "Bleu",
  textInput: "Texte du croquis",
  busyErasing: "Finalisation de l’effacement…",
  historyTrimmed: "Les anciennes étapes d’annulation ont été effacées.",
  error: "Impossible de terminer cette action. Réessayez.",
  empty: "Ajoutez d’abord du contenu au croquis.",
  sourceMissing:
    "La source modifiable est indisponible. Le croquis est conservé.",
  ownerExpired: "Ce chat n’est plus disponible.",
  readOnly: "Ce chat ne peut pas être modifié pour le moment.",
  versionChanged:
    "Cette pièce jointe a changé. Fermez puis ouvrez sa dernière version.",
  migrationActive: "Attendez la fin du déplacement de fenêtre, puis réessayez.",
  editorActive: "Terminez ou fermez d’abord le croquis.",
  attachmentLimit: "Un message accepte jusqu’à 8 pièces jointes directes.",
  imageTooLarge: "Le PNG dépasse 8 Mio. Réduisez le contenu et réessayez.",
  budget:
    "Cette action dépasse la limite d’édition. Votre travail est conservé.",
  resizeBudget:
    "Cet agrandissement dépasse la limite d’édition. Réduisez la taille.",
  eraseBudget:
    "Cet effacement dépasse la limite de traitement. Le contenu précédent est conservé. Réduisez la forme ou le contenu et réessayez.",
  exportFailed:
    "Impossible de créer le PNG. Votre croquis est conservé ; réessayez.",
  workerFailed: "Impossible d’effacer. Le croquis est inchangé ; réessayez.",
  textOverflow:
    "Le texte dépasse du canevas. Raccourcissez-le ou annulez cette édition pour le déplacer ou le réduire.",
  handle: "Redimensionner {{direction}}",
  shape: {
    line: "Ligne",
    arrow: "Flèche",
    rectangle: "Rectangle",
    circle: "Cercle",
    triangle: "Triangle",
    diamond: "Losange",
    star: "Étoile",
    heart: "Cœur",
  },
};
