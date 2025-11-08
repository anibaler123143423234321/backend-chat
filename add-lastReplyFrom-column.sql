-- Agregar columna lastReplyFrom a la tabla messages
ALTER TABLE messages 
ADD COLUMN lastReplyFrom VARCHAR(255) NULL 
COMMENT 'Nombre del último usuario que respondió en el hilo';

