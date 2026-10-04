/**
 * [INPUT]: Depends on the Memory plugin metadata, settings and pause impact contracts.
 * [OUTPUT]: Provides es copy for the official Memory plugin.
 * [POS]: Localized Memory feature copy within the workbench catalog.
 */
export const memoryPluginCopy = {
  "name": "Memory",
  "summary": "Recupera contexto útil de los chats dentro del alcance que elijas.",
  "description": "Memory recuerda el contexto útil de tus chats y lo recupera cuando ayuda, como una decisión de la semana pasada o cómo te gusta redactar los informes.\n\nTú eliges hasta dónde se comparte: en cada chat, en cada Project o entre todos los chats. La extracción usa el modelo que elijas y puede tener coste, así que Bottega pregunta antes de activarla. El historial existente queda excluido.",
  "settings": {
    "backend": {
      "label": "Motor de Memory"
    },
    "sharingMode": {
      "label": "Alcance compartido"
    },
    "phoneFacade": {
      "label": "Estado y controles de Memory en teléfono y Web"
    },
    "workflowRoles": {
      "label": "Permitir que los roles de los flujos lean Memory"
    }
  },
  "sharing": {
    "chat": "Este chat",
    "group": "Este proyecto",
    "personal": "Todos los chats"
  },
  "capability": {
    "recall": "Recuperar contexto dentro del alcance elegido",
    "capture": "Guardar contexto apto con tu permiso",
    "backfill": "Procesar solo el historial autorizado"
  },
  "confirmation": {
    "title": "Confirmar cambio de Memory",
    "cutover": "Usar este motor. La extracción usa {{model}} en {{hostname}} y puede generar cargos del modelo. No se incluye el historial existente.",
    "chat": "Limitar Memory a cada chat a partir de ahora. La extracción usa {{model}} en {{hostname}} y puede generar cargos del modelo. No se incluye el historial existente.",
    "group": "Compartir Memory dentro de cada proyecto a partir de ahora. La extracción usa {{model}} en {{hostname}} y puede generar cargos del modelo. No se incluye el historial existente.",
    "personal": "Compartir Memory entre todos los chats a partir de ahora. La extracción usa {{model}} en {{hostname}} y puede generar cargos del modelo. No se incluye el historial existente."
  },
  "effects": {
    "recall": "Pausar la recuperación en nuevos turnos de chats y flujos.",
    "capture": "Pausar las nuevas capturas y conservar los recuerdos guardados.",
    "backfill": "Pausar el procesamiento habitual del historial.",
    "phone": "Pausar Memory en los chats del teléfono y la Web.",
    "rebuild": "Una reconstrucción ya autorizada continúa y puede generar cargos del modelo."
  },
  "health": {
    "backend": "Motor",
    "version": "Versión instalada",
    "sharing": "Alcance compartido",
    "service": "Estado",
    "directory": "Carpeta de datos",
    "unknown": "Aún sin confirmar",
    "unsupported": "Memory está disponible en macOS.",
    "missing": "Instala el motor seleccionado en los ajustes de Memory.",
    "configuration": "Completa la configuración del motor en los ajustes de Memory.",
    "repair": "Revisa o repara el motor en los ajustes de Memory.",
    "off": "Configura Memory para empezar.",
    "paused": "En pausa; se conservan los recuerdos guardados.",
    "ready": "Listo",
    "checking": "Comprobando el motor…"
  }
};
