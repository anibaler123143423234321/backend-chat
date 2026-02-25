const mysql = require('mysql2/promise');
const fs = require('fs');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    const [rows] = await connection.execute(`
    SELECT id, \`from\`, \`to\`, isRead, readBy 
    FROM messages 
    WHERE (\`from\` LIKE '%hans%' OR \`from\` LIKE '%75607429%')
      AND (\`to\` LIKE '%moises f%' OR \`to\` LIKE '%73193256%')
    ORDER BY id DESC LIMIT 20
  `);

    fs.writeFileSync('db_output.json', JSON.stringify(rows, null, 2));
    console.log('Saved to db_output.json');

    await connection.end();
}

main().catch(console.error);
