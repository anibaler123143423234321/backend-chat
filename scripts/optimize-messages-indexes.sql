-- ============================================================
-- 🚀 SCRIPT DE OPTIMIZACIÓN: Índices para todas las tablas
-- ============================================================
-- Ejecutar este script en tu base de datos MySQL/MariaDB para
-- mejorar significativamente el rendimiento de las consultas
-- ============================================================

-- ============================================================
-- TABLA: messages
-- ============================================================

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

-- Índices compuestos para consultas más comunes
CREATE INDEX IF NOT EXISTS IDX_messages_room_thread_deleted ON messages (roomCode, threadId, isDeleted);
CREATE INDEX IF NOT EXISTS IDX_messages_conv_thread_deleted ON messages (conversationId, threadId, isDeleted);
CREATE INDEX IF NOT EXISTS IDX_messages_from_to_group ON messages (`from`(50), `to`(50), isGroup);

-- ============================================================
-- TABLA: conversation_favorites
-- ============================================================

CREATE INDEX IF NOT EXISTS IDX_conv_favorites_username ON conversation_favorites (username);
CREATE INDEX IF NOT EXISTS IDX_conv_favorites_conversationId ON conversation_favorites (conversationId);
CREATE INDEX IF NOT EXISTS IDX_conv_favorites_isPinned ON conversation_favorites (isPinned);

-- ============================================================
-- TABLA: room_favorites
-- ============================================================

CREATE INDEX IF NOT EXISTS IDX_room_favorites_username ON room_favorites (username);
CREATE INDEX IF NOT EXISTS IDX_room_favorites_roomCode ON room_favorites (roomCode);
CREATE INDEX IF NOT EXISTS IDX_room_favorites_roomId ON room_favorites (roomId);
CREATE INDEX IF NOT EXISTS IDX_room_favorites_isPinned ON room_favorites (isPinned);

-- ============================================================
-- TABLA: temporary_conversations
-- ============================================================

CREATE INDEX IF NOT EXISTS IDX_temp_conv_linkId ON temporary_conversations (linkId);
CREATE INDEX IF NOT EXISTS IDX_temp_conv_isActive ON temporary_conversations (isActive);
CREATE INDEX IF NOT EXISTS IDX_temp_conv_isAssignedByAdmin ON temporary_conversations (isAssignedByAdmin);
CREATE INDEX IF NOT EXISTS IDX_temp_conv_createdBy ON temporary_conversations (createdBy);
CREATE INDEX IF NOT EXISTS IDX_temp_conv_active_assigned ON temporary_conversations (isActive, isAssignedByAdmin);

-- ============================================================
-- TABLA: temporary_rooms
-- ============================================================

CREATE INDEX IF NOT EXISTS IDX_temp_rooms_roomCode ON temporary_rooms (roomCode);
CREATE INDEX IF NOT EXISTS IDX_temp_rooms_isActive ON temporary_rooms (isActive);
CREATE INDEX IF NOT EXISTS IDX_temp_rooms_isAssignedByAdmin ON temporary_rooms (isAssignedByAdmin);
CREATE INDEX IF NOT EXISTS IDX_temp_rooms_createdBy ON temporary_rooms (createdBy);
CREATE INDEX IF NOT EXISTS IDX_temp_rooms_active_assigned ON temporary_rooms (isActive, isAssignedByAdmin);

-- ============================================================
-- VERIFICACIÓN: Ver índices creados en todas las tablas
-- ============================================================
SHOW INDEX FROM messages;
SHOW INDEX FROM conversation_favorites;
SHOW INDEX FROM room_favorites;
SHOW INDEX FROM temporary_conversations;
SHOW INDEX FROM temporary_rooms;
