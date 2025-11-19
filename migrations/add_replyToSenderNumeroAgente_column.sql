-- Migration: Add replyToSenderNumeroAgente column to messages table
-- This column stores the agent number of the original sender when replying to messages

ALTER TABLE messages 
ADD COLUMN replyToSenderNumeroAgente VARCHAR(20) NULL 
COMMENT 'Número de agente del remitente original al responder a un mensaje';

-- Update existing reply messages to include the agent number from the original sender
-- This will populate the new column for existing reply messages
UPDATE messages m1 
SET replyToSenderNumeroAgente = (
    SELECT cu.numeroAgente 
    FROM chat_users cu 
    WHERE cu.username = m1.replyToSender 
    LIMIT 1
)
WHERE m1.replyToMessageId IS NOT NULL 
AND m1.replyToSender IS NOT NULL;

-- Create index for better query performance
CREATE INDEX idx_messages_replyToSenderNumeroAgente ON messages(replyToSenderNumeroAgente);