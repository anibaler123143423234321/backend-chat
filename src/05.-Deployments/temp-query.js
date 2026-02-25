const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    console.log('--- Messages with HANS AND MOISES ---');
    const [rows] = await connection.execute(`
    SELECT id, \`from\`, \`to\`, \`roomCode\`, isRead, readBy 
    FROM messages 
    WHERE (\`from\` LIKE '%hans%' OR \`to\` LIKE '%hans%' OR \`from\` LIKE '%75607429%' OR \`to\` LIKE '%75607429%')
      AND (\`from\` LIKE '%moises f%' OR \`to\` LIKE '%moises f%' OR \`from\` LIKE '%73193256%' OR \`to\` LIKE '%73193256%')
    ORDER BY id DESC LIMIT 5
  `);
    console.log(JSON.stringify(rows, null, 2));

    console.log('--- Unread query test for Moises ---');
    // Moises DNI: 73193256, Name: MOISES FERNANDO MARIN TANTALEAN
    const username = '73193256';
    const fullName = 'MOISES FERNANDO MARIN TANTALEAN';

    const [counts] = await connection.execute(`
    SELECT 
        m.from as username,
        COUNT(
            CASE 
                WHEN NOT JSON_CONTAINS(COALESCE(m.readBy, JSON_ARRAY()), CAST('"' || ? || '"' AS JSON)) 
                 AND NOT JSON_CONTAINS(COALESCE(m.readBy, JSON_ARRAY()), CAST('"' || ? || '"' AS JSON))
                THEN 1 
            END
        ) as unreadCount
    FROM messages m
    WHERE (
        m.to = ? 
        OR LOWER(TRIM(m.to)) = ?
        OR LOWER(TRIM(m.to)) = ?
    )
    AND m.isDeleted = false
    AND m.from != ?
    AND LOWER(TRIM(m.from)) != ?
    AND m.from != 'system'
    GROUP BY m.from
    HAVING unreadCount > 0
  `, [
        username, fullName, username, username.toLowerCase(), fullName.toLowerCase(), username, fullName.toLowerCase()
    ]);

    console.log(JSON.stringify(counts, null, 2));

    await connection.end();
}

main().catch(console.error);
