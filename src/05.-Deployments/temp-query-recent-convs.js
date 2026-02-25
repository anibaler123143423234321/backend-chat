const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    const [rows] = await connection.execute(`
    SELECT id, name, participants, assignedUsers, isActive, isAssignedByAdmin, createdAt
    FROM temporary_conversations 
    ORDER BY createdAt DESC
    LIMIT 10
  `);

    console.log('--- Last 10 Temporary Conversations ---');
    console.log(JSON.stringify(rows, null, 2));

    await connection.end();
}

main().catch(console.error);
