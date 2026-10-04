/**
 * [INPUT]: The shared protection copy contract.
 * [OUTPUT]: Spanish offline reading, the per-device offline switch and phone offer, background mask, secure-storage recovery and biometric setting messages.
 * [POS]: Shared Cloud Web / mobile shell presentation.
 */
import type { CloudProtectionCopy } from "./en";
export const es: CloudProtectionCopy = {
  offlineBanner: "Sin conexión · Última sincronización {{time}}", offlineBannerUnknown: "Sin conexión · Mostrando contenido guardado",
  offlineReadOnly: "Solo lectura. Enviar, editar y descargar vuelven cuando te reconectes.", reconnecting: "Reconectando…",
  savedChats: "Chats guardados", allChats: "Todos los chats",
  offlineEmpty: "Todavía no hay chats guardados en este dispositivo. Conéctate para cargar tu espacio de trabajo.",
  offlineChatMissing: "Este chat no está guardado para leer sin conexión.",
  offlineEarlier: "Los mensajes anteriores estarán disponibles cuando vuelvas a estar en línea.",
  offlineDecryptFailed: "No se pudo descifrar el contenido guardado. Conéctate para volver a cargarlo.",
  offlineUnavailableTitle: "Conéctate para abrir tu espacio de trabajo",
  offlineExpired: "Ha pasado demasiado tiempo desde la última conexión de este dispositivo. Conéctate a internet para seguir leyendo.",
  offlineNoSnapshot: "La lectura sin conexión no está activada en este dispositivo. Actívala en Ajustes mientras estés en línea.",
  offlineClock: "El reloj de este dispositivo se atrasó. Conéctate a internet para verificar el acceso.",
  offlineOpening: "Abriendo el contenido guardado…", retry: "Reintentar",
  maskTitle: "Bottega está bloqueado", maskDescription: "Verifica tu identidad para mostrar tu espacio de trabajo.", maskResume: "Desbloquear", maskVerifying: "Verificando…",
  maskCancelled: "Se canceló la verificación. Vuelve a intentarlo o usa tu contraseña de sincronización.", usePassword: "Usar contraseña de sincronización",
  capabilityMissing: "El almacenamiento seguro de este dispositivo no está disponible ahora, así que no se puede abrir la clave de desbloqueo guardada. Reinicia o actualiza la app, o introduce tu contraseña de sincronización.",
  biometricChanged: "Cambiaron tus huellas o tu rostro registrados, así que ya no se puede abrir la clave de desbloqueo guardada. Introduce tu contraseña de sincronización una vez.",
  biometricLabel: "Exigir huella o rostro",
  biometricDescription: "Verifica con tu huella o tu rostro cada vez que vuelvas a Bottega. Si cambian las huellas o el rostro registrados, tendrás que introducir tu contraseña de sincronización una vez.",
  biometricNotEnrolled: "Configura el desbloqueo con huella o rostro en los ajustes del teléfono para usar esta opción.",
  biometricNeedsKeepUnlocked: "Primero desbloquea con tu contraseña de sincronización con «Mantener desbloqueado» activado.",
  biometricFailed: "No se pudo guardar el ajuste. Inténtalo de nuevo.",
  offlinePhoneLabel: "Mantener los chats disponibles sin conexión en este teléfono",
  offlineBrowserLabel: "Confiar en este navegador para leer sin conexión",
  offlineDescription: "Guarda lo que este dispositivo necesita para abrir tus chats guardados sin conexión. Puede abrirlos sin conexión hasta 30 días después de su última conexión; después tendrá que volver a conectarse. Los chats ya guardados en este dispositivo permanecen aquí hasta que desactives esta opción, bloquees este dispositivo o cierres sesión.",
  offlineBrowserWarning: "Actívalo solo en un navegador de confianza: cualquiera que pueda usar este perfil del navegador puede abrir los chats guardados sin conexión.",
  offlineChangeFailed: "No se pudo cambiar la lectura sin conexión. Inténtalo de nuevo.",
  offlineOfferTitle: "¿Mantener los chats disponibles sin conexión en este teléfono?",
  offlineOfferBody: "Tus chats guardados se abrirán sin conexión hasta 30 días después de la última conexión de este teléfono. Puedes desactivarlo en Ajustes cuando quieras, lo que elimina la copia sin conexión.",
  offlineOfferAccept: "Mantener sin conexión",
  offlineOfferDecline: "Ahora no",
};
