/**
 * [INPUT]: Depends on the English Agent failure catalog shape
 * [OUTPUT]: Provides Spanish Agent failure presentation copy
 * [POS]: Spanish leaf for provider-neutral Agent failures
 */

import { agentFailureEn } from "./en";

export const agentFailureEs: typeof agentFailureEn = {
  technicalDetails: "Detalles técnicos",
  copyDetails: "Copiar detalles técnicos",
  copiedDetails: "Detalles técnicos copiados",
  code: {
    "auth-required": { title: "Vuelve a iniciar sesión en {{backend}}", explanation: "Tu sesión caducó o no se completó.", resolution: "Ejecuta `{{command}}` en una terminal, completa el inicio de sesión, vuelve a Bottega e inténtalo de nuevo." },
    "rate-limited": { title: "{{backend}} está recibiendo demasiadas solicitudes", explanation: "El proveedor ha limitado temporalmente las solicitudes nuevas.", resolution: "Espera un momento e inténtalo de nuevo. Si continúa, comprueba la red y el estado del proveedor." },
    "quota-exhausted": { title: "{{backend}} no tiene uso disponible ahora", explanation: "La cuenta alcanzó su límite de uso o no tiene saldo.", resolution: "Comprueba el plan, el uso y la facturación, o espera hasta la hora de restablecimiento indicada." },
    "context-exhausted": { title: "Esta conversación es demasiado larga para continuar", explanation: "El Agent alcanzó el límite de contexto o sesión de esta conversación.", resolution: "Inicia un Chat nuevo y envía una solicitud más corta con menos archivos o texto pegado." },
    "connection-lost": { title: "Se interrumpió la conexión con {{backend}}", explanation: "Bottega no pudo mantener una conexión estable con el Agent.", resolution: "Comprueba Internet, la VPN y el proxy, y vuelve a intentarlo cuando la conexión sea estable." },
    "request-rejected": { title: "{{backend}} no puede usar esta solicitud", explanation: "No se aceptó el modelo, la configuración o la solicitud.", resolution: "Elige un modelo disponible, revisa los ajustes del Agent y prueba una solicitud más corta o sencilla." },
    "service-unavailable": { title: "{{backend}} no está disponible temporalmente", explanation: "El Agent o el proveedor del modelo informó de un problema temporal.", resolution: "Inténtalo más tarde. Si continúa, actualiza el Agent y copia los detalles técnicos para soporte." },
    "runtime-unavailable": { title: "No se pudo iniciar {{backend}}", explanation: "El Agent local falta, está desactualizado o no superó la comprobación de inicio.", resolution: "Abre los ajustes del Agent, instala o actualiza {{backend}} y vuelve a comprobarlo." },
    unknown: { title: "{{backend}} no pudo completar la solicitud", explanation: "El Agent informó de un problema que Bottega no puede clasificar de forma segura.", resolution: "Inténtalo una vez más. Si se repite, abre y copia los detalles técnicos para soporte." },
  },
  notice: {
    title: "{{backend}} envió un aviso",
    explanation: "Este aviso procede del propio {{backend}}, no de Bottega. Esta respuesta no se ve afectada.",
  },
};
