-- Agregar campo readAt a la tabla messages
ALTER TABLE messages 
ADD COLUMN readAt DATETIME NULL AFTER isRead;

-- Comentario: Este campo almacena la fecha y hora en que el mensaje fue leído

