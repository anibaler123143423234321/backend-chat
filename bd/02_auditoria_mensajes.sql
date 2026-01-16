-- ---------------------------------------------------------
-- AUDITORÍA DE MENSAJES DE SISTEMA
-- ---------------------------------------------------------
-- Objetivo: Encontrar "rastros" de quién agregó a quién buscando en el texto de los mensajes.
-- NestJS suele generar mensajes de sistema cuando alguien se une o es agregado.

-- 1. Filtrar mensajes que contengan palabras clave de acción de unirse/agregar
--    Busca en los últimos 500 mensajes para no saturar.
SELECT 
    id, 
    `from` as remitente, 
    `to` as destinatario, 
    message as contenido, 
    roomCode, 
    isGroup, 
    sentAt 
FROM messages 
WHERE 
    (message LIKE '%agregó a%' 
     OR message LIKE '%añadió a%' 
     OR message LIKE '%se unió%' 
     OR message LIKE '%bienvenido%'
     OR senderRole = 'system') -- Si usas senderRole='system'
ORDER BY sentAt DESC 
LIMIT 100;

-- 2. Auditoría específica de unsala (Reemplazar 'ROOM_CODE')
--    Ver todos los mensajes de una sala específica ordenados cronológicamente
--    para reconstruir la historia de eventos.
-- SELECT 
--     id, 
--     `from`, 
--     message, 
--     sentAt 
-- FROM messages 
-- WHERE roomCode = 'ROOM_CODE_AQUI' 
-- ORDER BY sentAt DESC;
