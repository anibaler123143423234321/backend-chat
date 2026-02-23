-- =====================================================
-- SCRIPT COMPLETO PARA ELIMINAR DUPLICADOS
-- Grupo: GRUPO VIDARTE (9185B4C2)
-- Fecha: 19-11-2025
-- =====================================================
-- Este script elimina duplicados de forma segura y muestra estadísticas
-- =====================================================

-- PASO 1: Ver estadísticas ANTES de la limpieza
SELECT '=== ESTADÍSTICAS ANTES DE LA LIMPIEZA ===' as '';

SELECT
    COUNT(*) as total_mensajes,
    COUNT(DISTINCT CONCAT(`from`, message, time)) as mensajes_unicos,
    COUNT(*) - COUNT(DISTINCT CONCAT(`from`, message, time)) as duplicados_estimados
FROM messages
WHERE roomCode = '9185B4C2'
  AND DATE(sentAt) = '2025-11-19'
  AND isDeleted = 0
  AND threadId IS NULL;

-- PASO 2: Ver grupos de duplicados
SELECT '=== GRUPOS DE MENSAJES DUPLICADOS ===' as '';

SELECT
    `from` as usuario,
    LEFT(message, 40) as mensaje,
    COUNT(*) as cantidad,
    GROUP_CONCAT(id ORDER BY id) as ids
FROM messages
WHERE roomCode = '9185B4C2'
  AND DATE(sentAt) = '2025-11-19'
  AND isDeleted = 0
  AND threadId IS NULL
GROUP BY `from`, message, time
HAVING COUNT(*) > 1
ORDER BY cantidad DESC;

-- PASO 3: Desactivar modo seguro
SET SQL_SAFE_UPDATES = 0;

-- PASO 4: EJECUTAR LIMPIEZA - ELIMINAR duplicados PERMANENTEMENTE
SELECT '=== EJECUTANDO ELIMINACIÓN DE DUPLICADOS ===' as '';

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

-- PASO 5: Reactivar modo seguro
SET SQL_SAFE_UPDATES = 1;

-- PASO 6: Ver estadísticas DESPUÉS de la limpieza
SELECT '=== ESTADÍSTICAS DESPUÉS DE LA LIMPIEZA ===' as '';

SELECT
    COUNT(*) as total_mensajes_activos,
    COUNT(DISTINCT CONCAT(`from`, message, time)) as mensajes_unicos
FROM messages
WHERE roomCode = '9185B4C2'
  AND DATE(sentAt) = '2025-11-19'
  AND isDeleted = 0
  AND threadId IS NULL;

-- PASO 7: Mostrar resultado de la eliminación
SELECT '=== RESULTADO DE LA ELIMINACIÓN ===' as '';

SELECT ROW_COUNT() as 'Total de mensajes ELIMINADOS permanentemente';

-- PASO 8: Verificar que NO quedan duplicados
SELECT '=== VERIFICACIÓN FINAL - NO DEBEN QUEDAR DUPLICADOS ===' as '';

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

-- Si esta última consulta no devuelve filas, ¡la limpieza fue exitosa! ✅

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================
-- NOTA: Los mensajes duplicados fueron ELIMINADOS PERMANENTEMENTE
-- de la base de datos. No hay forma de recuperarlos.
-- Se mantuvo el mensaje original (con el ID más bajo).
-- =====================================================

