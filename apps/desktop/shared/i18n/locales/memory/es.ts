/**
 * [INPUT]: Depends on memoryEn from ./en for both its structural type and the English leaves this catalog reuses
 * [OUTPUT]: Provides memoryEs, the Spanish Memory catalog
 * [POS]: Spanish leaf of shared/i18n/locales/memory; loaded on demand by the matching top-level locale
 */

import { memoryEn } from "./en";

export const memoryEs: typeof memoryEn = {
  ...memoryEn,
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
  provider: {
    openviking: {
      summary: "La limpieza se limita al workspace: borrar un ámbito deja los demás.",
      panel: { title: "Modelo de extracción OpenViking", description: "La clave, la Base URL y el modelo solo se guardan en secretos locales y en ov.conf gestionado con modo 0600. Tras adoptar el modo manual, edita ese archivo directamente." },
      field: {
        OPENVIKING_LLM_API_KEY: { label: "Clave API de extracción", description: "Necesaria para extraer memoria a largo plazo de las conversaciones." },
        OPENVIKING_LLM_BASE_URL: { label: "Base URL", description: "Endpoint compatible con OpenAI, por ejemplo https://api.deepseek.com/v1." },
        OPENVIKING_LLM_MODEL: { label: "Modelo", description: "Nombre del modelo de extracción, por ejemplo deepseek-chat." },
      },
    },
    everos: {
      summary: "La limpieza reinicia todo el runtime: todos los ámbitos se van a la vez.",
      panel: { title: "Credenciales de extracción de EverOS", description: "EverOS necesita una clave del servicio de modelos. Se guarda en secretos locales y LaunchAgent; nunca se leen credenciales del CLI." },
      field: {
        EVEROS_LLM__API_KEY: { label: "Clave API de extracción", description: "Clave del servicio compatible con OpenAI usada para extraer memoria." },
        EVEROS_LLM__BASE_URL: { label: "Base URL", description: "Endpoint compatible con OpenAI, por ejemplo https://api.deepseek.com/v1." },
        EVEROS_LLM__MODEL: { label: "Modelo", description: "Nombre del modelo de extracción, por ejemplo deepseek-chat." },
      },
    },
  },
  backend: { ...memoryEn.backend, homepage: "Página del proyecto", notReady: "El servicio aún no está listo. Repara o vuelve a comprobar la instalación abajo.", installed: "Instalado", installedNeedsConfig: "Instalado · requiere configuración", installedNeedsConfigVersion: "{{version}} instalado · requiere configuración", notInstalled: "No instalado", dataLocation: "Mostrar ubicación de datos", dataLocationFailed: "La ubicación de datos aún no está disponible. Repara o reinstala primero.", interrupted: "Instalación interrumpida", identityRepair: "Reparar identidad de instalación" },
  activity: { aria: "Actividad de memoria", empty: "Todavía no hay registros de recuperación o entrega.", lastCapture: "Última entrega · tras guardar", lastRecall: "Última recuperación", recallUsed: "Memoria enviada", recallNone: "Sin memoria relevante", recallFailed: "Recuperación no disponible", recallFailedCount: "{{count}} con error", recallUsedTurns: "Turnos con memoria enviada", recallZeroTurns: "Turnos sin coincidencias", rebuilt: "Última reconstrucción · completada", delivered: "Turnos entregados en el ámbito actual", pending: "Pendientes en el ámbito actual", inflight: "Lotes en curso", gap: "Turnos faltantes · autorizados sin entregar" },
  attention: { kind: { "capture-gap": "Falta una entrega de extracción", "cleanup-failed": "Falló la limpieza remota", "rebuild-failed": "Reconstrucción interrumpida", "capacity-pressure": "El registro necesita compactación" }, action: { acknowledge: "Entendido", "retry-cleanup": "Reintentar limpieza", compact: "Compactar ahora", abandon: "Abandonar y registrar", "resume-rebuild": "Continuar reconstrucción" } },
  health: {
    offLabel: "Desactivada", offDetail: "Activa la memoria para permitir recuperación y entrega.", unknownLabel: "Sin comprobar", unknownDetail: "Actualiza para conectar con el servicio local.", checkingLabel: "Comprobando", checkingDetail: "Conectando al servicio local y validando su respuesta.", readyLabel: "Servicio listo", readyDetail: "La recuperación y la entrega están disponibles.", compatLabel: "Modo compatible", compatDetail: "La versión difiere de la bloqueada, pero el servicio sigue disponible.", compatVersionDetail: "El servicio {{version}} difiere de la versión bloqueada. Reinstala la versión fijada si observas problemas.", unavailableLabel: "Servicio no disponible", unavailableDetail: "Falló la conexión; actualiza para reintentar.", blockedLabel: "Aún no se puede activar",
    blocked: { ownership: "No se pudo verificar la propiedad de los datos gestionados; la memoria se desactiva para evitar escribir en una raíz desconocida. Repara la instalación abajo para recuperarla.", configuration: "La configuración está incompleta; envía primero la clave de extracción.", "not-installed": "Este servicio de memoria gestionado no está instalado. Instálalo abajo; cuando esté listo podrás activar la memoria." },
    issue: {
      unreachable: { label: "No se puede acceder al servicio local", detail: "Puede que el servicio no se esté ejecutando. Usa «Reparar instalación» abajo. La memoria se pausa y el Chat no se ve afectado." },
      unhealthy: { label: "El servicio aún no está listo", detail: "El servicio responde pero puede seguir iniciándose. Reintenta en breve. El Chat no se ve afectado." },
      auth: { label: "La autenticación del servicio está activa", detail: "El producto no lee credenciales del CLI. Reinicia el servicio loopback en modo dev. Modo de autenticación actual: {{detail}}." },
      protocol: { label: "Servicio inesperado en esta dirección", detail: "La dirección devolvió un protocolo desconocido. La memoria se pausa y el Chat no se ve afectado." },
      identity: { label: "El puerto pertenece a un proceso no gestionado", detail: "La entrega se detuvo para no enviar conversaciones a un proceso desconocido. Repara la instalación o libera el puerto." },
      configuration: { label: "Configuración incompleta", detail: "Envía la clave de extracción abajo. La memoria se pausa y el Chat no se ve afectado." },
      version: { label: "Servicio no disponible", detail: "La versión detectada {{detail}} no superó la conexión." },
    },
  },
  engines: {
    title: "Motores de memoria", aria: "Motores de memoria",
    description: "Elige el motor que contiene la memoria y gestiónalo aquí. Solo uno está activo a la vez: cambiar exige limpieza o reconstrucción previa, pero instalar el otro no cuesta nada.",
    manage: "Gestionar {{provider}}", collapse: "Contraer {{provider}}",
    versionRow: "Versión", modelRow: "Modelo de extracción", runtimeRow: "Ejecución",
    inUse: "En uso", updateAvailable: "Actualización disponible",
    modelConfigured: "La clave y el modelo permanecen en este Mac.", modelUnset: "Aún sin configurar: envía la clave de extracción para iniciar el servicio.",
    runtimeManaged: "Instalación gestionada · {{url}}", runtimeAutostart: "Inicio al abrir sesión · reinicio automático tras un fallo.",
    installAction: "Instalar {{provider}}",
  },
  setup: {
    recommended: "Recomendado", chooseTitle: "Elige un motor de memoria", chooseDescription: "Se instala en su propio entorno de Python con versión fijada en este Mac. Podrás cambiar de motor más adelante.",
    installingTitle: "Instalando {{provider}}", installedTitle: "{{provider}} está instalado", installFailedTitle: "{{provider}} no terminó de instalarse",
    installingDescription: "Esto ocurre una sola vez. Después, el servicio se inicia al abrir sesión y se reinicia solo si falla.", background: "Continuar en segundo plano", backgroundNote: "La instalación sigue en segundo plano: Ajustes › Memoria muestra cómo va, y allí podrás conectar un modelo cuando termine.",
    connectTitle: "Conecta un modelo", connectDescription: "Un modelo compatible con OpenAI lee los mensajes que escribes y extrae lo que vale la pena recordar. La clave se queda en este Mac.", connectSubmit: "Iniciar servicio",
    draftKept: "Al cerrar se conserva este borrador hasta que se aplique correctamente.",
    row: {
      notSetUp: "Sin configurar",
      installing: "Instalando",
      installed: "Instalado",
      failed: "Error de instalación",
      description: "Recuerda lo importante de conversaciones pasadas y lo recupera cuando es relevante. Ejecuta un pequeño servicio en este Mac.",
      installingDescription: "Instalando {{provider}}: sigue en segundo plano. Puedes terminar de configurarlo más tarde.",
      connectDescription: "{{provider}} {{version}} está instalado. Conecta un modelo para empezar a recordar.",
      failedDescription: "{{provider}} no terminó de instalarse. Vuelve a configurarlo para reintentar.",
      setUp: "Configurar…",
      showProgress: "Ver progreso",
      connect: "Conectar…",
    },
    notes: {
      title: "Antes de empezar",
      localTerm: "Se queda en este Mac",
      localDetail: "El inventario de memoria nunca sale de este ordenador. Las carpetas de ejecución y de datos están separadas.",
      modelTerm: "Necesita un modelo para extraer recuerdos",
      modelDetail: "Solo los mensajes que escribes se envían al modelo compatible con OpenAI que conectes, nada más.",
      removeTerm: "Elimínalo cuando quieras",
      removeDetail: "Desactivar la memoria pausa la recuperación; eliminarla borra el servicio y sus datos. Chat sigue funcionando en ambos casos.",
    },
  },
  page: { ...memoryEn.page, providerMissing: "El servicio de memoria «{{provider}}» no está registrado.", refreshHealth: "Actualizar estado de Memory", title: "Memoria a largo plazo", description: "Solo se procesan turnos humanos y el inventario de memoria permanece en este Mac. Desactivarla detiene la recuperación y el registro; Chat, Tools, Apps y Skills siguen funcionando.", stateOn: "Activada", stateUnavailable: "En pausa · servicio no disponible", statePaused: "En pausa",  applyFailedTitle: "Configuración guardada pero aún no activa", applyFailedFallback: "Falló la aplicación", applyRetrying: "Reintentando en segundo plano.", resume: "Reanudar memoria", pause: "Pausar memoria", enable: "Activar memoria", observability: "Actividad", observabilityDescription: "Las recuperaciones sin coincidencias y los errores de recuperación se registran por separado; la entrega es duradera y el Chat siempre permanece fail-open.", observabilityEpoch: "Memoria desde {{date}} · generación de ámbito {{generation}}", recallWarningTitle: "Métricas de recuperación no disponibles temporalmente", pausedBanner: "La memoria a largo plazo está en pausa. Chat, Tools, Apps y Skills siguen funcionando.", attentionTitle: "Requiere atención", attentionDescription: "Cada elemento tiene una acción de recuperación explícita.", resumeFailed: "No se pudo reanudar Memory", pauseFailed: "No se pudo pausar Memory", consentFailed: "No se pudo aplicar el consentimiento", configTitle: "¿Cambiar el destino de extracción?", configChange: "El destino cambia de {{currentHostname}}/{{currentModel}} a {{nextHostname}}/{{nextModel}}.", configDisclosure: "Los mensajes nuevos autorizados se enviarán a este destino y pueden generar cargos.", configConfirm: "Confirmar y aplicar", pauseTitle: "¿Pausar la memoria?", pauseDescription: "Se detienen las nuevas recuperaciones y entregas. Las solicitudes ya enviadas o en fase de envío no pueden retirarse.", pauseConfirm: "Pausar memoria" },
  disclosure: { enableTitle: "¿Activar la memoria a largo plazo?", switchTitle: "¿Cambiar el servicio de memoria a largo plazo?", processing: "Solo se envían para extracción el texto humano y las respuestas correctas. Tools, Apps, Skills y el contexto del producto no, y tu Agent procesa los mensajes igual que antes.", destination: "Destino de extracción", readingDestination: "Leyendo destino…", thirdParty: "El inventario permanece local. Un tercero puede registrar solicitudes, consumir cuota o cobrar cargos.", includeHistory: "Empezar ahora e importar el historial seleccionado", scopeHistory: "{{chats}} Chats, {{turns}} turnos seleccionados", scopeNew: "Solo conversaciones humanas nuevas tras la confirmación", scopePrefix: "Ámbito: {{scope}}", historyRange: "{{from}} – {{to}}", gaps: "{{count}} Chats contienen huecos recortados e irrecuperables.", pauseBoundary: "Puedes pausar cuando quieras, pero las solicitudes que ya entraron en fase de envío no pueden retirarse, y enviarlas no significa que el modelo las use.", atLeastOnce: "La entrega es at-least-once: tras un fallo se puede extraer dos veces un turno si el servicio no admite claves de idempotencia.", switchBack: "Volver al servicio anterior exige antes limpieza o reconstrucción; los datos antiguos nunca se reutilizan en silencio.", confirmSwitch: "Confirmar y cambiar", confirmEnable: "Confirmar y activar" },
  sharing: {
    title: "Ámbito compartido", description: "Elige desde qué Chats se pueden recuperar los recuerdos nuevos. Cambiar el ámbito nunca reutiliza automáticamente los datos anteriores.", disabledMemory: "Activa primero la memoria a largo plazo.", disabledTarget: "El destino de memoria actual no está disponible.", previewFailed: "No se pudo previsualizar el cambio de ámbito",
    dialogTitle: "¿Cambiar el ámbito de memoria?", oldScopeRetained: "Los datos del ámbito anterior se conservan, pero dejan de recuperarse y no se combinan automáticamente.", historyPaused: "Puedes cambiar el ámbito en pausa; reanuda la memoria para importar historial.", confirm: "Confirmar ámbito", readingScope: "Leyendo el ámbito…",
    mode: { chat: "Solo este Chat", group: "Grupo de Project / Chat independiente", personal: "Grupo de memoria personal" },
    isolation: { chat: "Solo la encarnación actual del Chat puede recuperar los recuerdos nuevos.", group: "Los Chats de un Project pueden recuperarse entre sí; los Chats independientes comparten otro grupo.", personal: "Todos los Projects y Chats independientes recuperan desde el mismo grupo personal." },
  },
  supply: { title: "Fuentes de memoria", summary: "{{streams}} fuentes · {{delivered}} entregados", disabled: "Activa la memoria y completa la inicialización de sus propietarios.", loadFailed: "No se pudieron cargar las fuentes de memoria. Cierra y vuelve a abrir para reintentar.", foreign: "Historial importado", untitled: "Chat sin título", archived: "Archivado", deleted: "Eliminado", counts: "{{delivered}} entregados · {{pending}} pendientes · {{gap}} faltantes", empty: "Ninguna conversación ha alimentado aún este ámbito." },
  version: { historyTitle: "Instaladas recientemente", loading: "Cargando versiones…", confirmTitle: "¿Cambiar {{provider}} a {{version}}?", listStale: "El runtime cambió durante la carga, así que esta lista está desfasada. Inténtalo de nuevo.", description: "Se instala exactamente la release elegida y solo pasa a last-known-good tras estar lista.", current: "Actual", locked: "Recomendada", latest: "Última", yanked: "Retirada", selected: "Versión elegida", currentYanked: "La release instalada fue retirada; consérvala o cámbiala explícitamente.", downgradeWarning: "Es una versión anterior. Los datos permanecen, pero la compatibilidad puede cambiar.", unverifiedWarning: "Esta release no ha sido validada por el producto. Reutiliza la especificación del modelo bloqueado y los archivos existentes; si cambia el nombre del modelo en origen, OpenViking podrá descargarlo al primer inicio sin progreso en la app.", catalogStaleWarning: "No se pudieron actualizar los metadatos de versión; la caché puede estar desfasada.", catalogValidationWarning: "La versión anunciada por PyPI difiere de la lista instalable; se usa esa lista.", listFailed: "No se pudo cargar la lista de versiones. Inténtalo de nuevo.", switchFailed: "No se pudo cambiar de versión. Revisa el error del runtime e inténtalo de nuevo.", runningInBackground: "El cambio continúa en segundo plano. Puedes cerrar este diálogo y seguir el progreso en la página Memory.", confirm: "Cambiar versión", action: "Elegir versión", available: "Actualizar a {{version}}", check: "Buscar actualizaciones" },
  runtime: {
    modelTransferAria: "Progreso de descarga del modelo", modelTransfer: "{{received}} / {{total}} MiB", modelRecovered: "Falló la verificación del modelo; se está descargando de nuevo una copia verificada.", interruptedInstall: "La instalación se interrumpió antes de confirmar la propiedad. Reintenta para sustituir el runtime parcial.", versionIntentRecoveryRequired: "El cambio a {{version}} se interrumpió antes de validar el candidato. Reparar restaura el runtime last-known-good.", versionCandidateAwaitingReadiness: "{{version}} está instalado pero aún no validado. Envía la configuración requerida para verificarlo y promoverlo.", identityRepair: "Hay archivos gestionados sin manifest. Reparar restaura la identidad desde el marcador de propiedad.", identityMissing: "No hay marcador de propiedad del producto; el directorio no se adoptará automáticamente.",
    installHeading: "Instalar servicio de memoria local", installPackage: "Instalar {{provider}} {{version}} en un entorno Python aislado y con versión fijada; el origen y la verificación aparecen en el registro.", installAutostart: "Iniciar al entrar en {{url}} y reiniciar tras fallos.", installStorage: "El inventario queda local; la extracción puede usar el servicio de modelos configurado. Runtime y datos están separados.", installAction: "Instalar", managedNeedsConfig: "{{provider}} {{version}} está instalado y espera credenciales de extracción; al enviarlas se registra el inicio automático y arranca el servicio.", repairAction: "Reparar instalación", repairTitle: "¿Reparar la instalación de {{provider}}?", repairDescription: "Esto detiene brevemente el servicio y reinstala el runtime gestionado actual. Se conservan los datos de memoria, la configuración de extracción y la identidad de instalación; después se reinicia el servicio.", running: "Procesando…", openRunning: "Abrir estado de la operación de Memory", retryInstall: "Reintentar instalación", unsupported: "La instalación con un clic no está disponible en esta plataforma.", versionMismatch: "Está instalada {{installed}}; la app fija {{locked}}. Sigue siendo utilizable, pero se recomienda actualizar.", stepFailed: "Falló {{step}}: ", configModified: "{{file}} se modificó manualmente", configModifiedDetail: "Regenera para volver a la gestión del producto, o adopta el modo manual y edita claves y modelos en el archivo.", regenerate: "Regenerar", adoptManual: "Adoptar modo manual", manualDetail: "La configuración es manual; el producto no reescribirá este archivo.", steps: "Paso {{current}}/{{total}}", preparing: "Preparando", upgradeTo: "Actualizar a {{version}}", recheck: "Comprobar de nuevo", downloadHint: "La descarga de dependencias puede tardar varios minutos", errorLog: "Registro de errores", hideLog: "Ocultar registro", showLog: "Ver registro", configureAction: "Configurar modelo de extracción", configDialogTitle: "Configurar {{provider}}", retainBlank: "Déjalo vacío para conservar el valor actual", draftRetained: "Cerrar o un reinicio fallido conserva este borrador en memoria; solo se borra tras aplicarlo correctamente.", submitRestart: "Enviar y reiniciar servicio", savingConfig: "Guardando…", configSaveFailed: "No se pudo guardar la configuración del modelo de extracción", uninstallTitle: "¿Desinstalar el runtime gestionado de {{provider}}?", uninstallDescription: "Detiene el servicio y el inicio automático, y elimina de forma permanente el runtime gestionado y todos sus datos de memoria. Si está activo, se desactiva la memoria.", uninstallRetention: "Los consentimientos y Chats permanecen. Tras reinstalar, una reconstrucción puede volver a extraer el historial autorizado aún conservado.", uninstallConfirm: "Desinstalar y eliminar datos",
    step: {
      "refresh-version-catalog": "Actualizando la lista de versiones de confianza", "remove-plist": "Quitando el inicio de sesión automático", "remove-venv": "Eliminando el entorno candidato", "prepare-toolchain": "Preparando la cadena uv fijada", "ensure-venv": "Creando el entorno de Python {{version}}", "fetch-artifacts": "Descargando y verificando los paquetes",
      "install-packages": "Instalando la versión bloqueada {{version}} (puede tardar varios minutos)", "install-packages_selected": "Instalando la versión elegida {{version}} (puede tardar varios minutos)",
      "register-manifest": "Registrando la instalación gestionada", initialize: "Inicializando la raíz de datos", "model-assets": "Descargando el modelo de embeddings", "config-converge": "Aplicando la configuración gestionada", "install-plist": "Registrando el inicio de sesión automático",
      bootstrap: "Iniciando el servicio", bootstrap_deferred: "El inicio espera a la configuración", "await-ready": "Esperando a que el servicio esté listo", "await-ready_deferred": "La comprobación espera a la configuración",
      "config-write": "Escribiendo la configuración del runtime", "config-regenerate": "Regenerando la configuración del runtime", "config-adopt-manual": "Adoptando la configuración manual", bootout: "Deteniendo el servicio", "wipe-data": "Borrando los datos del runtime", "remove-root": "Eliminando el runtime y sus datos",
    },
  },
  rebuild: { button: "Reconstruir memoria", title: "¿Reconstruir memoria?", confirm: "Iniciar reconstrucción", unavailable: "La memoria no está disponible durante la reconstrucción; el Chat sigue funcionando.", progress: "{{purged}}/{{totalScopes}} sesiones remotas limpiadas · {{backfilledTurns}}/{{totalTurns}} turnos repuestos", intentStable: "El resultado no cambia el ajuste activado o en pausa.", description: "Borra toda la memoria escrita por el producto en la instancia actual de {{provider}} y vuelve a extraer el contenido autorizado que aún existe, no solo el Chat actual.", scope: "Ámbito estimado: {{chats}} Chats, {{turns}} turnos; destino {{hostname}}/{{model}}. Puede tardar, consumir cuota o generar cargos.", pauseIntent: "La memoria no está disponible durante la reconstrucción; el Chat no se ve afectado. Se conserva el ajuste «{{intent}}» y prevalecen los cambios posteriores.", trimmed: "El historial recortado no se puede recuperar y se registrará como hueco.", resetManualConfig: "Reiniciar el runtime elimina la configuración manual y devuelve su gestión al producto.", phase: { prepared: "Preparando", quiescing: "Deteniendo solicitudes activas", reconciling: "Conciliando envíos", purging: "Limpiando datos remotos", "watermarks-cleared": "Restableciendo marcas", backfilling: "Reponiendo historial", completed: "Completado", failed: "Interrumpido" } },
  receipt: { used: "Memoria a largo plazo · {{count}} elementos enviados", usedDetail: "Enviar no significa que el modelo los haya usado", none: "Memoria a largo plazo · sin contenido relevante", unavailable: "Memoria no disponible · no usada en este turno", planMode: "Memoria a largo plazo · no usada en modo Plan", promptNotIssued: "Memoria a largo plazo · solicitud del Agent no enviada", failure: { initialization: "No se pudo inicializar la memoria", "scope-resolution": "No se pudo resolver el ámbito de memoria de este turno", "policy-store": "El registro de políticas de memoria no está disponible", "runtime-configuration": "La configuración del runtime de memoria no está disponible", identity: "Falló la verificación de identidad del servicio de memoria", provider: "Falló el proveedor de memoria", ownership: "Falló la verificación de propiedad de la memoria", deadline: "La recuperación de memoria superó el plazo", "render-budget": "El contexto de memoria supera el presupuesto de renderizado", "stale-capability": "La autorización de memoria dejó de ser válida" } },
};
