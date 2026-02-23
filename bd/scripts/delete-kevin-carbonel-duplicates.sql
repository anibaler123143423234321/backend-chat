-- =====================================================
-- ELIMINAR DUPLICADOS EN GRUPO KEVIN CARBONEL
-- Código de sala: 0CD7E4F4
-- Fecha: 19-11-2025
-- =====================================================

-- PASO 1: Ver cuántos duplicados hay ANTES de eliminar
SELECT '=== ANTES DE ELIMINAR ===' as '';

SELECT
    `from` as usuario,
    COUNT(*) as total_mensajes,
    COUNT(DISTINCT CONCAT(message, time)) as mensajes_unicos,
    COUNT(*) - COUNT(DISTINCT CONCAT(message, time)) as duplicados_a_eliminar
FROM messages
WHERE roomCode = '0CD7E4F4'
  AND DATE(sentAt) = CURDATE()
  AND isDeleted = 0
GROUP BY `from`
HAVING duplicados_a_eliminar > 0
ORDER BY duplicados_a_eliminar DESC;

-- PASO 2: Ver PREVIEW de qué mensajes se eliminarán
SELECT '=== PREVIEW - MENSAJES QUE SE ELIMINARÁN ===' as '';

SELECT 
    m.id,
    m.from,
    LEFT(m.message, 60) as mensaje,
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
    WHERE roomCode = '0CD7E4F4'
      AND DATE(sentAt) = CURDATE()
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

-- PASO 3: Contar cuántos se eliminarán
SELECT '=== TOTAL A ELIMINAR ===' as '';

SELECT COUNT(*) as total_mensajes_a_eliminar
FROM messages m
INNER JOIN (
    SELECT 
        `from`, 
        message, 
        time, 
        roomCode,
        MIN(id) as keep_id
    FROM messages
    WHERE roomCode = '0CD7E4F4'
      AND DATE(sentAt) = CURDATE()
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

-- PASO 4: EJECUTAR ELIMINACIÓN
SELECT '=== EJECUTANDO ELIMINACIÓN ===' as '';

SET SQL_SAFE_UPDATES = 0;

DELETE m FROM messages m
INNER JOIN (
    SELECT 
        `from`, 
        message, 
        time, 
        roomCode,
        MIN(id) as keep_id
    FROM messages
    WHERE roomCode = '0CD7E4F4'
      AND DATE(sentAt) = CURDATE()
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

SET SQL_SAFE_UPDATES = 1;

SELECT ROW_COUNT() as 'Mensajes eliminados';

-- PASO 5: Verificar DESPUÉS de eliminar
SELECT '=== DESPUÉS DE ELIMINAR ===' as '';

SELECT
    `from` as usuario,
    COUNT(*) as total_mensajes,
    COUNT(DISTINCT CONCAT(message, time)) as mensajes_unicos,
    COUNT(*) - COUNT(DISTINCT CONCAT(message, time)) as duplicados_restantes
FROM messages
WHERE roomCode = '0CD7E4F4'
  AND DATE(sentAt) = CURDATE()
  AND isDeleted = 0
GROUP BY `from`
ORDER BY total_mensajes DESC;

-- PASO 6: Verificación final - NO deben quedar duplicados
SELECT '=== VERIFICACIÓN FINAL ===' as '';

SELECT
    `from`,
    message,
    time,
    COUNT(*) as count
FROM messages
WHERE roomCode = '0CD7E4F4'
  AND DATE(sentAt) = CURDATE()
  AND isDeleted = 0
  AND threadId IS NULL
GROUP BY `from`, message, time
HAVING COUNT(*) > 1;

-- Si esta consulta no devuelve filas, ¡la limpieza fue exitosa! ✅

SELECT '=== LIMPIEZA COMPLETADA ===' as '';

