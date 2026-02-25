const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    const [rows] = await connection.execute(
        'SELECT members FROM temporary_rooms WHERE roomCode = ?',
        ['AB26587A']
    );

    if (rows.length > 0) {
        console.log('Members:', rows[0].members);
    } else {
        console.log('Room not found');
    }

    await connection.end();
}

main().catch(console.error);
