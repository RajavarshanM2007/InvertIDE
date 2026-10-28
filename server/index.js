// Starts the InvertIDE server. Configuration is read from environment
// variables, optionally loaded from a .env file in the project root.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { openDatabase, seedDatabase } from './db.js';
import { createApp } from './app.js';
import { providerFromEnv } from './ai/index.js';

const envFile = path.resolve('.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const dbFile = env.DB_FILE || path.resolve('data', 'invertide.db');

if (process.argv.includes('--reset-only')) {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
  console.log(`Removed ${dbFile}. It will be recreated and seeded on the next start.`);
  process.exit(0);
}

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret) {
  if (env.NODE_ENV === 'production') {
    console.error('JWT_SECRET must be set in production.');
    process.exit(1);
  }
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('JWT_SECRET not set - using a random development secret (sessions end when the server restarts).');
}

const db = openDatabase(dbFile);
seedDatabase(db, { adminEmail: env.ADMIN_EMAIL, adminPassword: env.ADMIN_PASSWORD, log: m => console.log(m) });

const { provider, warning } = providerFromEnv(env);
if (warning) console.warn(warning);
console.log(`Cross-Examine provider: ${provider ? `${provider.name} (${provider.model})` : 'offline predict-then-run mode'}`);

const app = createApp({
  db, jwtSecret, aiProvider: provider, aiWarning: provider?.name === 'fixture' ? warning : null,
  challengeTimeLimitSec: Number(env.CHALLENGE_TIME_LIMIT_SEC) || 300,
});
const port = Number(env.PORT) || 3000;
app.listen(port, () => console.log(`InvertIDE running at http://localhost:${port}`));
