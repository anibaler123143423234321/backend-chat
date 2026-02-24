SELECT 
    tc.id, 
    tc.name, 
    (SELECT COUNT(*) FROM messages m WHERE m.conversationId = tc.id) as total_mensajes,
    tc.isActive,
    tc.createdAt
FROM temporary_conversations tc
JOIN (
    -- Esta subconsulta identifica los pares que tienen más de un registro
    SELECT 
        LEAST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[1]')))) as u1,
        GREATEST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[1]')))) as u2
    FROM temporary_conversations
    WHERE isAssignedByAdmin = 1
    GROUP BY 
        LEAST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[1]')))),
        GREATEST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[1]'))))
    HAVING COUNT(*) > 1
) dup ON 
    LEAST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(tc.participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(tc.participants, '$[1]')))) = dup.u1 AND
    GREATEST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(tc.participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(tc.participants, '$[1]')))) = dup.u2
ORDER BY total_mensajes DESC, tc.id DESC;


UPDATE messages m
JOIN (
    SELECT 
        MAX(id) as target_id,
        LEAST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[1]')))) as u1,
        GREATEST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[1]')))) as u2
    FROM temporary_conversations
    WHERE isAssignedByAdmin = 1
    GROUP BY u1, u2
) target ON 
    LEAST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(m.participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(m.participants, '$[1]')))) = target.u1 AND
    GREATEST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(m.participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(m.participants, '$[1]')))) = target.u2
SET m.conversationId = target.target_id
WHERE m.isGroup = 0; -- Solo para chats privados/asignados


DELETE tc 
FROM temporary_conversations tc
JOIN (
    SELECT 
        MAX(id) as keep_id,
        LEAST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[1]')))) as u1,
        GREATEST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(participants, '$[1]')))) as u2
    FROM temporary_conversations
    WHERE isAssignedByAdmin = 1
    GROUP BY u1, u2
) to_keep ON 
    LEAST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(tc.participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(tc.participants, '$[1]')))) = to_keep.u1 AND
    GREATEST(UPPER(JSON_UNQUOTE(JSON_EXTRACT(tc.participants, '$[0]'))), UPPER(JSON_UNQUOTE(JSON_EXTRACT(tc.participants, '$[1]')))) = to_keep.u2
WHERE tc.id != to_keep.keep_id;
