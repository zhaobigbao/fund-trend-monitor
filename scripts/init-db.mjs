import { initializeDatabase, databaseExists } from "../src/storage/database.mjs";

const existed = databaseExists();
initializeDatabase();
console.log(existed ? "Database schema verified." : "Database created and seeded.");
