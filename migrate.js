const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const sqliteDbPath = path.join(__dirname, 'lotto_main.db'); 
const sqliteDb = new sqlite3.Database(sqliteDbPath);

async function migrateData() {
    console.log("--- Starting Perfect Migration: SQLite to Postgres ---");
    
    // SQLiteから全カラムを取得
    sqliteDb.all("SELECT * FROM TousenBango ORDER BY kaibetsu ASC", [], async (err, rows) => {
        if (err) {
            console.error("SQLite Read Error:", err.message);
            return;
        }

        console.log(`Found ${rows.length} rows in SQLite. Syncing all columns...`);

        for (const r of rows) {
            // PostgresのDDL（小文字カラム）に正確にマッピング
            const sql = `
                INSERT INTO tousenbango (
                    kaibetsu, hit1, hit2, hit3, hit4, hit5, hit6, bonus, 
                    guusuu, daishou, goukei, createdat, 
                    hotcount, coldcount, hotcoldpattern, computedat,
                    rinsetsucount, repeatcount, shimoiichikicount, acvalue
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                ON CONFLICT (kaibetsu) DO UPDATE SET 
                    hotcount = EXCLUDED.hotcount,
                    coldcount = EXCLUDED.coldcount,
                    hotcoldpattern = EXCLUDED.hotcoldpattern,
                    computedat = EXCLUDED.computedat,
                    rinsetsucount = EXCLUDED.rinsetsucount,
                    repeatcount = EXCLUDED.repeatcount,
                    shimoiichikicount = EXCLUDED.shimoiichikicount,
                    acvalue = EXCLUDED.acvalue,
                    createdat = EXCLUDED.createdat
            `;
            
            // SQLiteのカラム名は大文字小文字が混在している可能性があるため、
            // r['カラム名'] の形式で確実に取得します
            const values = [
                r.kaibetsu, r.hit1, r.hit2, r.hit3, r.hit4, r.hit5, r.hit6, r.bonus,
                r.guusuu, r.daishou, r.goukei, r.createdAt || r.createdat,
                r.hotCount || r.hotcount, 
                r.coldCount || r.coldcount, 
                r.hotColdPattern || r.hotcoldpattern, 
                r.computedAt || r.computedat,
                r.rinsetsuCount || r.rinsetsucount || 0,
                r.repeatCount || r.repeatcount || 0,
                r.shimoiichikiCount || r.shimoiichikicount || 0,
                r.acValue || r.acvalue || 0
            ];

            try {
                await pool.query(sql, values);
            } catch (pgErr) {
                console.error(`Error syncing kaibetsu ${r.kaibetsu}:`, pgErr.message);
            }
        }
        
        console.log("--- Perfect Migration Completed! ---");
        await pool.end();
        sqliteDb.close();
    });
}

// 実行
migrateData();
