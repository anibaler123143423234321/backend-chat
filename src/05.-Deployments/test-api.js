const http = require('http');

http.get('http://localhost:8747/api/temporary-conversations/assigned/list?username=73583958&page=1&limit=5', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const json = JSON.parse(data);
        console.log(JSON.stringify(json.conversations.map(c => ({
            id: c.id,
            name: c.name,
            participants: c.participants
        })), null, 2));
    });
}).on("error", (err) => {
    console.log("Error: " + err.message);
});
