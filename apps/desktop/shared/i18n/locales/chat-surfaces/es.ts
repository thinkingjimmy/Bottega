/**
 * [INPUT]: Depends on the chatSurfacesEn structural type
 * [OUTPUT]: Spanish Chat surfaces, including exact-command service controls, one Finder header action, and local-file preview failure copy
 * [POS]: Spanish Chat surfaces locale leaf assembled into the existing chat namespace
 */

import { chatSurfacesEn } from "./en";

export const chatSurfacesEs: typeof chatSurfacesEn = {
  nativeBackground: {
    "running": "En ejecución",
    "stopFailed": "Error al detener",
    "retry": "Reintentar",
    "stopNamed": "Detener {{name}}",
    "retryNamed": "Reintentar detener {{name}}",
    "services": "Servicios activos en este chat",
    "stop": "Detener",
    "stopping": "Deteniendo…",
    "started": "Iniciado con «{{mode}}». Continúa después de la respuesta.",
    "failed": "No se pudo confirmar que el comando se detuviera. Inténtalo de nuevo.",
    "modes": {
      "ask-for-approval": "Pedir aprobación",
      "approve-for-me": "Aprobar por mí",
      "full-access": "Acceso completo"
    }
  },
  sidePanel: {
    shell: {
      loadingBase: "Cargando Base",
      closePreview: "Cerrar vista previa",
      readingFile: "Leyendo archivo…",
      bytes: "{{count}} bytes",
      resize: "Cambiar el tamaño del panel lateral",
      resizeHint:
        "Arrastra o usa las teclas de flecha para cambiar el tamaño del panel lateral",
    },
    file: {
      reveal: "Mostrar en Finder",
      missing: "El archivo se ha movido o eliminado de esta ruta.",
      outside: "El archivo está fuera del espacio de trabajo actual, o este ha cambiado.",
      readFailed: "No se pudo mostrar el archivo. Inténtalo de nuevo.",
      actionFailed: "La acción falló. Abre la vista previa de nuevo y reintenta.",
      tooLarge: "El archivo supera el límite de vista previa de 1 MiB. Puedes abrirlo con una aplicación del sistema.",
      binary: "El archivo no es texto UTF-8. Puedes abrirlo con una aplicación del sistema.",
    },
    appGrant: {
      badgeAria:
        "Permisos de {{name}} — datos: {{data}}; actúa por ti: {{delegation}}",
      on: "Activado",
      off: "Desactivado",
      omittedIntro: "El Agent no vio esta App en el turno anterior: {{reason}}",
      omission: {
        referenceLimit:
          "este Chat tiene demasiadas Apps adjuntas. Quita algunas y vuelve a intentarlo.",
        instructionBudget:
          "las instrucciones de las Apps adjuntas superan el límite de 2 KB. Quita algunas y vuelve a intentarlo.",
        backendUnsupported:
          "el backend actual no tiene canal de herramientas, así que actuar por ti no está disponible. El acceso de solo lectura a archivos sigue vigente.",
        baseToolsDisabled:
          "las herramientas de lectura y escritura de Base están desactivadas. Actívalas en Ajustes › Herramientas.",
      },
      degradation: {
        baseReadsDisabled:
          "En este turno solo puede cambiar filas, no leer tablas: las lecturas de Base están desactivadas.",
        baseRowMutationsDisabled:
          "En este turno solo puede leer tablas, no cambiar filas: los cambios de filas de Base están desactivados.",
      },
      excludedIntro:
        "Una Extension no se entregó en el turno anterior, así que esta App no funciona por completo: {{items}}",
      excludedItem: "{{name}} ({{code}})",
      excludedRequiredItem: "{{name}} ({{code}}, obligatoria)",

      extensionDetails: "Detalles de Extensions y entrega",
      requirementSummary:
        "Requisito: {{requirement}}; instalada: {{installed}}; admisión: {{admission}}; generación: {{generation}}; activada: {{enabled}}; concedida a la App: {{granted}}",
      required: "Obligatoria",
      optional: "Opcional",
      yes: "Sí",
      no: "No",
      none: "Ninguno",
      unknown: "Desconocido",
      unresolved: "Sin resolver",
      configOverrideDiff: "Anulación de configuración: {{value}}",
      eligible: "Disponibilidad: {{value}}",
      turnActive: "Activa en este turno: {{active}}",
    },
    appTab: {
      readFailed: "No se pudo leer el estado de la App",
      surfaceFailed: "No se pudo emitir la superficie de la App",
      unavailable:
        "La App no está disponible o se está eliminando. Su ranura se conserva, pero no se emitirá ninguna capacidad de ejecución ni de datos.",
      stop: "Detener App",
      startFailed: "No se pudo iniciar la App",
      open: "Abrir App",
      opening: "Abriendo…",
      notAuthorized:
        "Esta App aún no está autorizada en este Chat, así que no puede leer datos ni abrir su superficie aquí.",
      authorize: "Autorizar en este Chat",
    },
    image: {
      fallbackTitle: "Imagen",
      preview: "Vista previa de la imagen",
      previewNamed: "Vista previa de la imagen: {{name}}",
      zoom: "Zoom",
      restoring: "Restaurando imagen",
      reading: "Leyendo imagen",
      unavailable:
        "La imagen ya no está en esta conversación o no está disponible temporalmente.",
      retry: "Reintentar",
    },
  },
  transcript: {
    image: {
      unavailable: "Vista previa de la imagen no disponible",
      reading: "Leyendo imagen",
      generatedAlt: "Imagen generada",
      openInSidePanel: "Abrir imagen en el panel lateral: {{title}}",
      fallbackTitle: "Imagen",
    },
    actions: {
      copy: "Copiar",
      copied: "Copiado",
    },
    outlineLabel: "Esquema de la conversación",
    plan: {
      editingAria: "Editando el Plan",
      editing: "Editando",
      title: "Plan",
      copy: "Copiar Plan",
      copied: "Copiado",
      collapsePanel: "Cerrar el panel lateral del Plan",
      showPanel: "Mostrar el Plan en el panel lateral",
      showFullPanel: "Mostrar el Plan completo en el panel lateral",
    },
    loadEarlier: "Mostrar mensajes anteriores",
    loadingEarlier: "Cargando mensajes anteriores…",
    fatalResultTitle: "No se pudo guardar el resultado de este turno",
    fatalResultLocked:
      "La entrada sigue bloqueada hasta que descartes el resultado de este turno.",
    abandonFatal: "Descartar el resultado de este turno",
    cleanupFailedTitle: "La limpieza de procesos no terminó",
    cleanupFailed:
      "La limpieza de {{backend}} aún no está verificada. Reintenta la limpieza para que el sistema compruebe los procesos originales y desbloquee este Chat de forma segura.",
    acknowledgeCleanup: "Reintentar limpieza",
    loadedEarlier: "Se cargaron {{count}} mensajes anteriores",
    subagentDetailsCleared: "Se borraron los detalles de este Subagent",
    subagentDetailsLimited: "Los detalles en tiempo real alcanzaron el límite",
    showLess: "Mostrar menos",
    showMore: "Mostrar más",
    openAttachmentInSidePanel: "Abrir imagen en el panel lateral: {{title}}",
    workingFor: "Trabajando durante {{duration}}",
  },
  usageLimit: {
    unavailable: "{{backend}} no está disponible temporalmente",
    resetTime: "Hora de restablecimiento",
    usageWindow: "Periodo de uso",
    window: {
      fiveHour: "Ventana de 5 horas",
      weekly: "Ventana semanal",
    },
    retry: "Reintentar ahora",
    resetAt: "{{date}} ({{zone}})",
    aboutMinutes: "Aproximadamente {{minutes}} min",
    aboutHours: "Aproximadamente {{hours}} h",
    aboutHoursMinutes: "Aproximadamente {{hours}} h {{minutes}} min",
  },
};
