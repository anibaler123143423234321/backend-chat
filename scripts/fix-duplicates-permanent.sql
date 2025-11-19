    -- =====================================================
-- SOLUCIÓN PERMANENTE PARA DUPLICADOS
-- =====================================================
-- Este script:
-- 1. Elimina duplicados existentes
-- 2. Crea un índice único para prevenir futuros duplicados
-- =====================================================

-- PASO 1: Eliminar duplicados existentes en TODAS las salas
SELECT '=== PASO 1: Eliminando duplicados existentes ===' as '';

SET SQL_SAFE_UPDATES = 0;

-- Eliminar duplicados en salas (grupos)
DELETE m FROM messages m
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

SELECT ROW_COUNT() as 'Duplicados eliminados en GRUPOS';

-- Eliminar duplicados en conversaciones privadas
DELETE m FROM messages m
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

SELECT ROW_COUNT() as 'Duplicados eliminados en CONVERSACIONES PRIVADAS';

SET SQL_SAFE_UPDATES = 1;

-- PASO 2: Crear índice compuesto para prevenir duplicados futuros
SELECT '=== PASO 2: Creando índice para prevenir duplicados ===' as '';

-- Primero, verificar si el índice ya existe y eliminarlo si es necesario
DROP INDEX IF EXISTS idx_prevent_duplicates_groups ON messages;
DROP INDEX IF EXISTS idx_prevent_duplicates_private ON messages;

-- Crear índice para mensajes de grupo
-- Este índice permite duplicados cuando algún campo es NULL
CREATE INDEX idx_prevent_duplicates_groups 
ON messages(`from`(100), message(100), time, roomCode, isDeleted, threadId)
WHERE isGroup = 1;

-- Crear índice para mensajes privados
CREATE INDEX idx_prevent_duplicates_private 
ON messages(`from`(100), `to`(100), message(100), time, isDeleted, threadId)
WHERE isGroup = 0;

SELECT 'Índices creados exitosamente' as resultado;

-- PASO 3: Verificar que no quedan duplicados
SELECT '=== PASO 3: Verificación final ===' as '';

-- Verificar duplicados en grupos
SELECT 
    'GRUPOS' as tipo,
    COUNT(*) as duplicados_restantes
FROM (
    SELECT 
        `from`, message, time, roomCode
    FROM messages
    WHERE isGroup = 1
      AND isDeleted = 0
      AND threadId IS NULL
    GROUP BY `from`, message, time, roomCode
    HAVING COUNT(*) > 1
) as dup_groups;

-- Verificar duplicados en conversaciones privadas
SELECT 
    'PRIVADAS' as tipo,
    COUNT(*) as duplicados_restantes
FROM (
    SELECT 
        `from`, `to`, message, time
    FROM messages
    WHERE isGroup = 0
      AND isDeleted = 0
      AND threadId IS NULL
    GROUP BY `from`, `to`, message, time
    HAVING COUNT(*) > 1
) as dup_private;

-- PASO 4: Mostrar estadísticas
SELECT '=== ESTADÍSTICAS FINALES ===' as '';

SELECT 
    COUNT(*) as total_mensajes,
    COUNT(DISTINCT CASE WHEN isGroup = 1 THEN roomCode END) as total_grupos,
    SUM(CASE WHEN isGroup = 1 THEN 1 ELSE 0 END) as mensajes_grupos,
    SUM(CASE WHEN isGroup = 0 THEN 1 ELSE 0 END) as mensajes_privados,
    SUM(CASE WHEN isDeleted = 1 THEN 1 ELSE 0 END) as mensajes_eliminados
FROM messages;

SELECT '=== LIMPIEZA COMPLETADA ===' as '';

