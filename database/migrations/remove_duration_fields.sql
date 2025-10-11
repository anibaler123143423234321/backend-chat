-- =====================================================
-- Script para eliminar campos de duración de las salas
-- =====================================================
-- Fecha: 2025-01-XX
-- Descripción: Elimina el campo durationMinutes de la tabla temporary_rooms
--              ya que las salas ahora son permanentes (sin expiración automática)
-- =====================================================

-- Eliminar el campo durationMinutes de la tabla temporary_rooms
ALTER TABLE `temporary_rooms` 
DROP COLUMN `durationMinutes`;

-- Nota: El campo expiresAt se mantiene pero ahora se establece a 10 años en el futuro
-- para indicar que las salas son prácticamente permanentes

-- =====================================================
-- Verificación
-- =====================================================
-- Para verificar que el campo fue eliminado correctamente, ejecuta:
-- DESCRIBE temporary_rooms;
-- =====================================================

