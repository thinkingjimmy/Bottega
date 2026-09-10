/**
 * [INPUT]: Defines pure en Sketch interface copy.
 * [OUTPUT]: Provides sketchEn for editor and attachment lifecycle messages.
 * [POS]: Feature locale leaf assembled by the matching language catalog.
 */
export const sketchEn = {
  title: "Sketch",
  description: "Draw an image for your message.",
  done: "Done",
  processing: "Processing sketch",
  discardTitle: "Discard changes?",
  discardDescription: "Your changes will not be saved.",
  continueEditing: "Keep editing",
  discardChanges: "Discard changes",
  edit: "Click to edit sketch",
  select: "Select",
  pen: "Pen",
  text: "Text",
  shapeTool: "Shapes",
  eraser: "Eraser",
  undo: "Undo",
  redo: "Redo",
  canvas: "Sketch canvas",
  canvasHelp:
    "Draw or select. Arrow keys move, Delete removes, Command or Control Z undoes.",
  penWidth: "Pen width",
  eraserWidth: "Eraser diameter",
  color: "Color {{value}}",
  customColor: "Custom color",
  sampleColor: "Pick from canvas",
  red: "Red",
  green: "Green",
  blue: "Blue",
  textInput: "Sketch text",
  busyErasing: "Finishing erasure…",
  historyTrimmed: "Earlier undo steps were cleared.",
  error: "Could not complete this action. Please try again.",
  empty: "Add something to the sketch first.",
  sourceMissing:
    "The editable source is unavailable. This sketch has been kept unchanged.",
  ownerExpired: "This chat is no longer available.",
  readOnly: "This chat cannot be edited right now.",
  versionChanged:
    "This attachment changed. Close the editor and open its latest version.",
  migrationActive: "Wait for the window move to finish, then try again.",
  editorActive: "Finish or close the sketch first.",
  attachmentLimit: "A message can have up to 8 direct attachments.",
  imageTooLarge:
    "The PNG exceeds 8 MiB. Reduce the sketch content and try again.",
  budget: "This action exceeds the editing budget. Your work has been kept.",
  resizeBudget:
    "This enlargement exceeds the editing budget. Try a smaller size.",
  eraseBudget:
    "This erasure exceeds the processing limit. The previous content has been kept. Reduce the shape size or canvas content and retry.",
  exportFailed:
    "Could not create the PNG. Your sketch is still here; please try again.",
  workerFailed:
    "Could not process erasure. Your sketch is unchanged; please try again.",
  textOverflow:
    "The text extends beyond the canvas. Shorten it, or cancel this edit and move or resize it.",
  handle: "Resize {{direction}}",
  shape: {
    line: "Line",
    arrow: "Arrow",
    rectangle: "Rectangle",
    circle: "Circle",
    triangle: "Triangle",
    diamond: "Diamond",
    star: "Star",
    heart: "Heart",
  },
};
