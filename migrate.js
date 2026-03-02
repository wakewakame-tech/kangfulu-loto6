const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runAllBackfills() {
    console.log("--- Starting Postgres Backfill ---");
    try {
        // 全レコード取得
        const res = await pool.query('SELECT * FROM TousenBango ORDER BY kaibetsu ASC');
        const records = res.rows;
        
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const hits = [r.hit1, r.hit2, r.hit3, r.hit4, r.hit5, r.hit6];
            
            // 下一桁
            const shimo = new Set(hits.map(n => n % 10)).size;
            // AC値計算（簡易版）
            const ac = calculateACValue(hits);

            await pool.query(
                'UPDATE TousenBango SET shimoiichikiCount = $1, acValue = $2 WHERE kaibetsu = $3',
                [shimo, ac, r.kaibetsu]
            );
        }
        console.log("Backfill Completed.");
    } catch (err) {
        console.error(err);
    }
}

function calculateACValue(numbers) {
    const differences = new Set();
    const sorted = [...numbers].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            differences.add(sorted[j] - sorted[i]);
        }
    }
    return differences.size - (sorted.length - 1);
}

if (require.main === module) {
    runAllBackfills();
}