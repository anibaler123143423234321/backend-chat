-- Script para encontrar y eliminar mensajes duplicados en la base de datos

-- 1. ENCONTRAR DUPLICADOS EN UNA SALA ESPECÍFICA (por ejemplo, roomCode = '9185B4C2')
-- Esto muestra grupos de mensajes que tienen el mismo from, message, time y roomCode
SELECT
    `from`,
    message,
    time,
    roomCode,
    COUNT(*) as count,
    GROUP_CONCAT(id ORDER BY id) as ids,
    MIN(id) as keep_id,
    GROUP_CONCAT(id ORDER BY id DESC) as delete_ids,
    MIN(sentAt) as first_sent_at
FROM messages
WHERE roomCode = '9185B4C2'
  AND isDeleted = 0
  AND threadId IS NULL
GROUP BY `from`, message, time, roomCode
HAVING COUNT(*) > 1
ORDER BY MIN(sentAt) DESC;

-- 2. ENCONTRAR TODOS LOS DUPLICADOS EN TODAS LAS SALAS
SELECT
    roomCode,
    `from`,
    message,
    time,
    COUNT(*) as count,
    GROUP_CONCAT(id ORDER BY id) as ids,
    MIN(id) as keep_id,
    MIN(sentAt) as first_sent_at
FROM messages
WHERE isGroup = 1
  AND isDeleted = 0
  AND threadId IS NULL
GROUP BY roomCode, `from`, message, time
HAVING COUNT(*) > 1
ORDER BY roomCode, MIN(sentAt) DESC;

-- 3. ENCONTRAR DUPLICADOS EN CONVERSACIONES PRIVADAS
SELECT
    `from`,
    `to`,
    message,
    time,
    COUNT(*) as count,
    GROUP_CONCAT(id ORDER BY id) as ids,
    MIN(id) as keep_id,
    MIN(sentAt) as first_sent_at
FROM messages
WHERE isGroup = 0
  AND isDeleted = 0
  AND threadId IS NULL
GROUP BY `from`, `to`, message, time
HAVING COUNT(*) > 1
ORDER BY MIN(sentAt) DESC;

-- 4. MARCAR DUPLICADOS COMO ELIMINADOS (SOFT DELETE) - SALAS
-- IMPORTANTE: Esto mantiene el mensaje más antiguo (MIN id) y marca los demás como eliminados
UPDATE messages m
INNER JOIN (
    SELECT 
        `from`, 
        message, 
        time, 
        roomCode,
        MIN(id) as keep_id
    FROM messages
    WHERE isGroup = 1
      AND isDeleted = 0
      AND threadId IS NULL
    GROUP BY `from`, message, time, roomCode
    HAVING COUNT(*) > 1
) duplicates ON 
    m.from = duplicates.from 
    AND m.message = duplicates.message 
    AND m.time = duplicates.time 
    AND m.roomCode = duplicates.roomCode
    AND m.id > duplicates.keep_id
SET 
    m.isDeleted = 1,
    m.deletedAt = NOW(),
    m.deletedBy = 'SYSTEM - Duplicate Cleanup';

-- 5. MARCAR DUPLICADOS COMO ELIMINADOS (SOFT DELETE) - CONVERSACIONES PRIVADAS
UPDATE messages m
INNER JOIN (
    SELECT 
        `from`,
        `to`,
        message, 
        time,
        MIN(id) as keep_id
    FROM messages
    WHERE isGroup = 0
      AND isDeleted = 0
      AND threadId IS NULL
    GROUP BY `from`, `to`, message, time
    HAVING COUNT(*) > 1
) duplicates ON 
    m.from = duplicates.from 
    AND m.to = duplicates.to
    AND m.message = duplicates.message 
    AND m.time = duplicates.time
    AND m.id > duplicates.keep_id
SET 
    m.isDeleted = 1,
    m.deletedAt = NOW(),
    m.deletedBy = 'SYSTEM - Duplicate Cleanup';

-- 6. VERIFICAR CUÁNTOS DUPLICADOS SE MARCARÍAN COMO ELIMINADOS - SALAS
SELECT COUNT(*) as total_duplicates_to_delete
FROM messages m
INNER JOIN (
    SELECT 
        `from`, 
        message, 
        time, 
        roomCode,
        MIN(id) as keep_id
    FROM messages
    WHERE isGroup = 1
      AND isDeleted = 0
      AND threadId IS NULL
    GROUP BY `from`, message, time, roomCode
    HAVING COUNT(*) > 1
) duplicates ON 
    m.from = duplicates.from 
    AND m.message = duplicates.message 
    AND m.time = duplicates.time 
    AND m.roomCode = duplicates.roomCode
    AND m.id > duplicates.keep_id;

-- 7. VERIFICAR CUÁNTOS DUPLICADOS SE MARCARÍAN COMO ELIMINADOS - CONVERSACIONES PRIVADAS
SELECT COUNT(*) as total_duplicates_to_delete
FROM messages m
INNER JOIN (
    SELECT 
        `from`,
        `to`,
        message, 
        time,
        MIN(id) as keep_id
    FROM messages
    WHERE isGroup = 0
      AND isDeleted = 0
      AND threadId IS NULL
    GROUP BY `from`, `to`, message, time
    HAVING COUNT(*) > 1
) duplicates ON 
    m.from = duplicates.from 
    AND m.to = duplicates.to
    AND m.message = duplicates.message 
    AND m.time = duplicates.time
    AND m.id > duplicates.keep_id;

