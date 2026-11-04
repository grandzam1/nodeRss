import { openDb, listPosts } from './db.js';

const db = openDb();
console.table((await listPosts(db, 1000)).map((r) => ({ ...r, caption: r.caption?.slice(0, 50) })));
