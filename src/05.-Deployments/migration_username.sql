-- =============================================
-- MIGRACIÓN: chat_users.username → DNI
-- 1. Crear tabla temporal de mapeo
-- 2. Eliminar duplicados (quedarse con el más reciente)
-- 3. Actualizar username a DNI (extraído del email)
-- =============================================

-- PASO 0: Ver duplicados actuales
SELECT '=== DUPLICADOS ACTUALES ===' as step;
SELECT id, username, email, updatedAt 
FROM chat_users 
WHERE email IN (SELECT email FROM chat_users GROUP BY email HAVING COUNT(*) > 1) 
ORDER BY email, updatedAt DESC;

-- PASO 1: Crear tabla temporal de mapeo old_username → new_username (DNI)
DROP TABLE IF EXISTS tmp_user_mapping;
CREATE TEMPORARY TABLE tmp_user_mapping AS
SELECT 
  cu.id,
  cu.username AS old_username,
  SUBSTRING_INDEX(cu.email, '@', 1) AS new_username,
  cu.email,
  cu.updatedAt,
  ROW_NUMBER() OVER (PARTITION BY cu.email ORDER BY cu.updatedAt DESC) as rn
FROM chat_users cu
WHERE cu.email IS NOT NULL AND cu.email != '';

SELECT '=== MAPEO CREADO ===' as step;
SELECT COUNT(*) as total_mapped FROM tmp_user_mapping;

-- PASO 2: Ver qué duplicados se van a eliminar (rn > 1 = los más viejos)
SELECT '=== DUPLICADOS A ELIMINAR (rn > 1) ===' as step;
SELECT id, old_username, new_username, email, rn 
FROM tmp_user_mapping 
WHERE rn > 1 
ORDER BY email;

-- PASO 3: Eliminar duplicados (quedarse SOLO con el más reciente por email)
-- Primero verificar que no haya foreign keys apuntando a estos IDs
SELECT '=== VERIFICANDO FOREIGN KEYS ===' as step;
SELECT 'conversation_favorites' as tabla, COUNT(*) as refs
FROM conversation_favorites cf 
INNER JOIN tmp_user_mapping tm ON cf.username = tm.old_username AND tm.rn > 1
UNION ALL
SELECT 'room_favorites', COUNT(*) 
FROM room_favorites rf 
INNER JOIN tmp_user_mapping tm ON rf.username = tm.old_username AND tm.rn > 1;

-- PASO 4: Eliminar los duplicados viejos
DELETE cu FROM chat_users cu
INNER JOIN tmp_user_mapping tm ON cu.id = tm.id AND tm.rn > 1;

SELECT '=== DUPLICADOS ELIMINADOS ===' as step;
SELECT COUNT(*) as usuarios_restantes FROM chat_users;

-- PASO 5: Actualizar username a DNI (usando el email)
-- Solo actualizar los que NO son ya numéricos y tienen email válido
UPDATE chat_users 
SET username = SUBSTRING_INDEX(email, '@', 1) 
WHERE email IS NOT NULL 
  AND email != ''
  AND email LIKE '%@%'
  AND username NOT REGEXP '^[0-9]+$'
  AND SUBSTRING_INDEX(email, '@', 1) REGEXP '^[0-9]+$';

SELECT '=== USERNAMES ACTUALIZADOS A DNI ===' as step;

-- PASO 6: Verificar resultado
SELECT '=== USUARIOS CON DNI COMO USERNAME ===' as step;
SELECT COUNT(*) as con_dni FROM chat_users WHERE username REGEXP '^[0-9]+$';

SELECT '=== USUARIOS SIN DNI (especiales) ===' as step;
SELECT id, username, email FROM chat_users WHERE username NOT REGEXP '^[0-9]+$';

-- PASO 7: Verificar que no haya duplicados de username
SELECT '=== VERIFICAR NO HAY DUPLICADOS DE USERNAME ===' as step;
SELECT username, COUNT(*) as cnt FROM chat_users GROUP BY username HAVING cnt > 1;

-- Limpiar
DROP TABLE IF EXISTS tmp_user_mapping;

SELECT '=== MIGRACIÓN COMPLETADA ===' as step;
