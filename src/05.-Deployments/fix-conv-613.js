const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    const participants = JSON.stringify(["73583958", "73193256"]);
    const assignedUsers = JSON.stringify(["73583958", "73193256"]);
    const convId = 613;

    const [result] = await connection.execute(`
    UPDATE temporary_conversations 
    SET participants = ?, assignedUsers = ?
    WHERE id = ?
  `, [participants, assignedUsers, convId]);

    console.log('--- Update Result ---');
    console.log(result);

    await connection.end();
}

main().catch(console.error);
