/**
 * [INPUT]: Depends on the shared MemoryBackendCopy contract only.
 * [OUTPUT]: Provides backend-owned fr copy for summaries, configuration and release behavior.
 * [POS]: Main-only Memory backend localization; descriptors carry it to settings over IPC.
 */
import type { MemoryBackendCopy } from "../../../../../shared/ipc/content/memory-ipc";

export const backendCopyFr = {
    openviking: {
      unverifiedVersionWarning: "Cette release n’est pas validée par le produit. Elle réutilise la spécification du modèle verrouillé et les fichiers existants ; si le nom du modèle change en amont, OpenViking pourra le télécharger au premier lancement sans progression dans l’app.",
      summary: "Le nettoyage est limité au workspace — supprimer une portée laisse les autres.",
      panel: { title: "Modèle d’extraction OpenViking", description: "La clé, la Base URL et le modèle restent dans les secrets locaux et le fichier ov.conf géré en 0600. Après prise en charge manuelle, modifiez directement ce fichier." },
      field: {
        OPENVIKING_LLM_API_KEY: { label: "Clé API d’extraction", description: "Requise pour extraire la mémoire à long terme des conversations." },
        OPENVIKING_LLM_BASE_URL: { label: "Base URL", description: "Point d’accès compatible OpenAI, par exemple https://api.deepseek.com/v1." },
        OPENVIKING_LLM_MODEL: { label: "Modèle", description: "Nom du modèle d’extraction, par exemple deepseek-chat." },
      },
    },
    everos: {
      summary: "Le nettoyage réinitialise tout le runtime — toutes les portées partent d’un coup.",
      panel: { title: "Identifiants d’extraction EverOS", description: "EverOS exige une clé de service de modèle. Elle reste dans les secrets locaux et LaunchAgent ; les identifiants du CLI ne sont jamais lus." },
      field: {
        EVEROS_LLM__API_KEY: { label: "Clé API d’extraction", description: "Clé du service compatible OpenAI utilisée pour extraire la mémoire." },
        EVEROS_LLM__BASE_URL: { label: "Base URL", description: "Point d’accès compatible OpenAI, par exemple https://api.deepseek.com/v1." },
        EVEROS_LLM__MODEL: { label: "Modèle", description: "Nom du modèle d’extraction, par exemple deepseek-chat." },
      },
    },
  } satisfies Record<string, MemoryBackendCopy>;
