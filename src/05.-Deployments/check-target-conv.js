const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    // Buscamos la conversación entre Dagner y Moises por sus nombres o DNI
    const [rows] = await connection.execute(`
    SELECT id, name, participants, assignedUsers, isActive, createdAt
    FROM temporary_conversations 
    WHERE (participants LIKE '%DAGNER%' OR participants LIKE '%73583958%')
      AND (participants LIKE '%MOISES%' OR participants LIKE '%73193256%')
    ORDER BY createdAt DESC
    LIMIT 1
  `);

    console.log('--- Target Conversation Details ---');
    console.log(JSON.stringify(rows, null, 2));

    await connection.end();
}

main().catch(console.error);
