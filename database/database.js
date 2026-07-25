const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const databasePath = path.join(__dirname, "dollarplan.db");

const db = new DatabaseSync(databasePath);

db.exec("PRAGMA foreign_keys = ON");

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL CHECK(amount > 0),
        type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON DELETE CASCADE
    )
`);

module.exports = db;