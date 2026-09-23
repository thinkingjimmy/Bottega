/**
 * [INPUT]: The shared encrypted-sync copy contract.
 * [OUTPUT]: Spanish setup, creation requirement checklist, immediate password validation, unlock and recovery messages.
 * [POS]: Shared desktop and Web encryption presentation.
 */
import type { CloudEncryptionCopy } from "./en";
export const es: CloudEncryptionCopy = {
  setupInProgress: "Activando la sincronización…", setupConnectionFailed: "La conexión ha fallado. Comprueba tu red e inténtalo de nuevo.",
  title: "Desbloquear el espacio sincronizado", description: "Introduce la contraseña de sincronización que configuraste en tu ordenador.", password: "Contraseña de sincronización", confirmation: "Confirmar contraseña",
  setPassword: "Configurar contraseña de sincronización", setupDescription: "Elige una contraseña que solo tú conozcas. Guárdala en un lugar seguro; Bottega no puede recuperarla.",
  risk: "Entiendo que perder esta contraseña puede impedir recuperar los datos de la nube.", inProgress: "Protegiendo la sincronización…",
  unlock: "Desbloquear", unlocking: "Desbloqueando…", checking: "Comprobando la sincronización cifrada…", remember: "Mantener este navegador desbloqueado",
  rememberDescription: "Guarda una clave de desbloqueo cifrada en este navegador. Puedes bloquearlo cuando quieras.", remembered: "Este navegador recordará la clave de desbloqueo.", thisPageOnly: "Desbloqueado solo para esta página.",
  saving: "Guardando la clave…", saveFailed: "El espacio está desbloqueado, pero no se pudo guardar la clave. Es posible que necesites la contraseña la próxima vez.", saveRetry: "Reintentar guardar la clave",
  cachedStorageUnavailable: "El almacenamiento local seguro no está disponible. Es posible que necesites la contraseña al volver a abrir la aplicación.", cacheUnreadable: "No se pudo leer la clave guardada. Introduce la contraseña de sincronización.",
  cacheClearFailed: "No se pudo eliminar la clave guardada. Reinténtalo para retirar el acceso recordado en este navegador.", lock: "Bloquear este navegador", locked: "El espacio sincronizado está bloqueado",
  offlineTitle: "Conéctate para desbloquear el espacio", offlineDescription: "El navegador debe verificar la cuenta antes de desbloquear el contenido guardado. Se conserva la caché cifrada.",
  unavailable: "No se pudo comprobar la sincronización cifrada. Reinténtalo.",
  reviewExpired: "Esta revisión ha caducado. Vuelve a analizar el contenido.", connectionFailed: "Tu conexión no está disponible. La sincronización cifrada continuará cuando vuelvas a estar en línea.", retry: "Reintentar", cancel: "Cancelar", account: "Cuenta y dispositivos",
  showPassword: "Mostrar contraseña", hidePassword: "Ocultar contraseña", passwordMismatch: "Las contraseñas no coinciden.", independentPassword: "Esta contraseña es independiente de la de Google y solo desbloquea el contenido sincronizado.",
  unrecoverableCloud: "Guarda tu contraseña de sincronización en un lugar seguro. Recuperar la cuenta de Google no permite recuperar esta contraseña. Si la pierdes y ningún dispositivo puede descifrar tus datos antiguos, el contenido almacenado solo en la nube no podrá recuperarse.",
  secureSaveFailedDesktop: "No se pudo guardar la clave de forma segura en este ordenador. La sincronización sigue desactivada. Reintenta guardarla antes de activarla.",
  legacyUnsupported: "Esta cuenta aún contiene datos del formato de sincronización anterior. Deben tratarse antes de iniciar la sincronización cifrada.",
  passwordTooShort: "Usa al menos 8 caracteres.",
  passwordTooLong: "Usa un máximo de 1.024 bytes UTF-8. Algunos caracteres ocupan varios bytes.",
  passwordRules: "Requisitos de la contraseña", ruleMet: "cumplido", ruleUnmet: "sin cumplir",
  ruleLength: "Al menos 12 caracteres", ruleLetter: "Al menos una letra", ruleDigit: "Al menos un número",
  ruleSimple: "Evita caracteres repetidos o consecutivos", ruleEmail: "No incluyas el nombre de tu correo", ruleCommon: "Evita contraseñas comunes y «Bottega»",
  "sync-password-invalid": "Usa al menos 8 caracteres y un máximo de 1.024 bytes UTF-8. Algunos caracteres ocupan varios bytes.",
  "sync-password-weak": "Elige una contraseña más segura que cumpla todos los requisitos.",
  "sync-unlock-failed": "Esta contraseña no pudo desbloquear el espacio. Compruébala y vuelve a intentarlo.", "sync-integrity-failed": "No se pudo verificar este contenido cifrado. Vuelve a cargar la versión más reciente.",
  "sync-encryption-unsupported": "Este navegador o dispositivo no admite el cifrado requerido. Usa Chrome actualizado o Bottega en tu ordenador.",
  "sync-space-changed": "El espacio cifrado o su clave han cambiado. Se ha pausado el acceso; comprueba la cuenta y los datos de restauración.",
  "sync-operation-cancelled": "Se canceló el desbloqueo.", "sync-operation-busy": "Hay otra operación de cifrado en curso. Espera a que termine o cancélala.", "sync-locked": "Desbloquea el espacio sincronizado para continuar.",
  checkingDescription: "Buscando el espacio cifrado de esta cuenta.",
  unavailableTitle: "No se pudo comprobar la sincronización cifrada", unavailableDescription: "Reintenta para comprobarlo de nuevo. Tu inicio de sesión se conserva.",
  unsupportedTitle: "Este navegador no puede ejecutar la sincronización cifrada", lockFailedTitle: "El bloqueo no se completó",
  cancelledDescription: "Se canceló el desbloqueo. Introduce tu contraseña de sincronización para volver a intentarlo.",
  lockedDescription: "Este navegador está bloqueado. Introduce tu contraseña de sincronización para continuar.",
  missingUnlock: "Este navegador no tiene información de desbloqueo guardada. Introduce tu contraseña de sincronización.",
};
