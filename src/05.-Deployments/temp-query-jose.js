const mysql = require('mysql2/promise');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    const [rows] = await connection.execute(`
    SELECT id, email, username, nombre, apellido, role
    FROM chat_users 
    WHERE nombre LIKE '%JOSE%' AND apellido LIKE '%TORRES%'
       OR username LIKE '%JOSE%'
  `);

    console.log('--- Chat Users Matched ---');
    console.log(JSON.stringify(rows, null, 2));

    await connection.end();
}

main().catch(console.error);
