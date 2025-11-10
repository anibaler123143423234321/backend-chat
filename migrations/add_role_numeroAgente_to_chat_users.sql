-- Migración para agregar campos role y numeroAgente a la tabla chat_users

-- Agregar columna role
ALTER TABLE chat_users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NULL;

-- Agregar columna numeroAgente
ALTER TABLE chat_users ADD COLUMN IF NOT EXISTS numeroAgente VARCHAR(20) NULL;

-- Crear índice para búsquedas más rápidas por role
CREATE INDEX IF NOT EXISTS idx_chat_users_role ON chat_users(role);

-- Crear índice para búsquedas más rápidas por numeroAgente
CREATE INDEX IF NOT EXISTS idx_chat_users_numeroAgente ON chat_users(numeroAgente);

