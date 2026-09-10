/**
 * [INPUT]: Defines pure es Sketch interface copy.
 * [OUTPUT]: Provides sketchEs for editor and attachment lifecycle messages.
 * [POS]: Feature locale leaf assembled by the matching language catalog.
 */
export const sketchEs = {
  title: "Boceto",
  description: "Dibuja una imagen para tu mensaje.",
  done: "Listo",
  processing: "Procesando el boceto",
  discardTitle: "¿Descartar los cambios?",
  discardDescription: "Tus cambios no se guardarán.",
  continueEditing: "Seguir editando",
  discardChanges: "Descartar cambios",
  edit: "Haz clic para editar el boceto",
  select: "Seleccionar",
  pen: "Lápiz",
  text: "Texto",
  shapeTool: "Formas",
  eraser: "Borrador",
  undo: "Deshacer",
  redo: "Rehacer",
  canvas: "Lienzo del boceto",
  canvasHelp:
    "Dibuja o selecciona. Las flechas mueven, Supr elimina y Comando o Control Z deshace.",
  penWidth: "Grosor del lápiz",
  eraserWidth: "Diámetro del borrador",
  color: "Color {{value}}",
  customColor: "Color personalizado",
  sampleColor: "Tomar color del lienzo",
  red: "Rojo",
  green: "Verde",
  blue: "Azul",
  textInput: "Texto del boceto",
  busyErasing: "Terminando de borrar…",
  historyTrimmed: "Se eliminaron los pasos de deshacer más antiguos.",
  error: "No se pudo completar esta acción. Inténtalo de nuevo.",
  empty: "Primero añade contenido al boceto.",
  sourceMissing:
    "La fuente editable no está disponible. Se ha conservado el boceto.",
  ownerExpired: "Este chat ya no está disponible.",
  readOnly: "Este chat no se puede editar ahora.",
  versionChanged:
    "Este adjunto cambió. Cierra el editor y abre la última versión.",
  migrationActive:
    "Espera a que termine el traslado de ventana e inténtalo de nuevo.",
  editorActive: "Primero termina o cierra el boceto.",
  attachmentLimit: "Un mensaje admite hasta 8 adjuntos directos.",
  imageTooLarge:
    "El PNG supera 8 MiB. Reduce el contenido e inténtalo de nuevo.",
  budget:
    "Esta acción supera el límite de edición. Tu trabajo se ha conservado.",
  resizeBudget:
    "Esta ampliación supera el límite de edición. Prueba un tamaño menor.",
  eraseBudget:
    "El borrado supera el límite de procesamiento. Se ha conservado el contenido anterior. Reduce la forma o el contenido e inténtalo de nuevo.",
  exportFailed:
    "No se pudo crear el PNG. Tu boceto sigue aquí; inténtalo de nuevo.",
  workerFailed:
    "No se pudo borrar. Tu boceto no ha cambiado; inténtalo de nuevo.",
  textOverflow:
    "El texto sale del lienzo. Acórtalo o cancela esta edición para moverlo o reducirlo.",
  handle: "Cambiar tamaño {{direction}}",
  shape: {
    line: "Línea",
    arrow: "Flecha",
    rectangle: "Rectángulo",
    circle: "Círculo",
    triangle: "Triángulo",
    diamond: "Rombo",
    star: "Estrella",
    heart: "Corazón",
  },
};
