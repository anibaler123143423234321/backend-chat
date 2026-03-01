const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas',
        port: 3306
    });

    try {
        const [cols] = await connection.execute('SHOW COLUMNS FROM chat_users;');
        console.log("chat_users columns:", cols.map(c => c.Field));
    } catch (e) {
        console.error(e);
    } finally {
        await connection.end();
    }
}

main();
