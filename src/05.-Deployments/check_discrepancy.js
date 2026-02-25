
const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkDiscrepancy() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        port: process.env.DB_PORT
    });

    console.log('--- Buscando por Username 76354306 ---');
    const [rowsByUsername] = await connection.execute("SELECT id, username, nombre, apellido, email FROM chat_users WHERE username = '76354306'");
    console.log('Encontrados por username:', JSON.stringify(rowsByUsername, null, 2));

    console.log('\n--- Buscando por ID 445 ---');
    const [rowsById] = await connection.execute("SELECT id, username, nombre, apellido, email FROM chat_users WHERE id = 445");
    console.log('Encontrados por ID 445:', JSON.stringify(rowsById, null, 2));

    console.log('\n--- Buscando por Nombre JEAR CHRISTIAN ---');
    const [rowsByName] = await connection.execute("SELECT id, username, nombre, apellido, email FROM chat_users WHERE nombre LIKE '%JEAR%CHRISTIAN%'");
    console.log('Encontrados por nombre:', JSON.stringify(rowsByName, null, 2));

    await connection.end();
}

checkDiscrepancy().catch(console.error);
