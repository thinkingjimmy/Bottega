/**
 * [INPUT]: Depends on the shared availability state vocabulary.
 * [OUTPUT]: Provides localized Agent availability and recovery copy.
 * [POS]: Availability locale leaf.
 */
export const agentAvailabilityEs = {
  "state": {
    "recent-sign-in": "La última solicitud requiere iniciar sesión",
    "connection": "Problema de conexión",
    "service": "Problema del servicio",

    "ready": "Listo",
    "custom-route": "Endpoint personalizado · inicio de sesión sin verificar",
    "unverified": "Sin verificar",
    "checking": "Comprobando",
    "missing": "No instalado",
    "unsupported": "Actualización disponible",
    "sign-in": "Sin iniciar sesión",
    "cannot-check": "No se pudo comprobar",
    "cannot-start": "No se puede iniciar",
    "usage-limit": "Límite de uso",
    "unavailable": "No disponible"
  },
  "unavailableReason": {
    "package-disabled": "Desactivado en Plugins",
    "package-removed": "Se quitó de este ordenador",
    "package-refused": "No se pudo cargar",
    "trust-refused": "No es de confianza en este ordenador"
  },
  "imagesPreserved": "Este Agent no puede enviar estas imágenes. Los archivos adjuntos se conservan.",
  "managementUnavailable": "Abre la ventana principal para gestionar Agents.",
  "openMenu": "Abrir menú de Agent",
  "manage": "Gestionar Agents",
  "login": "Iniciar sesión",
  "retry": "Reintentar",
  "locked": "No puedes cambiar de Agent en este chat.",
  "blocked": "{{backend}} no está disponible. Tu borrador se conserva.",
  "retrySending": "Reintentar envío",
  "retryExplanation": "¿Ya iniciaste sesión o crees que la comprobación es incorrecta? Intenta enviar este mensaje.",
  "customRoute": "{{backend}} envía las solicitudes a un endpoint que configuraste. Bottega no puede confirmar que el inicio de sesión funcione allí; si una solicitud falla, se indicará el motivo.",
  "isolatedConfig": "Bottega ejecuta {{backend}} con su propia configuración. Los proveedores configurados en ~/.config/opencode o en el opencode.json de un proyecto no se usan aquí.",
  "unverifiedReason": {
    "provider-scoped": "{{backend}} comprueba el inicio de sesión por proyecto, así que se confirma cuando se ejecuta un Chat.",
    "not-supported": "{{backend}} no puede informar a Bottega de su estado de inicio de sesión. Si necesitas iniciar sesión, el Chat te lo indicará."
  }
};
