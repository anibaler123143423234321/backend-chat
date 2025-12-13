/**
 * Utilidades para manejo de fechas con zona horaria de Lima (UTC-5)
 */

/**
 * Obtiene la fecha actual en la zona horaria de Lima (Perú)
 * @returns Date object ajustado a la zona horaria de Lima
 */
export function getPeruDate(): Date {
  // Obtener la fecha actual en UTC
  const now = new Date();

  // Convertir a zona horaria de Lima (UTC-5)
  // Nota: Perú no usa horario de verano, siempre es UTC-5
  const peruOffset = -5 * 60 * 60 * 1000; // -5 horas en milisegundos

  // Crear nueva fecha ajustada a Perú
  const peruDate = new Date(now.getTime() + peruOffset);

  return peruDate;
}

/**
 * Formatea una fecha a string de hora en formato HH:mm (zona horaria de Lima)
 * @param date Fecha a formatear (opcional, por defecto usa la fecha actual de Perú)
 * @returns String con formato HH:mm
 */
export function formatPeruTime(date?: Date): string {
  const peruDate = date || getPeruDate();

  //  CRÍTICO: Usar getUTCHours() y getUTCMinutes() porque peruDate es un Date ajustado a UTC
  // El objeto Date internamente sigue siendo UTC, pero con el tiempo ajustado a Perú
  const hours = peruDate.getUTCHours().toString().padStart(2, '0');
  const minutes = peruDate.getUTCMinutes().toString().padStart(2, '0');

  return `${hours}:${minutes}`;
}

/**
 * Convierte una fecha UTC a la zona horaria de Lima
 * @param utcDate Fecha en UTC
 * @returns Date object ajustado a la zona horaria de Lima
 */
export function utcToPeruDate(utcDate: Date): Date {
  // Perú está en UTC-5
  const peruOffset = -5 * 60 * 60 * 1000; // -5 horas en milisegundos
  return new Date(utcDate.getTime() + peruOffset);
}

/**
 * Formatea una fecha para mostrar "Hoy", "Ayer" o la fecha completa
 * @param sentAt Fecha del mensaje
 * @returns String con "Hoy", "Ayer" o fecha formateada
 */
export function formatDisplayDate(sentAt: Date): string {
  if (!sentAt) return "Hoy";

  // Obtener fecha actual en Perú
  const nowInPeru = getPeruDate();
  const todayInPeru = nowInPeru.toISOString().split('T')[0]; // YYYY-MM-DD

  // Calcular ayer en Perú
  const yesterdayInPeru = new Date(nowInPeru);
  yesterdayInPeru.setUTCDate(yesterdayInPeru.getUTCDate() - 1);
  const yesterdayDateStr = yesterdayInPeru.toISOString().split('T')[0]; // YYYY-MM-DD

  // Extraer fecha del mensaje
  const messageDate = sentAt.toISOString().split('T')[0]; // YYYY-MM-DD

  // Log eliminado para optimización - se ejecutaba por cada mensaje

  if (messageDate === todayInPeru) {
    return "Hoy";
  } else if (messageDate === yesterdayDateStr) {
    return "Ayer";
  } else {
    // Para otras fechas, formatear usando zona horaria de Perú
    return sentAt.toLocaleDateString("es-PE", {
      timeZone: "America/Lima",
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }
}
