/**
 * [INPUT]: Depends on memoryEn from ./en for both its structural type and the English leaves this catalog reuses
 * [OUTPUT]: Includes Memory access selection, explicit workflow-read consent, plugin chrome and native-memory distinction; Provides memoryEs, the Spanish Memory catalog
 * [POS]: Spanish leaf of shared/i18n/locales/memory; loaded on demand by the matching top-level locale
 */

import { memoryEn } from "./en";

export const memoryEs: typeof memoryEn = {
  ...memoryEn,
  plugin: { open: "Abrir el plugin Memory", name: "Memory", official: "Oficial · Integrado", about: "Acerca de Memory", unsupported: "Memory no es compatible con esta plataforma. Actualmente solo está disponible en macOS.", nativeDistinction: "Bottega Memory es independiente de la memoria nativa que se gestiona en los ajustes de los plugins Codex y Claude." },
  access: {"none": "Ninguno", "readOnly": "Solo lectura", "description": "Recupera recuerdos relevantes para este rol. Los roles de flujo nunca escriben en Memory.", "workflowOff": "La lectura de los flujos no está permitida en el plugin Memory.", "workflowOn": "La lectura de los flujos está permitida en este ordenador."},
  workflow: {"sectionTitle": "Acceso y controles", "label": "Permitir que los roles de flujo lean Memory", "description": "Solo los roles configurados en solo lectura pueden recuperar recuerdos. Nunca escriben en Memory.", "consentTitle": "¿Permitir la lectura a los roles de flujo?", "consentBody": "Los roles configurados de planificación, desarrollo y revisión pueden recuperar recuerdos con el nombre de la tarea y sus criterios de aceptación, dentro del Chat o Project actual. No escriben recuerdos. Pausar Memory o retirar este permiso detiene la recuperación en el siguiente paso.", "confirm": "Permitir solo lectura", "requiresActive": "Activa Memory y completa el consentimiento antes de permitir la lectura. Reanuda Memory si está en pausa.", "personal": "La lectura de flujos no está disponible en el conjunto personal. Elige el ámbito Chat o Project.", "saveFailed": "No se pudo guardar el permiso. Inténtalo de nuevo."},
  store: {
    providerListFailed: "No se pudo cargar la lista de proveedores de Memory",
    statusFailed: "No se pudo leer el estado de Memory",
    healthFailed: "No se pudo comprobar el estado de Memory",
    historyPreviewFailed: "No se pudo previsualizar el historial de Memory",
    attentionFailed: "No se pudo resolver el elemento pendiente de Memory",
    runtimeStatusFailed: "No se pudo leer el estado del runtime de Memory",
    configIssueFailed: "No se pudo resolver el problema de configuración de Memory",
    manualConfigPreviewFailed: "No se pudo previsualizar el destino configurado manualmente",
    runtimeOperationFailed: "Falló la operación del runtime de Memory",
    updateCheckFailed: "No se pudieron buscar actualizaciones de Memory",
    configPreviewFailed: "No se pudo previsualizar el destino de Memory",
    configAuthorityFailed: "No se pudo autorizar el destino de Memory",
    manualConfigAuthorityFailed: "No se pudo autorizar el destino configurado manualmente",
    configSubmitFailed: "No se pudo enviar la configuración del runtime de Memory",
    destructiveAuthorityFailed: "No se pudo autorizar la operación destructiva de Memory",
    destructiveFailed: "Falló la operación destructiva de Memory",
  },
  common: { unread: "Aún no leído", paused: "en pausa", enabled: "activada" },
  time: { none: "Aún no hay", now: "ahora mismo" },
  page: { ...memoryEn.page, pausedBanner: "La memoria a largo plazo está en pausa. Chat, Tools, Apps y Skills siguen funcionando." },
  sharing: {
    title: "Ámbito compartido", description: "Elige desde qué Chats se pueden recuperar los recuerdos nuevos. Cambiar el ámbito nunca reutiliza automáticamente los datos anteriores.", disabledMemory: "Activa primero la memoria a largo plazo.", disabledTarget: "El destino de memoria actual no está disponible.", previewFailed: "No se pudo previsualizar el cambio de ámbito",
    dialogTitle: "¿Cambiar el ámbito de memoria?", oldScopeRetained: "Los datos del ámbito anterior se conservan, pero dejan de recuperarse y no se combinan automáticamente.", historyPaused: "Puedes cambiar el ámbito en pausa; reanuda la memoria para importar historial.", confirm: "Confirmar ámbito", readingScope: "Leyendo el ámbito…",
    mode: { chat: "Solo este Chat", group: "Grupo de Project / Chat independiente", personal: "Grupo de memoria personal" },
    isolation: { chat: "Solo la encarnación actual del Chat puede recuperar los recuerdos nuevos.", group: "Los Chats de un Project pueden recuperarse entre sí; los Chats independientes comparten otro grupo.", personal: "Todos los Projects y Chats independientes recuperan desde el mismo grupo personal." },
  },
  runtime: { running: "Procesando…", openRunning: "Abrir estado de la operación de Memory" },
  receipt: { used: "Memoria a largo plazo · {{count}} elementos enviados", usedDetail: "Enviar no significa que el modelo los haya usado", none: "Memoria a largo plazo · sin contenido relevante", unavailable: "Memoria no disponible · no usada en este turno", planMode: "Memoria a largo plazo · no usada en modo Plan", promptNotIssued: "Memoria a largo plazo · solicitud del Agent no enviada", failure: { initialization: "No se pudo inicializar la memoria", "scope-resolution": "No se pudo resolver el ámbito de memoria de este turno", "policy-store": "El registro de políticas de memoria no está disponible", "runtime-configuration": "La configuración del runtime de memoria no está disponible", identity: "Falló la verificación de identidad del servicio de memoria", provider: "Falló el proveedor de memoria", ownership: "Falló la verificación de propiedad de la memoria", deadline: "La recuperación de memoria superó el plazo", "render-budget": "El contexto de memoria supera el presupuesto de renderizado", "stale-capability": "La autorización de memoria dejó de ser válida" } },
};
