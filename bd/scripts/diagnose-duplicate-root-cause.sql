-- =====================================================
-- Script para diagnosticar la CAUSA RAÍZ de mensajes duplicados
-- =====================================================

-- 1. VERIFICAR SI HAY DUPLICADOS POR DOBLE ENVÍO DEL CLIENTE
-- Si createdAt tiene diferencia de milisegundos, puede ser doble click o doble envío
SELECT
    `from`,
    LEFT(message, 50) as mensaje,
    time,
    COUNT(*) as total,
    GROUP_CONCAT(id ORDER BY id) as ids,
    GROUP_CONCAT(DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s.%f') ORDER BY id) as created_timestamps,
    GROUP_CONCAT(DATE_FORMAT(sentAt, '%Y-%m-%d %H:%i:%s.%f') ORDER BY id) as sent_timestamps,
    MIN(TIMESTAMPDIFF(MICROSECOND, 
        LAG(createdAt) OVER (PARTITION BY `from`, message ORDER BY createdAt),
        createdAt
    )) as microsegundos_entre_duplicados
FROM messages
WHERE roomCode = '9185B4C2'
  AND DATE(sentAt) = '2024-11-19'
  AND isDeleted = 0
  AND threadId IS NULL
GROUP BY `from`, message, time
HAVING COUNT(*) > 1
ORDER BY total DESC;

-- 2. VERIFICAR SI EL PROBLEMA ES EN EL BACKEND (verificación de duplicados fallando)
-- Busca mensajes con exactamente el mismo from, message, time, roomCode
-- Si la diferencia de tiempo es < 1 segundo, la validación de duplicados falló
SELECT
    m1.id as id1,
    m2.id as id2,
    m1.from,
    LEFT(m1.message, 50) as mensaje,
    m1.time,
    m1.sentAt as sentAt1,
    m2.sentAt as sentAt2,
    TIMESTAMPDIFF(MICROSECOND, m1.sentAt, m2.sentAt) as microsegundos_diferencia,
    m1.createdAt as createdAt1,
    m2.createdAt as createdAt2,
    TIMESTAMPDIFF(MICROSECOND, m1.createdAt, m2.createdAt) as microsegundos_diferencia_createdAt
FROM messages m1
INNER JOIN messages m2 ON 
    m1.from = m2.from 
    AND m1.message = m2.message 
    AND m1.time = m2.time 
    AND m1.roomCode = m2.roomCode
    AND m1.id < m2.id
WHERE m1.roomCode = '9185B4C2'
  AND DATE(m1.sentAt) = '2024-11-19'
  AND m1.isDeleted = 0
  AND m2.isDeleted = 0
  AND m1.threadId IS NULL
  AND m2.threadId IS NULL
ORDER BY m1.from, m1.message, m1.id;

-- 3. VERIFICAR SI HAY PROBLEMA CON LA ZONA HORARIA
-- Si sentAt y createdAt tienen diferencias extrañas, puede ser problema de timezone
SELECT
    id,
    `from`,
    LEFT(message, 50) as mensaje,
    time,
    sentAt,
    createdAt,
    TIMESTAMPDIFF(SECOND, sentAt, createdAt) as segundos_diferencia_sentAt_createdAt,
    CASE
        WHEN TIMESTAMPDIFF(SECOND, sentAt, createdAt) > 300 THEN 'POSIBLE PROBLEMA DE TIMEZONE'
        WHEN TIMESTAMPDIFF(SECOND, sentAt, createdAt) < -300 THEN 'POSIBLE PROBLEMA DE TIMEZONE'
        ELSE 'OK'
    END as diagnostico
FROM messages
WHERE roomCode = '9185B4C2'
  AND DATE(sentAt) = '2024-11-19'
  AND isDeleted = 0
  AND threadId IS NULL
ORDER BY ABS(TIMESTAMPDIFF(SECOND, sentAt, createdAt)) DESC
LIMIT 50;

-- 4. VERIFICAR SI HAY DUPLICADOS POR RECONEXIÓN DE SOCKET
-- Si hay mensajes duplicados con diferencia de varios segundos, puede ser reconexión
SELECT
    `from`,
    LEFT(message, 50) as mensaje,
    COUNT(*) as total,
    MIN(sentAt) as primer_envio,
    MAX(sentAt) as ultimo_envio,
    TIMESTAMPDIFF(SECOND, MIN(sentAt), MAX(sentAt)) as segundos_entre_envios,
    CASE
        WHEN TIMESTAMPDIFF(SECOND, MIN(sentAt), MAX(sentAt)) > 5 THEN 'POSIBLE RECONEXIÓN'
        WHEN TIMESTAMPDIFF(SECOND, MIN(sentAt), MAX(sentAt)) < 1 THEN 'DOBLE CLICK O DOBLE ENVÍO'
        ELSE 'OTRO'
    END as diagnostico
FROM messages
WHERE roomCode = '9185B4C2'
  AND DATE(sentAt) = '2024-11-19'
  AND isDeleted = 0
  AND threadId IS NULL
GROUP BY `from`, message
HAVING COUNT(*) > 1
ORDER BY segundos_entre_envios DESC;

-- 5. VERIFICAR SI HAY DUPLICADOS EN OTRAS SALAS (problema global)
SELECT
    roomCode,
    COUNT(*) as total_mensajes,
    SUM(CASE WHEN es_duplicado = 1 THEN 1 ELSE 0 END) as mensajes_duplicados,
    ROUND(SUM(CASE WHEN es_duplicado = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as porcentaje_duplicados
FROM (
    SELECT
        roomCode,
        CASE 
            WHEN COUNT(*) OVER (PARTITION BY roomCode, `from`, message, time) > 1 THEN 1
            ELSE 0
        END as es_duplicado
    FROM messages
    WHERE DATE(sentAt) = '2024-11-19'
      AND isDeleted = 0
      AND threadId IS NULL
      AND isGroup = 1
) as subquery
GROUP BY roomCode
HAVING mensajes_duplicados > 0
ORDER BY porcentaje_duplicados DESC;

-- 6. VERIFICAR SI EL PROBLEMA ES ESPECÍFICO DE CIERTOS USUARIOS
SELECT
    `from`,
    COUNT(*) as total_mensajes,
    SUM(CASE WHEN es_duplicado = 1 THEN 1 ELSE 0 END) as mensajes_duplicados,
    ROUND(SUM(CASE WHEN es_duplicado = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as porcentaje_duplicados
FROM (
    SELECT
        `from`,
        CASE 
            WHEN COUNT(*) OVER (PARTITION BY roomCode, `from`, message, time) > 1 THEN 1
            ELSE 0
        END as es_duplicado
    FROM messages
    WHERE roomCode = '9185B4C2'
      AND DATE(sentAt) = '2024-11-19'
      AND isDeleted = 0
      AND threadId IS NULL
) as subquery
GROUP BY `from`
HAVING mensajes_duplicados > 0
ORDER BY porcentaje_duplicados DESC;

-- 7. VERIFICAR LOGS DE CREACIÓN (para ver el patrón temporal)
SELECT
    DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i') as minuto,
    COUNT(*) as total_mensajes,
    SUM(CASE WHEN es_duplicado = 1 THEN 1 ELSE 0 END) as duplicados,
    ROUND(SUM(CASE WHEN es_duplicado = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as porcentaje
FROM (
    SELECT
        createdAt,
        CASE 
            WHEN COUNT(*) OVER (PARTITION BY roomCode, `from`, message, time) > 1 THEN 1
            ELSE 0
        END as es_duplicado
    FROM messages
    WHERE roomCode = '9185B4C2'
      AND DATE(sentAt) = '2024-11-19'
      AND isDeleted = 0
      AND threadId IS NULL
) as subquery
GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i')
ORDER BY minuto DESC;

-- 8. VERIFICAR SI HAY PROBLEMA CON threadId NULL
-- A veces los duplicados se crean porque threadId no se maneja correctamente
SELECT
    id,
    `from`,
    LEFT(message, 50) as mensaje,
    threadId,
    replyToMessageId,
    time,
    sentAt
FROM messages
WHERE roomCode = '9185B4C2'
  AND DATE(sentAt) = '2024-11-19'
  AND isDeleted = 0
  AND (threadId IS NOT NULL OR replyToMessageId IS NOT NULL)
ORDER BY sentAt DESC
LIMIT 50;

