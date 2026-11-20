import express from 'express';
import initSqlJs from 'sql.js';

const SQL = await initSqlJs();
const db = new SQL.Database();
db.run("CREATE TABLE users (username TEXT NOT NULL, password TEXT NOT NULL)");
db.run("INSERT INTO users VALUES ('admin', 'not-the-demo-password')");

const app = express();
app.use(express.urlencoded({ extended: false, limit: '4kb' }));
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

function page(message = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PWNShop Demo</title>
  <style>body{font:16px system-ui;background:#f6f3ff;color:#242039;display:grid;place-items:center;min-height:100vh;margin:0}main{background:white;border:1px solid #d5c9f3;border-radius:20px;padding:2rem;width:min(90%,420px);box-sizing:border-box;box-shadow:0 12px 40px #47376c18}h1{margin-top:.25rem}label{display:block;margin:1rem 0 .4rem}input{box-sizing:border-box;width:100%;padding:.7rem;border:1px solid #aaa;border-radius:8px}button{margin-top:1rem;background:#6850a1;color:white;border:0;border-radius:8px;padding:.7rem 1rem;cursor:pointer}.tag{color:#6850a1;font-weight:bold}.message{margin-top:1rem;overflow-wrap:anywhere}</style></head>
  <body><main><span class="tag">PWNShop / Learning lab</span><h1>Storefront sign in</h1><p>Investigate how this intentionally vulnerable login handles your input.</p>
  <form method="post" action="/login"><label for="username">Username</label><input id="username" name="username" required><label for="password">Password</label><input id="password" name="password" type="password" required><button>Sign in</button></form><p class="message">${message}</p></main></body></html>`;
}

app.get('/', (_req, res) => res.send(page()));
app.post('/login', (req, res) => {
  if (typeof req.body.username !== 'string' || typeof req.body.password !== 'string') {
    res.status(400).send(page('Enter a username and password.'));
    return;
  }
  const query = `SELECT username FROM users WHERE password = '${req.body.password}' AND username = '${req.body.username}'`;
  try {
    const result = db.exec(query);
    const authenticated = result.some((row) => row.values.length > 0);
    console.log(`Login ${authenticated ? 'accepted' : 'rejected'}; username=${JSON.stringify(req.body.username)}`);
    res.send(page(authenticated ? 'Access granted. Flag: PWNSHOP{demo_sqli_mastered_2026}' : 'Login failed. Try again.'));
  } catch (error) {
    console.error(`SQL query error: ${error.message}; username=${JSON.stringify(req.body.username)}`);
    res.status(400).send(page('The database rejected the query. Check the lab logs for details.'));
  }
});

app.listen(3000, '0.0.0.0', () => console.log('PWNShop demo lab listening on port 3000'));
