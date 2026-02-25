const mysql = require('mysql2/promise');
const fs = require('fs');

async function main() {
    const connection = await mysql.createConnection({
        host: '198.46.186.2',
        user: 'usuarioCrm2',
        password: 'Midas*2025%',
        database: 'chat_midas'
    });

    console.log("--- LATEST MESSAGES DUMP ---");
    const [messages] = await connection.execute(
        `SELECT id, message, \`from\`, \`to\`, isGroup, conversationId, sentAt 
     FROM messages 
     ORDER BY sentAt DESC 
     LIMIT 20;`
    );

    fs.writeFileSync('messages-dump.json', JSON.stringify(messages, null, 2));
    console.log("Dumped to messages-dump.json");

    await connection.end();
}

main().catch(console.error);
