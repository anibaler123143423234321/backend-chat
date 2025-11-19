-- =====================================================
-- Script para investigar mensajes duplicados en GRUPO VIDARTE
-- Código de sala: 9185B4C2
-- Fecha: 19-11-2024
-- =====================================================

-- 1. VER TODOS LOS MENSAJES DUPLICADOS EN GRUPO VIDARTE (19-11-2024)
-- Esta consulta muestra los mensajes que aparecen más de una vez
SELECT
    id,
    `from`,
    message,
    time,
    sentAt,
    roomCode,
    isDeleted,
    createdAt,
    updatedAt
FROM messages
WHERE roomCode = '9185B4C2'
  AND DATE(sentAt) = '2025-11-19'
  AND isDeleted = 0
  AND threadId IS NULL
ORDER BY `from`, message, sentAt;

-- 2. ENCONTRAR GRUPOS DE MENSAJES DUPLICADOS (con conteo)
-- Muestra cuántas veces se repite cada mensaje
SELECT
    `from`,
    LEFT(message, 50) as mensaje_preview,
    time,
    roomCode,
    COUNT(*) as cantidad_duplicados,
    GROUP_CONCAT(id ORDER BY id) as ids_duplicados,
    MIN(id) as id_a_mantener,
    MIN(sentAt) as primera_fecha,
    MAX(sentAt) as ultima_fecha,
    TIMESTAMPDIFF(SECOND, MIN(sentAt), MAX(sentAt)) as segundos_diferencia
FROM messages
WHERE roomCode = '9185B4C2'
  AND DATE(sentAt) = '2025-11-19'
  AND isDeleted = 0
  AND threadId IS NULL
GROUP BY `from`, message, time, roomCode
HAVING COUNT(*) > 1
ORDER BY cantidad_duplicados DESC, MIN(sentAt) DESC;

-- 3. VER DETALLES COMPLETOS DE UN MENSAJE ESPECÍFICO DUPLICADO
-- Reemplaza 'JERAMIS ALEXANDER LOPEZ BURGA' con el nombre del usuario
-- y ajusta el texto del mensaje según lo que veas duplicado
SELECT
    id,
    `from`,
    fromId,
    message,
    time,
    sentAt,
    createdAt,
    updatedAt,
    TIMESTAMPDIFF(SECOND, sentAt, createdAt) as diferencia_sentAt_createdAt,
    roomCode,
    isDeleted
FROM messages
WHERE roomCode = '9185B4C2'
  AND `from` LIKE '%JERAMIS%'
  AND DATE(sentAt) = '2025-11-19'
  AND isDeleted = 0
ORDER BY sentAt, id;

-- 4. VERIFICAR SI HAY DUPLICADOS POR PROBLEMA DE ZONA HORARIA
-- Busca mensajes con el mismo contenido pero diferentes timestamps
SELECT
    `from`,
    message,
    COUNT(*) as total,
    GROUP_CONCAT(DISTINCT time ORDER BY time) as diferentes_times,
    GROUP_CONCAT(DISTINCT DATE_FORMAT(sentAt, '%Y-%m-%d %H:%i:%s') ORDER BY sentAt) as diferentes_sentAt,
    GROUP_CONCAT(id ORDER BY id) as ids
FROM messages
WHERE roomCode = '9185B4C2'
  AND DATE(sentAt) = '2025-11-19'
  AND isDeleted = 0
  AND threadId IS NULL
GROUP BY `from`, message
HAVING COUNT(*) > 1
ORDER BY total DESC;

-- 5. CONTAR TOTAL DE DUPLICADOS EN GRUPO VIDARTE HOY
SELECT 
    COUNT(*) as total_mensajes_duplicados,
    SUM(cantidad - 1) as mensajes_a_eliminar
FROM (
    SELECT 
        COUNT(*) as cantidad
    FROM messages
    WHERE roomCode = '9185B4C2'
      AND DATE(sentAt) = '2025-11-19'
      AND isDeleted = 0
      AND threadId IS NULL
    GROUP BY `from`, message, time, roomCode
    HAVING COUNT(*) > 1
) as duplicados;

-- 6. VER MENSAJES DUPLICADOS CON INFORMACIÓN DE USUARIO
SELECT
    m.id,
    m.from,
    m.fromId,
    cu.numeroAgente,
    cu.role,
    LEFT(m.message, 100) as mensaje,
    m.time,
    m.sentAt,
    m.createdAt
FROM messages m
LEFT JOIN chat_users cu ON m.from = cu.username OR m.fromId = cu.id
WHERE m.roomCode = '9185B4C2'
  AND DATE(m.sentAt) = '2025-11-19'
  AND m.isDeleted = 0
  AND m.threadId IS NULL
  AND EXISTS (
    SELECT 1 
    FROM messages m2 
    WHERE m2.roomCode = m.roomCode 
      AND m2.from = m.from 
      AND m2.message = m.message 
      AND m2.time = m.time 
      AND m2.id != m.id
      AND m2.isDeleted = 0
  )
ORDER BY m.from, m.message, m.sentAt;

-- =====================================================
-- SOLUCIÓN: MARCAR DUPLICADOS COMO ELIMINADOS
-- =====================================================

-- 7. PREVIEW: Ver qué mensajes se marcarían como eliminados (SIN EJECUTAR CAMBIOS)
-- Mantiene el mensaje con el ID más bajo (el primero que llegó)
SELECT 
    m.id,
    m.from,
    LEFT(m.message, 50) as mensaje,
    m.time,
    m.sentAt,
    'SE ELIMINARÁ' as accion
FROM messages m
INNER JOIN (
    SELECT 
        `from`, 
        message, 
        time, 
        roomCode,
        MIN(id) as keep_id
    FROM messages
    WHERE roomCode = '9185B4C2'
      AND DATE(sentAt) = '2025-11-19'
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
ORDER BY m.from, m.message, m.id;

-- 8. EJECUTAR: ELIMINAR duplicados PERMANENTEMENTE (DELETE)
-- ⚠️ IMPORTANTE: Ejecuta primero la consulta #7 para verificar qué se eliminará
-- Esta consulta mantiene el mensaje más antiguo (MIN id) y ELIMINA los demás PERMANENTEMENTE

-- Desactivar modo seguro temporalmente
SET SQL_SAFE_UPDATES = 0;

-- Ejecutar DELETE para eliminar duplicados PERMANENTEMENTE
DELETE m FROM messages m
INNER JOIN (
    SELECT
        `from`,
        message,
        time,
        roomCode,
        MIN(id) as keep_id
    FROM messages
    WHERE roomCode = '9185B4C2'
      AND DATE(sentAt) = '2025-11-19'
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

-- Reactivar modo seguro
SET SQL_SAFE_UPDATES = 1;

-- Mostrar cuántos duplicados se eliminaron
SELECT ROW_COUNT() as 'Mensajes ELIMINADOS permanentemente';

-- 9. VERIFICAR DESPUÉS DE LA LIMPIEZA
-- Ejecuta esta consulta después del UPDATE para confirmar que no quedan duplicados
SELECT
    `from`,
    message,
    time,
    COUNT(*) as count
FROM messages
WHERE roomCode = '9185B4C2'
  AND DATE(sentAt) = '2025-11-19'
  AND isDeleted = 0
  AND threadId IS NULL
GROUP BY `from`, message, time
HAVING COUNT(*) > 1;

