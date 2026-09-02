/**
 * [INPUT]: Depends on the English Chat-storage catalog shape
 * [OUTPUT]: Provides Spanish Chat-storage failure copy
 * [POS]: Spanish leaf for user-facing Chat-storage failures
 */

import { chatStorageEn } from "./en";

export const chatStorageEs: typeof chatStorageEn = {
  technicalDetails: "Detalles técnicos",
  copyDetails: "Copiar detalles técnicos",
  copiedDetails: "Detalles técnicos copiados",
  code: {
    "file-quarantined": {
      title: "Un Chat no está disponible temporalmente",
      explanation: "Bottega no pudo leer este Chat, así que conservó el archivo original y lo omitió. Tus otros Chats no se ven afectados.",
      resolution: "Actualiza y reinicia Bottega. Si continúa, conserva la copia de seguridad y copia los detalles técnicos para soporte.",
    },
    "backup-failed": {
      title: "No se pudo leer ni respaldar un Chat",
      explanation: "Bottega se detuvo sin modificar el archivo para evitar una mayor pérdida de datos.",
      resolution: "Comprueba el espacio disponible y los permisos del archivo, y reinicia Bottega. Si continúa, copia los detalles técnicos para soporte.",
    },
    "recovery-conflict": {
      title: "Hay copias de Chat que no se pueden restaurar con seguridad",
      explanation: "Bottega no puede determinar qué copia es correcta, así que no sobrescribió ni eliminó ningún archivo.",
      resolution: "Conserva los archivos y copia los detalles técnicos para soporte antes de hacer cambios manuales.",
    },
  },
};
