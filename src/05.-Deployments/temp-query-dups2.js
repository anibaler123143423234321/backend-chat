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
    SELECT id, email, username, nombre, apellido, role, picture 
    FROM chat_users 
    WHERE username LIKE '%73193256%' 
       OR email LIKE '%73193256%' 
       OR email LIKE '%moises%' 
       OR nombre LIKE '%MOISES%' 
       OR apellido LIKE '%TANTALEAN%'
       OR username LIKE '%MOISES%'
  `);

    fs.writeFileSync('dups.json', JSON.stringify(rows, null, 2));
    console.log('Saved to dups.json');

    await connection.end();
}

main().catch(console.error);
