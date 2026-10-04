/**
 * [INPUT]: Depends on the shared MemoryBackendCopy contract only.
 * [OUTPUT]: Provides backend-owned es copy for summaries, configuration and release behavior.
 * [POS]: Main-only Memory backend localization; descriptors carry it to settings over IPC.
 */
import type { MemoryBackendCopy } from "../../../../../shared/ipc/content/memory-ipc";

export const backendCopyEs = {
    openviking: {
      unverifiedVersionWarning: "Esta release no ha sido validada por el producto. Reutiliza la especificación del modelo bloqueado y los archivos existentes; si cambia el nombre del modelo en origen, OpenViking podrá descargarlo al primer inicio sin progreso en la app.",
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
  } satisfies Record<string, MemoryBackendCopy>;
