const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/chess_tournament'
});

async function main() {
  const { rows } = await pool.query(`
    SELECT m.* 
    FROM matches m 
    JOIN tournaments t ON m.tournament_id = t.id 
    WHERE t.format = 'knockout' 
    ORDER BY m.id DESC 
    LIMIT 20;
  `);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

main().catch(console.error);
