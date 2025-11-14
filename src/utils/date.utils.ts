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
  
  // Formatear a HH:mm
  const hours = peruDate.getHours().toString().padStart(2, '0');
  const minutes = peruDate.getMinutes().toString().padStart(2, '0');
  
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

