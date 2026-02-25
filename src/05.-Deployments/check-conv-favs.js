const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    const [rows] = await connection.execute(
        'SELECT username, COUNT(*) as count FROM conversation_favorites GROUP BY username'
    );

    console.log('Conversation Favorites by Identifier:');
    console.log(JSON.stringify(rows, null, 2));

    await connection.end();
}

main().catch(console.error);
