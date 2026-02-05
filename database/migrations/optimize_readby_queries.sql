-- =============================================================
-- MIGRACIÓN: Optimización de queries readBy para reducir CPU
-- Backend: backend-chat
-- Fecha: 2026-02-05
-- =============================================================

-- IMPORTANTE: Ejecutar en el servidor MySQL como root o usuario con privilegios
-- Base de datos: chat_midas

USE chat_midas;

-- =============================================================
-- PASO 1: Normalizar readBy existentes a minúsculas
-- =============================================================
-- Esto permite que las queries usen JSON_CONTAINS sin LOWER()
-- Tiempo estimado: ~2-3 minutos para 142K registros

UPDATE messages 
SET readBy = LOWER(readBy) 
WHERE readBy IS NOT NULL 
  AND JSON_LENGTH(readBy) > 0;

-- Verificar cuántos registros se actualizaron
SELECT 
  COUNT(*) as total_mensajes,
  SUM(CASE WHEN readBy IS NOT NULL AND JSON_LENGTH(readBy) > 0 THEN 1 ELSE 0 END) as con_readBy
FROM messages;

-- =============================================================
-- PASO 2: Crear índices adicionales para optimizar búsquedas
-- =============================================================
-- Nota: Algunos índices ya existen en la entidad, estos son adicionales

-- Índice para búsquedas de mensajes no leídos por sala
CREATE INDEX IF NOT EXISTS IDX_messages_unread_room 
ON messages(isGroup, isDeleted, threadId, roomCode, `from`(50));

-- Índice para búsquedas de mensajes no leídos por conversación  
CREATE INDEX IF NOT EXISTS IDX_messages_unread_conv 
ON messages(conversationId, isGroup, isDeleted, threadId, `from`(50));

-- Índice para búsqueda rápida por from (remitente)
CREATE INDEX IF NOT EXISTS IDX_messages_from_prefix 
ON messages(`from`(50));

-- =============================================================
-- PASO 3: Verificar que los índices se crearon correctamente
-- =============================================================
SHOW INDEX FROM messages WHERE Key_name LIKE 'IDX_messages_unread%' OR Key_name LIKE 'IDX_messages_from%';

-- =============================================================
-- PASO 4: Analizar tablas para actualizar estadísticas
-- =============================================================
ANALYZE TABLE messages;

-- =============================================================
-- VERIFICACIÓN FINAL
-- =============================================================
-- Ejecutar EXPLAIN en la query problemática para ver mejora:
/*
EXPLAIN SELECT `message`.`roomCode`, COUNT(*) as unreadCount 
FROM `messages` `message` 
WHERE `message`.`isGroup` = true 
  AND `message`.`roomCode` IS NOT NULL 
  AND `message`.`isDeleted` = false 
  AND `message`.`threadId` IS NULL 
  AND `message`.`from` != 'TEST_USER' 
  AND (readBy IS NULL OR JSON_LENGTH(readBy) = 0 OR NOT JSON_CONTAINS(readBy, '"test_user"'))
GROUP BY `message`.`roomCode`;
*/

-- =============================================================
-- ROLLBACK (solo si hay problemas)
-- =============================================================
-- No hay rollback directo para LOWER() ya que es destructivo.
-- Si hay problemas, restaurar desde backup.
