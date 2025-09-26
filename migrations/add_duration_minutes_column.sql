-- Agregar columna durationMinutes a la tabla temporary_rooms
ALTER TABLE temporary_rooms 
ADD COLUMN durationMinutes INT NULL;

-- Actualizar las salas existentes con la duración calculada
UPDATE temporary_rooms 
SET durationMinutes = TIMESTAMPDIFF(MINUTE, createdAt, expiresAt)
WHERE durationMinutes IS NULL;
