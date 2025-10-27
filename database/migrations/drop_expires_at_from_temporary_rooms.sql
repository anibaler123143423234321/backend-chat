-- =====================================================
-- Script para eliminar campo expiresAt de temporary_rooms
-- =====================================================
-- Fecha: 2025-10-25
-- Descripción: Elimina el campo expiresAt de la tabla temporary_rooms
--              ya que las salas ahora son permanentes (sin expiración)
-- =====================================================

-- Eliminar el campo expiresAt si existe
ALTER TABLE `temporary_rooms`
DROP COLUMN IF EXISTS `expiresAt`;

-- =====================================================
-- Verificación
-- =====================================================
-- Para verificar que el campo fue eliminado correctamente, ejecuta:
-- DESCRIBE temporary_rooms;
-- =====================================================

