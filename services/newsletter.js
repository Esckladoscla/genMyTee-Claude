import { DatabaseSync } from "node:sqlite";
import { getDbPath } from "./env.js";

let db;

function getDb() {
  if (db) return db;
  try {
    db = new DatabaseSync(getDbPath());
    db.exec(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        email TEXT PRIMARY KEY,
        subscribed_at TEXT NOT NULL,
        source TEXT DEFAULT 'website'
      )
    `);
  } catch {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        email TEXT PRIMARY KEY,
        subscribed_at TEXT NOT NULL,
        source TEXT DEFAULT 'website'
      )
    `);
  }
  return db;
}

export function subscribeEmail(email) {
  const db = getDb();
  const existing = db.prepare("SELECT email FROM newsletter_subscribers WHERE email = ?").get(email);
  if (existing) return { already_subscribed: true };
  db.prepare("INSERT INTO newsletter_subscribers (email, subscribed_at) VALUES (?, ?)").run(
    email,
    new Date().toISOString()
  );
  return { subscribed: true };
}

export function getSubscribers() {
  return getDb().prepare("SELECT email, subscribed_at FROM newsletter_subscribers ORDER BY subscribed_at DESC").all();
}
