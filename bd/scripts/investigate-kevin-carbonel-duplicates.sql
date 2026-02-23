-- =====================================================
-- Investigar mensajes duplicados en GRUPO KEVIN CARBONEL
-- Código de sala: 0CD7E4F4
-- Usuario: 633085020 (María)
-- Mensaje: "Hola María le saluda nuevamente Cesar Salas..."
-- =====================================================

-- 1. VER TODOS LOS MENSAJES DE HOY EN GRUPO KEVIN CARBONEL
SELECT
    id,
    `from`,
    LEFT(message, 80) as mensaje,
    time,
    sentAt,
    createdAt,
    isDeleted,
    roomCode
FROM messages
WHERE roomCode = '0CD7E4F4'
  AND DATE(sentAt) = CURDATE()
  AND isDeleted = 0
ORDER BY sentAt DESC, id DESC;

-- 2. VER ESPECÍFICAMENTE LOS MENSAJES DUPLICADOS DE "633085020"
SELECT
    id,
    `from`,
    message,
    time,
    sentAt,
    createdAt,
    TIMESTAMPDIFF(SECOND, LAG(sentAt) OVER (ORDER BY sentAt), sentAt) as segundos_desde_anterior
FROM messages
WHERE roomCode = '0CD7E4F4'
  AND `from` = '633085020'
  AND DATE(sentAt) = CURDATE()
  AND isDeleted = 0
ORDER BY sentAt, id;

-- 3. BUSCAR EL MENSAJE ESPECÍFICO QUE SE VE DUPLICADO
-- "Hola María le saluda nuevamente Cesar Salas usted me dijo que la llamara a esta hora"
SELECT
    id,
    `from`,
    message,
    time,
    sentAt,
    createdAt,
    TIMESTAMPDIFF(MICROSECOND, sentAt, createdAt) as diff_microsegundos
FROM messages
WHERE roomCode = '0CD7E4F4'
  AND message LIKE '%Hola María le saluda nuevamente Cesar Salas%'
  AND isDeleted = 0
ORDER BY sentAt, id;

-- 4. CONTAR CUÁNTAS VECES APARECE CADA MENSAJE DUPLICADO
SELECT
    `from`,
    LEFT(message, 60) as mensaje,
    time,
    COUNT(*) as veces_repetido,
    GROUP_CONCAT(id ORDER BY id) as ids,
    MIN(sentAt) as primera_vez,
    MAX(sentAt) as ultima_vez,
    TIMESTAMPDIFF(SECOND, MIN(sentAt), MAX(sentAt)) as segundos_diferencia
FROM messages
WHERE roomCode = '0CD7E4F4'
  AND DATE(sentAt) = CURDATE()
  AND isDeleted = 0
GROUP BY `from`, message, time
HAVING COUNT(*) > 1
ORDER BY veces_repetido DESC, MIN(sentAt) DESC;

-- 5. VER TODOS LOS DUPLICADOS EN GRUPO KEVIN CARBONEL (HOY)
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
    m2.createdAt as createdAt2
FROM messages m1
INNER JOIN messages m2 ON 
    m1.from = m2.from 
    AND m1.message = m2.message 
    AND m1.time = m2.time 
    AND m1.roomCode = m2.roomCode
    AND m1.id < m2.id
WHERE m1.roomCode = '0CD7E4F4'
  AND DATE(m1.sentAt) = CURDATE()
  AND m1.isDeleted = 0
  AND m2.isDeleted = 0
ORDER BY m1.from, m1.sentAt;

-- 6. VER ESTADÍSTICAS GENERALES DEL GRUPO
SELECT
    COUNT(*) as total_mensajes,
    COUNT(DISTINCT `from`) as usuarios_activos,
    COUNT(DISTINCT CONCAT(`from`, message, time)) as mensajes_unicos,
    COUNT(*) - COUNT(DISTINCT CONCAT(`from`, message, time)) as duplicados_estimados,
    MIN(sentAt) as primer_mensaje,
    MAX(sentAt) as ultimo_mensaje
FROM messages
WHERE roomCode = '0CD7E4F4'
  AND DATE(sentAt) = CURDATE()
  AND isDeleted = 0;

-- 7. VER MENSAJES RECIENTES (ÚLTIMOS 20)
SELECT
    id,
    `from`,
    LEFT(message, 60) as mensaje,
    time,
    DATE_FORMAT(sentAt, '%H:%i:%s') as hora_envio,
    DATE_FORMAT(createdAt, '%H:%i:%s') as hora_creacion
FROM messages
WHERE roomCode = '0CD7E4F4'
  AND isDeleted = 0
ORDER BY id DESC
LIMIT 20;

-- 8. BUSCAR PATRONES DE DUPLICACIÓN POR USUARIO
SELECT
    `from` as usuario,
    COUNT(*) as total_mensajes,
    COUNT(DISTINCT CONCAT(message, time)) as mensajes_unicos,
    COUNT(*) - COUNT(DISTINCT CONCAT(message, time)) as duplicados,
    ROUND((COUNT(*) - COUNT(DISTINCT CONCAT(message, time))) * 100.0 / COUNT(*), 2) as porcentaje_duplicados
FROM messages
WHERE roomCode = '0CD7E4F4'
  AND DATE(sentAt) = CURDATE()
  AND isDeleted = 0
GROUP BY `from`
HAVING duplicados > 0
ORDER BY duplicados DESC;

