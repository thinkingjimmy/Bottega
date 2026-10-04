/**
 * [INPUT]: Depends on the settingsPersonalizationEn structural type
 * [OUTPUT]: Provides settingsPersonalizationEs, the Spanish Settings › Personalization catalog
 * [POS]: Spanish leaf of shared/i18n/locales/settings/personalization; loaded on demand by the matching top-level locale
 */

import type { settingsPersonalizationEn } from "./en";

export const settingsPersonalizationEs: typeof settingsPersonalizationEn = {
  title: "Personalización", sectionTitle: "Instrucciones personalizadas", description: "Edita el archivo global de instrucciones de cada Agent instalado.",
  loading: "Cargando archivos de instrucciones…", emptyTitle: "No hay ningún Agent instalado", emptyHint: "Instala un Agent en Ajustes de Backends y vuelve aquí.",
  placeholder: "Escribe instrucciones de texto sin formato para este Agent…", createHint: "El archivo aún no existe. Al guardar se creará en {{path}}.",
  save: "Guardar instrucciones", saving: "Guardando…", copyPath: "Copiar ruta", copied: "Ruta copiada", reveal: "Mostrar en el gestor de archivos",
  oversized: "El archivo supera 256 KiB; aquí no se carga ni se puede editar.",
  find: { open: "Buscar en el archivo", placeholder: "Buscar en el archivo", count: "{{current}} / {{total}}", noMatches: "Sin coincidencias", previous: "Coincidencia anterior", next: "Coincidencia siguiente", close: "Cerrar búsqueda" },
  metrics: { lines: "{{lines}} líneas", limit: "límite de {{size}}", recommendedLines: "{{lines}} líneas recomendadas", recommendedSize: "{{size}} recomendado" },
  errors: { bridge: "La personalización no está disponible en esta versión.", conflict: "El archivo cambió fuera de la aplicación. Tus cambios sin guardar se conservan; volver a guardar sobrescribirá la versión más reciente del disco.", tooLarge: "Las instrucciones no pueden superar 256 KiB.", oversizedFile: "El archivo supera 256 KiB y no se puede editar aquí.", symlinkUnresolvable: "El enlace simbólico está roto o es cíclico.", readFailed: "No se pudo leer el archivo de forma segura.", writeFailed: "No se pudo guardar el archivo." },
};
