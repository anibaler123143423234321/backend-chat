-- ============================================================
-- 🚀 SCRIPT DE OPTIMIZACIÓN: Índices para tabla messages
-- ============================================================
-- Ejecutar este script en tu base de datos MySQL/MariaDB para
-- mejorar significativamente el rendimiento de las consultas de mensajes
-- ============================================================

-- Verificar si los índices ya existen antes de crearlos
-- (MySQL permite IF NOT EXISTS en CREATE INDEX desde 8.0)

-- 1. Índice para consultas por roomCode (grupos)
CREATE INDEX IF NOT EXISTS IDX_messages_roomCode ON messages (roomCode);

-- 2. Índice para consultas por conversationId (chats asignados)
CREATE INDEX IF NOT EXISTS IDX_messages_conversationId ON messages (conversationId);

-- 3. Índice para filtrar por threadId (mensajes principales vs respuestas)
CREATE INDEX IF NOT EXISTS IDX_messages_threadId ON messages (threadId);

-- 4. Índice para filtrar por isGroup
CREATE INDEX IF NOT EXISTS IDX_messages_isGroup ON messages (isGroup);

-- 5. Índice para filtrar por isDeleted
CREATE INDEX IF NOT EXISTS IDX_messages_isDeleted ON messages (isDeleted);

-- 6. Índice para ordenar por sentAt
CREATE INDEX IF NOT EXISTS IDX_messages_sentAt ON messages (sentAt);

-- ============================================================
-- ÍNDICES COMPUESTOS para consultas más comunes
-- Estos son los más importantes para el rendimiento
-- ============================================================

-- 7. Índice compuesto para consultas de sala (roomCode + threadId + isDeleted)
CREATE INDEX IF NOT EXISTS IDX_messages_room_thread_deleted ON messages (roomCode, threadId, isDeleted);

-- 8. Índice compuesto para consultas de conversación asignada
CREATE INDEX IF NOT EXISTS IDX_messages_conv_thread_deleted ON messages (conversationId, threadId, isDeleted);

-- 9. Índice compuesto para consultas de usuario a usuario
-- Nota: MySQL tiene límite de tamaño para índices en VARCHAR
CREATE INDEX IF NOT EXISTS IDX_messages_from_to_group ON messages (`from`(50), `to`(50), isGroup);

-- ============================================================
-- VERIFICACIÓN: Ver índices creados
-- ============================================================
SHOW INDEX FROM messages;

-- ============================================================
-- ANÁLISIS (opcional): Ver el plan de ejecución de una consulta típica
-- ============================================================
-- EXPLAIN SELECT * FROM messages WHERE roomCode = 'ROOM123' AND threadId IS NULL AND isDeleted = false ORDER BY id DESC LIMIT 20;
