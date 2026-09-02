/**
 * [INPUT]: Depends on the English Chat runtime catalog shape
 * [OUTPUT]: Provides the Spanish Chat runtime catalog
 * [POS]: Spanish projection for attachment, queue, submission, settings, and recovery messages
 */

import type { chatRuntimeEn } from "./en";

export const chatRuntimeEs: typeof chatRuntimeEn = {
  attachment: {
    takeoverFailed: "**No se pudo enlazar con la sesión en ejecución:** {{message}}",
    chatLoadFailed: "**No se pudo cargar el chat:** {{message}}",
  },
  queue: {
    notPersisted: "El mensaje no se guardó. Corrígelo y vuelve a intentarlo.",
    recoverable: "El mensaje se puede recuperar; reenviarlo creará una identidad de envío nueva.",
    retryAgentTurn: "El mensaje del usuario se guardó. Usa «Reintentar turn de Agent».",
    reconciling: "El envío todavía se está conciliando. Un reintento normal puede ejecutarlo dos veces.",
    failedResourcesReleased: "El envío falló y main liberó sus recursos de reintento. Edítalo y vuelve a enviarlo.",
    failed: "El envío falló.",
    steerReturned: "El steering no terminó, así que el mensaje volvió a la cola.",
    staleResourcesDecision: "El mensaje contiene recursos anteriores al reinicio. Elige un reenvío exacto o elimínalo.",
    staleWorkspaceWait: "El mensaje contiene recursos de Workspace anteriores al reinicio. Espera un resultado exacto o elimínalo.",
    steerPrepareFailed: "No se pudo preparar el mensaje insertado: {{message}}",
    steerVerifyFailed: "No se pudo comprobar si el mensaje se insertó: {{message}}",
    steerHistoryPending: "El mensaje se insertó; su historial todavía se está guardando.",
    steerQueuedNext: "El turn actual no consumió el mensaje, así que quedó el siguiente en la cola.",
    steerDeliveryUnknown: "No se pudo confirmar la entrega. Comprueba la conversación y luego reenvía o elimina el mensaje.",
    turnEnded: "El turn actual terminó, así que este mensaje se enviará por la cola normal.",
    viewChangedSteerCancelled: "La vista de Chat cambió, así que no se envió el mensaje Steer de la vista anterior.",
    workspaceChangedNoResend: "El Workspace cambió. Este mensaje no se puede reenviar en el Workspace nuevo; elimínalo y vuelve a escribirlo.",
    durableOutcomeUnavailable: "El durable outcome no está disponible; la conciliación sigue activa.",
    mainCustodyPending: "El envío sigue bajo custodia de main. Espera un resultado definitivo.",
    noSafeNegativeProof: "main no aportó una prueba segura de que el envío nunca llegó, así que no se puede reenviar a ciegas.",
    ordinaryResendUnavailable: "Este envío no se puede reenviar de forma normal. Sigue las indicaciones del durable outcome.",
  },
  submission: {
    notSent: "**Mensaje no enviado:** {{message}}",
    stateUnknown: "**Estado del mensaje desconocido:** {{message}}. Se conservó la identidad del envío original; elige reenviar o eliminar en la cola.",
    relayPaused: "Mensaje en cola: la cadena de relevo de esta Section está en pausa. Resuelve primero el aviso Continuar en la parte superior del chat.",
    relayPending: "Mensaje en cola: esta Section tiene un mensaje de relevo pendiente.",
    acceptedRefreshFailed: "El Agent aceptó el mensaje, pero no se pudo actualizar el estado local de la sesión: {{message}}. No lo reenvíes; la tarea continuará.",
    backendSetupRequired: "**Termina primero la configuración de {{backend}}.** Se abrió la guía de instalación e inicio de sesión.",
    localPreparationFailed: "Falló la preparación de la sesión local: {{message}}",
  },
  settings: {
    readFailed: "No se pudieron cargar los ajustes de Agent: {{message}}",
    saveFailed: "No se pudieron guardar los ajustes de Agent: {{message}}",
    transcriptReadFailed: "**No se pudieron cargar los ajustes de Agent:** {{message}}",
  },
  relayStopFailed: "No se pudo detener toda la cadena de relevo Section; en su lugar se detuvo la solicitud actual: {{message}}. Puedes reintentarlo.",
  actionFailed: "**Falló {{action}}:** {{message}}",
  abandonTurn: "Abandonar turn",
  acknowledgeCleanup: "Confirmar limpieza",
  unnamed: "Sin título",
};
