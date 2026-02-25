const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    const [rows] = await connection.execute(`
    SELECT id, \`from\`, \`to\`, \`roomCode\`, isRead, readBy 
    FROM messages 
    WHERE (\`from\` LIKE '%hans%' OR \`from\` LIKE '%75607429%')
      AND (\`to\` LIKE '%moises f%' OR \`to\` LIKE '%73193256%')
    ORDER BY id DESC LIMIT 10
  `);

    console.log('--- Messages sent by Hans to Moises ---');
    rows.forEach(r => console.log(JSON.stringify(r)));

    await connection.end();
}

main().catch(console.error);
