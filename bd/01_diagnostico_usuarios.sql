-- ---------------------------------------------------------
-- DIAGNÓSTICO DE USUARIOS FANTASMAS Y ASIGNACIONES
-- ---------------------------------------------------------
-- Objetivo: Identificar usuarios que fueron agregados a salas sin un proceso claro,
-- y verificar quiénes están "asignados" (bloqueados para salir).

-- 1. Buscar la sala de "Soporte" y listar sus detalles clave
--    (Verifica los campos JSON members, assignedMembers y connectedMembers)
SELECT 
    id, 
    name, 
    roomCode, 
    currentMembers, 
    members as historial_miembros, 
    assignedMembers as asignados_fijos, 
    createdBy 
FROM temporary_rooms 
WHERE name LIKE '%Soporte%' OR roomCode LIKE '%soporte%';

-- 2. Buscar en qué salas está metido un usuario específico que se queja
--    (Reemplazar 'NOMBRE_USUARIO' por el username real, ej: 'f.quiroga')
--    Esta consulta busca el string del usuario dentro del array JSON 'members'
SELECT 
    id, 
    name, 
    roomCode, 
    JSON_SEARCH(members, 'one', 'NOMBRE_USUARIO') as match_path,
    isAssignedByAdmin
FROM temporary_rooms 
WHERE JSON_SEARCH(members, 'one', 'NOMBRE_USUARIO') IS NOT NULL;

-- 3. Identificar usuarios ASIGNADOS A LA FUERZA (assignedMembers no vacío)
--    Estos usuarios entrarán automáticamente y no podrán salir si la lógica así lo dicta.
SELECT 
    id, 
    name, 
    roomCode, 
    assignedMembers 
FROM temporary_rooms 
WHERE assignedMembers IS NOT NULL 
  AND JSON_LENGTH(assignedMembers) > 0;

-- 4. Verificación de Conversaciones Asignadas
--    Revisar si el usuario está en conversaciones que el sistema le asignó
SELECT 
    id, 
    name, 
    linkId, 
    participants, 
    assignedUsers 
FROM temporary_conversations 
WHERE assignedUsers IS NOT NULL 
  AND JSON_LENGTH(assignedUsers) > 0;
