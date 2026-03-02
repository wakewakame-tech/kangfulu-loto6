// migrate.js - Migration and backfill script for SQLite DB
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');

const N = 10; // Hot window length

async function computeHotColdForRecord(record, hotSet) {
    const mainNumbers = [record.hit1, record.hit2, record.hit3, record.hit4, record.hit5, record.hit6];
    const hotCount = mainNumbers.filter(n => hotSet.has(n)).length;
    const coldCount = 6 - hotCount;
    const pattern = `${hotCount}:${coldCount}`;
    const computedAt = new Date().toISOString();
    return { hotCount, coldCount, hotColdPattern: pattern, computedAt };
}

async function backfillHotCold() {
    let db;
    try {
        const dbFile = process.env.DB_FILE || './lotto_main.db';
        db = await sqlite.open({
            filename: dbFile,
            driver: sqlite3.Database
        });
        console.log(`DB opened for backfill: ${dbFile}`);

        const records = await db.all('SELECT * FROM TousenBango ORDER BY kaibetsu ASC');
        console.log(`Found ${records.length} records.`);

        const window = [];
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            // Build hotSet from window (last N records' main numbers, exclude bonus)
            const hotSet = new Set();
            window.forEach(rec => {
                [rec.hit1, rec.hit2, rec.hit3, rec.hit4, rec.hit5, rec.hit6].forEach(n => hotSet.add(n));
            });

            const { hotCount, coldCount, hotColdPattern, computedAt } = await computeHotColdForRecord(record, hotSet);

            await db.run(
                'UPDATE TousenBango SET hotCount = ?, coldCount = ?, hotColdPattern = ?, computedAt = ? WHERE objectId = ?',
                hotCount, coldCount, hotColdPattern, computedAt, record.objectId
            );

            console.log(`Updated kaibetsu ${record.kaibetsu}: ${hotColdPattern}`);

            // Update window
            window.push(record);
            if (window.length > N) window.shift();
        }

        console.log('Backfill completed.');
    } catch (error) {
        console.error('Backfill error:', error);
    } finally {
        if (db) await db.close();
    }
}

/**
 * 全データの隣接番号(Serial Numbers)を再計算して更新する
 */
async function backfillRinsetsu() {
    let db;
    try {
        const dbFile = process.env.DB_FILE || './lotto_main.db';
        db = await sqlite.open({
            filename: dbFile,
            driver: sqlite3.Database
        });
        console.log(`DB opened for rinsetsu backfill: ${dbFile}`);

        // 全データを回別順に取得
        const records = await db.all('SELECT * FROM TousenBango ORDER BY kaibetsu ASC');
        console.log(`Processing ${records.length} records...`);

        for (let i = 1; i < records.length; i++) {
            const current = records[i];
            const prev = records[i - 1];

            // 前回の当選番号（本数字6個 + ボーナス1個）
            const prevNums = [prev.hit1, prev.hit2, prev.hit3, prev.hit4, prev.hit5, prev.hit6, prev.bonus];
            
            // 隣接数字（±1）のセットを作成
            const rinsetsuSet = new Set();
            prevNums.forEach(n => {
                if (n > 1) rinsetsuSet.add(n - 1);
                if (n < 43) rinsetsuSet.add(n + 1);
            });

            // 今回の本数字が隣接セットにいくつ含まれるか
            const currentHits = [current.hit1, current.hit2, current.hit3, current.hit4, current.hit5, current.hit6];
            const count = currentHits.filter(n => rinsetsuSet.has(n)).length;

            // DB更新
            await db.run(
                'UPDATE TousenBango SET rinsetsuCount = ? WHERE objectId = ?',
                count, current.objectId
            );

            if (i % 100 === 0) console.log(`${i} records processed...`);
        }

        console.log('Rinsetsu backfill completed successfully.');
    } catch (error) {
        console.error('Backfill error:', error);
    } finally {
        if (db) await db.close();
    }
}

/**
 * 全データの「リピート数（前回本数字との一致数）」を再計算して更新する
 */
async function backfillRepeat() {
    let db;
    try {
        const dbFile = process.env.DB_FILE || './lotto_dev.db';
        db = await sqlite.open({
            filename: dbFile,
            driver: sqlite3.Database
        });
        console.log(`DB opened for repeat backfill: ${dbFile}`);

        // 全データを回別順に取得
        const records = await db.all('SELECT * FROM TousenBango ORDER BY kaibetsu ASC');
        console.log(`Processing ${records.length} records...`);

        // 最初のデータ（比較対象の前回がない）を除き、2番目のデータから処理
        for (let i = 1; i < records.length; i++) {
            const current = records[i];
            const prev = records[i - 1];

            // 前回の本数字6個（ボーナスは含まないのが一般的）をセットにする
            const prevMainNums = new Set([
                prev.hit1, prev.hit2, prev.hit3, prev.hit4, prev.hit5, prev.hit6
            ]);

            // 今回の本数字
            const currentHits = [
                current.hit1, current.hit2, current.hit3, current.hit4, current.hit5, current.hit6
            ];

            // 今回の本数字のうち、前回セットに含まれている数をカウント
            const count = currentHits.filter(n => prevMainNums.has(n)).length;

            // DB更新
            await db.run(
                'UPDATE TousenBango SET repeatCount = ? WHERE objectId = ?',
                count, current.objectId
            );

            if (i % 100 === 0) console.log(`${i} records processed...`);
        }

        console.log('Repeat count backfill completed successfully.');
    } catch (error) {
        console.error('Backfill error:', error);
    } finally {
        if (db) await db.close();
    }
}

/**
 * 全データの「下一桁ユニーク数」を再計算して更新する
 */
async function backfillShimoiichiki() {
    let db;
    try {
        const dbFile = process.env.DB_FILE || './lotto_dev.db';
        db = await sqlite.open({
            filename: dbFile,
            driver: sqlite3.Database
        });
        console.log(`DB opened for shimoiichiki backfill: ${dbFile}`);

        // 全データを取得
        const records = await db.all('SELECT * FROM TousenBango ORDER BY kaibetsu ASC');
        console.log(`Processing ${records.length} records...`);

        for (let i = 0; i < records.length; i++) {
            const r = records[i];

            // 本数字6個の下一桁を取得してSetでユニーク化
            const shimoSet = new Set([
                r.hit1 % 10, r.hit2 % 10, r.hit3 % 10, r.hit4 % 10, r.hit5 % 10, r.hit6 % 10
            ]);

            // DB更新
            await db.run(
                'UPDATE TousenBango SET shimoiichikiCount = ? WHERE objectId = ?',
                shimoSet.size, r.objectId
            );

            if (i % 100 === 0) console.log(`${i} records processed...`);
        }

        console.log('Shimoiichiki count backfill completed successfully.');
    } catch (error) {
        console.error('Backfill error:', error);
    } finally {
        if (db) await db.close();
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

async function backfillAC() {
    let db;
    try {
        const dbFile = process.env.DB_FILE || './lotto_dev.db';
        db = await sqlite.open({ filename: dbFile, driver: sqlite3.Database });
        const records = await db.all('SELECT * FROM TousenBango ORDER BY kaibetsu ASC');
        console.log(`Processing AC values for ${records.length} records...`);

        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const ac = calculateACValue([r.hit1, r.hit2, r.hit3, r.hit4, r.hit5, r.hit6]);
            await db.run('UPDATE TousenBango SET acValue = ? WHERE objectId = ?', ac, r.objectId);
            if (i % 100 === 0) console.log(`${i} records processed...`);
        }
        console.log('AC Value backfill completed successfully.');
    } catch (error) {
        console.error('Backfill error:', error);
    } finally {
        if (db) await db.close();
    }
}

//module.exports = { backfillHotCold };

// 本番マージ用
if (require.main === module) {
    async function runAllBackfills() {
        console.log("--- Starting Full Backfill for Production ---");
        
        await backfillHotCold();      // ホット・コールド
        await backfillRinsetsu();     // 隣接数
        await backfillRepeat();       // リピート数
        await backfillShimoiichiki(); // 下一桁
        await backfillAC();           // AC値
        
        console.log("--- ALL BACKFILL COMPLETED SUCCESSFULLY ---");
    }
    
    runAllBackfills().catch(err => {
        console.error("Critical error during backfill:", err);
    });
}
