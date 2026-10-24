// Starts the website: npm run dev (restarts when files change) or npm start.
import './load-env.js';
import { openDb, initSchema } from './db/client.js';
import { createApp } from './app.js';

const db = openDb();
await initSchema(db);

const port = Number(process.env.PORT) || 3000;
createApp({ db }).listen(port, () => {
  console.log(`Website đang chạy ở http://localhost:${port}`);
});
