// Import necessary modules
const express = require('express');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const cors = require('cors'); 
const { backfillHotCold } = require('./migrate'); // 新規追加: バックフィル関数インポート

const axios = require('axios');
const cheerio = require('cheerio');

// Helper function to compute hot/cold for a single record
// 新規追加: ホット/コールド計算ヘルパー関数
async function computeHotColdForRecord(record, hotSet) {
    console.log(`computeHotColdForRecord 1`);
    console.log(`computeHotColdForRecord 2 ${record.hits[0]}, ${record.hits[1]}, ${record.hits[2]}, ${record.hits[3]}, ${record.hits[4]}, ${record.hits[5]}`);
    const mainNumbers = [record.hits[0], record.hits[1], record.hits[2], record.hits[3], record.hits[4], record.hits[5]];
    const hotCount = mainNumbers.filter(n => hotSet.has(n)).length;
    const coldCount = 6 - hotCount;
    const pattern = `${hotCount}:${coldCount}`;
    console.log(`computeHotColdForRecord 3 pattern ${pattern}`);
    const computedAt = new Date().toISOString();
    return { hotCount, coldCount, hotColdPattern: pattern, computedAt };
} 

// AC値計算ヘルパー関数
function calculateACValue(numbers) {
    const differences = new Set();
    const sorted = [...numbers].sort((a, b) => a - b);
    
    // 全ての2数の差を計算
    for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            differences.add(sorted[j] - sorted[i]);
        }
    }
    // AC値 = (差の種類数) - (本数字の数 - 1)
    return differences.size - (sorted.length - 1);
}

const app = express();

// publicフォルダの中身（HTML/JS/CSS）を自動で公開する設定
app.use(express.static(path.join(__dirname, 'public')));

// ルートURL (/) にアクセスした時に index.html を表示する
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = 3000;
let db;

// Middleware setup
app.use(cors()); 
// --- 修正箇所 ---
// PayloadTooLargeError 対策: リクエストボディの最大サイズを5MBに設定
app.use(express.json({ limit: '5mb' })); 
// ----------------

app.use(express.static(path.join(__dirname, '.')));

/**
 * Initializes the SQLite database and creates the necessary tables.
 */
async function initializeDB() {
// ... (DB初期化ロジックは省略) ...
    try {
        // --- 修正箇所：環境変数 DB_FILE があれば使い、なければデフォルト(lotto_main.db)を使う ---
        const dbFile = process.env.DB_FILE || './lotto_main.db';
        // Open the database file
        db = await sqlite.open({
            filename: dbFile,
            driver: sqlite3.Database
        });
        console.log(`SQLite database opened successfully: ${dbFile}`);
        // 1. Create TousenBango table (Lottery Win Numbers)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS TousenBango (
                objectId INTEGER PRIMARY KEY AUTOINCREMENT,
                kaibetsu INTEGER UNIQUE,
                hit1 INTEGER, hit2 INTEGER, hit3 INTEGER, hit4 INTEGER, hit5 INTEGER, hit6 INTEGER,
                bonus INTEGER,
                guusuu INTEGER, daishou INTEGER, goukei INTEGER,
                createdAt TEXT,
                hotCount INTEGER, coldCount INTEGER, hotColdPattern TEXT,
                rinsetsuCount INTEGER DEFAULT 0 -- ★追加: 隣接番号のカウント
        )
    `);

        console.log('TousenBango table ensured.');

        // 2. Create HazureKaisu table (Miss Count / Non-Hit Count)
        // ... (Table schema remains the same) ...
        await db.exec(`
            CREATE TABLE IF NOT EXISTS HazureKaisu (
                objectId INTEGER PRIMARY KEY,
                kaibetsu INTEGER UNIQUE,
                k01 INTEGER, k02 INTEGER, k03 INTEGER, k04 INTEGER, k05 INTEGER, k06 INTEGER, k07 INTEGER,
                k08 INTEGER, k09 INTEGER, k10 INTEGER, k11 INTEGER, k12 INTEGER, k13 INTEGER, k14 INTEGER,
                k15 INTEGER, k16 INTEGER, k17 INTEGER, k18 INTEGER, k19 INTEGER, k20 INTEGER, k21 INTEGER,
                k22 INTEGER, k23 INTEGER, k24 INTEGER, k25 INTEGER, k26 INTEGER, k27 INTEGER, k28 INTEGER,
                k29 INTEGER, k30 INTEGER, k31 INTEGER, k32 INTEGER, k33 INTEGER, k34 INTEGER, k35 INTEGER,
                k36 INTEGER, k37 INTEGER, k38 INTEGER, k39 INTEGER, k40 INTEGER, k41 INTEGER, k42 INTEGER, k43 INTEGER,
                goukei INTEGER,    -- はずれ回数合計
                L10 INTEGER,       -- はずれ回数10回未満の数
                createdAt TEXT
            );
        `);
        console.log('HazureKaisu table ensured.');

        // 3. Create KatayoriChart table (Bias Chart / Group Miss Count)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS KatayoriChart (
                objectId INTEGER PRIMARY KEY,
                kaibetsu INTEGER UNIQUE,
                k01_07 INTEGER, k08_14 INTEGER, k15_22 INTEGER, k23_29 INTEGER, k30_36 INTEGER, k37_43 INTEGER,
                createdAt TEXT
            );
        `);
        console.log('KatayoriChart table ensured.');
    } catch (e) {
        console.error('Error initializing DB:', e);
    }
}

// --- API Endpoints (省略、変更なし) ---
app.get('/api/tousen/latest', async (req, res) => {
    try {
        const result = await db.get('SELECT * FROM TousenBango ORDER BY kaibetsu DESC LIMIT 1');
        if (result) {
            res.json(result);
        } else {
            res.status(404).json({ message: 'No records found.' });
        }
    } catch (e) {
        console.error('Error fetching latest TousenBango:', e);
        res.status(500).send('Database error.');
    }
});

/**
 * 2. 単一登録API (Single Registration API)
 */
app.post('/api/tousen/register', async (req, res) => {
    const data = req.body;
    const createdAt = new Date().toISOString();
   
	// 20251110追加↓
    let guusuu = 0;
    if ( data.hits[0] % 2 == 0 ) guusuu += 1;
    if ( data.hits[1] % 2 == 0 ) guusuu += 1;
    if ( data.hits[2] % 2 == 0 ) guusuu += 1;
    if ( data.hits[3] % 2 == 0 ) guusuu += 1;
    if ( data.hits[4] % 2 == 0 ) guusuu += 1;
    if ( data.hits[5] % 2 == 0 ) guusuu += 1;

    let daishou = 0;
    if ( data.hits[0] >= 23 ) daishou += 1;
    if ( data.hits[1] >= 23 ) daishou += 1;
    if ( data.hits[2] >= 23 ) daishou += 1;
    if ( data.hits[3] >= 23 ) daishou += 1;
    if ( data.hits[4] >= 23 ) daishou += 1;
    if ( data.hits[5] >= 23 ) daishou += 1;

    let goukei = data.hits[0] + data.hits[1] + data.hits[2] + data.hits[3] + data.hits[4] + data.hits[5];
	console.log(`post data.kaibetsu:${data.kaibetsu}`);
	console.log(`post data.hits : ${data.hits[0]}, ${data.hits[1]}, ${data.hits[2]}, ${data.hits[3]}, ${data.hits[4]}, ${data.hits[5]}`);
	console.log(`post data.bonus : ${data.bonus}`);
	console.log(`post goukei : ${goukei}`);
	console.log(`post daishou : ${daishou}`);
	console.log(`post guusuu : ${guusuu}`);
	// 20251110追加↑
    // Compute hot/cold counts
    // 新規追加: ホット/コールド割合計算
    const N = 10;
    const recentRecords = await db.all('SELECT * FROM TousenBango ORDER BY kaibetsu DESC LIMIT ?', N);
    const hotSet = new Set();
    recentRecords.forEach(rec => {
        console.log(`recentRecords:${rec.hit1}, ${rec.hit2}, ${rec.hit3}, ${rec.hit4}, ${rec.hit5}, ${rec.hit6}`);
        [rec.hit1, rec.hit2, rec.hit3, rec.hit4, rec.hit5, rec.hit6].forEach(n => hotSet.add(n));
    });
    console.log(`recentRecords before data `, data);
    const { hotCount, coldCount, hotColdPattern, computedAt } = await computeHotColdForRecord(data, hotSet);
    // ★追加: 隣接番号(Serial Numbers)の計算
    let rinsetsuCount = 0;
    const prevRecord = await db.get('SELECT * FROM TousenBango WHERE kaibetsu = ?', data.kaibetsu - 1);
    if (prevRecord) {
        const prevNumbers = [prevRecord.hit1, prevRecord.hit2, prevRecord.hit3, prevRecord.hit4, prevRecord.hit5, prevRecord.hit6, prevRecord.bonus];
        const rinsetsuSet = new Set();
        prevNumbers.forEach(n => {
            if (n > 1) rinsetsuSet.add(n - 1);
            if (n < 43) rinsetsuSet.add(n + 1);
        });
        // 数値型への変換を明示的に行う
        const currentHits = data.hits.map(Number);
        rinsetsuCount = currentHits.filter(n => rinsetsuSet.has(n)).length;
        console.log(`rinsetsuCount `, rinsetsuCount);
    }
    // ★リピート数（前回本数字との一致）の計算
    let repeatCount = 0;
    if (prevRecord) {
        const prevMainSet = new Set([
            prevRecord.hit1, prevRecord.hit2, prevRecord.hit3, 
            prevRecord.hit4, prevRecord.hit5, prevRecord.hit6
        ]);
        // data.hits を数値に変換して一致を確認
        repeatCount = data.hits.filter(n => prevMainSet.has(Number(n))).length;
    }
    // ★下一桁バランス（ユニーク数）の計算
    // 例: [1, 11, 22, 23, 34, 42] -> 下一桁は [1, 1, 2, 3, 4, 2] -> ユニークなのは {1, 2, 3, 4} で 4種類
    const shimoSet = new Set(data.hits.map(n => Number(n) % 10));
    const shimoiichikiCount = shimoSet.size;

    // INSERT 文の引数に shimoiichikiCount を追加
    // (SQL文の末尾のカラム名と、VALUESの ? を1つ増やします)
    const result = await db.run(
        `INSERT OR REPLACE INTO TousenBango (
            kaibetsu, hit1, hit2, hit3, hit4, hit5, hit6, bonus, 
            guusuu, daishou, goukei, rinsetsuCount, repeatCount, shimoiichikiCount, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        data.kaibetsu, data.hits[0], data.hits[1], data.hits[2], data.hits[3], data.hits[4], data.hits[5], data.bonus,
        guusuu, daishou, goukei, rinsetsuCount, repeatCount, shimoiichikiCount, createdAt
    );
    // ★AC値の計算
    const acValue = calculateACValue(data.hits.map(Number));
    // Use ON CONFLICT to handle both insert and update based on kaibetsu
    // 変更: hotCount, coldCount, hotColdPattern, computedAt を追加
    // acValue を追加 (INSERTとUPDATEの両方)
    const sql = `
        INSERT INTO TousenBango 
        (kaibetsu, hit1, hit2, hit3, hit4, hit5, hit6, bonus, guusuu, daishou, goukei, createdAt, hotCount, coldCount, hotColdPattern, computedAt, rinsetsuCount, repeatCount, shimoiichikiCount, acValue) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(kaibetsu) DO UPDATE SET
            hit1=excluded.hit1, hit2=excluded.hit2, hit3=excluded.hit3, hit4=excluded.hit4, hit5=excluded.hit5, hit6=excluded.hit6,
            bonus=excluded.bonus, guusuu=excluded.guusuu, daishou=excluded.daishou, goukei=excluded.goukei, 
            createdAt=excluded.createdAt, hotCount=excluded.hotCount, coldCount=excluded.coldCount, 
            hotColdPattern=excluded.hotColdPattern, computedAt=excluded.computedAt,
            rinsetsuCount=excluded.rinsetsuCount, repeatCount=excluded.repeatCount, 
            shimoiichikiCount=excluded.shimoiichikiCount, acValue=excluded.acValue
    `;
    try {
        const result = await db.run(sql, 
            data.kaibetsu, data.hits[0], data.hits[1], data.hits[2], data.hits[3], data.hits[4], data.hits[5], data.bonus, 
            guusuu, daishou, goukei, createdAt, hotCount, coldCount, hotColdPattern, computedAt, 
            rinsetsuCount, repeatCount, shimoiichikiCount, acValue
        );
        if (result.changes > 0) {
            res.json({ message: 'Registration successful/updated.', kaibetsu: data.kaibetsu, objectId: result.lastID || data.kaibetsu });
        } else {
            res.status(400).json({ message: 'No changes made.' });
        }
    } catch (e) {
        console.error('Error registering TousenBango:', e);
        res.status(500).send('Database error during registration.');
    }
});

/**
 * 3. 特定の回別の当選番号を取得API (Get TousenBango by kaibetsu)
 */
app.get('/api/tousen/by-kaibetsu/:kaibetsu', async (req, res) => {
    const kaibetsu = parseInt(req.params.kaibetsu, 10);
    if (isNaN(kaibetsu)) {
        return res.status(400).json({ message: 'Invalid kaibetsu parameter.' });
    }
    try {
        const result = await db.get('SELECT * FROM TousenBango WHERE kaibetsu = ?', kaibetsu);
        if (result) {
            res.json(result);
        } else {
            res.status(404).json({ message: `No record found for kaibetsu ${kaibetsu}.` });
        }
    } catch (e) {
        console.error(`Error fetching TousenBango for kaibetsu ${kaibetsu}:`, e);
        res.status(500).send('Database error.');
    }
});

/**
 * 4. 過去N件の当選番号履歴を取得API (Get TousenBango History)
 */
app.get('/api/tousen/history/:limit', async (req, res) => {
    const limit = parseInt(req.params.limit, 10);
    if (isNaN(limit) || limit <= 0) {
        return res.status(400).json({ message: 'Invalid limit parameter.' });
    }
    try {
        // kaibetsu (回別) の降順で最新の N 件を取得
        const results = await db.all('SELECT * FROM TousenBango ORDER BY kaibetsu DESC LIMIT ?', limit);
        res.json(results);
    } catch (e) {
        console.error(`Error fetching history with limit ${limit}:`, e);
        res.status(500).send('Database error.');
    }
});

app.get('/api/hazure/latest', async (req, res) => {
    try {
        const result = await db.get('SELECT * FROM HazureKaisu ORDER BY kaibetsu DESC LIMIT 1');
        if (result) {
            res.json(result);
        } else {
            res.status(200).json(null); // Return null if no records found
        }
    } catch (e) {
        console.error('Error fetching latest HazureKaisu:', e);
        res.status(500).send('Database error.');
    }
});

app.post('/api/hazure/update', async (req, res) => {
    const data = req.body;
    const createdAt = new Date().toISOString();
    
    // Calculate Goukei and L10 on the server side
    let goukei = 0;
    let L10 = 0;
    for (let i = 1; i <= 43; i++) {
        const key = 'k' + (i < 10 ? '0' + i : i);
        if (data[key] !== undefined) {
            goukei += data[key];
            if (data[key] < 10) L10++;
        }
    }
    data.goukei = goukei;
    data.L10 = L10;

    const columns = ['kaibetsu', 'goukei', 'L10', 'createdAt'];
    const values = [data.kaibetsu, goukei, L10, createdAt];
    const updateSets = ['goukei=excluded.goukei', 'L10=excluded.L10', 'createdAt=excluded.createdAt'];
    
    for (let i = 1; i <= 43; i++) {
        const key = 'k' + (i < 10 ? '0' + i : i);
        columns.push(key);
        values.push(data[key] || 0); // Default to 0 if missing
        updateSets.push(`${key}=excluded.${key}`);
    }

    const sql = `
        INSERT INTO HazureKaisu (${columns.join(', ')}) 
        VALUES (${columns.map(() => '?').join(', ')})
        ON CONFLICT(kaibetsu) DO UPDATE SET
            ${updateSets.join(', ')}
    `;

    try {
        const result = await db.run(sql, values);
        if (result.changes > 0) {
            res.json({ message: 'HazureKaisu updated/registered.', kaibetsu: data.kaibetsu, objectId: result.lastID || data.kaibetsu });
        } else {
            res.status(400).json({ message: 'No changes made.' });
        }
    } catch (e) {
        console.error('Error updating HazureKaisu:', e);
        res.status(500).send('Database error during HazureKaisu update.');
    }
});

/**
 * バッチ更新 API: ホット/コールド割合の一括計算 (POST /tousen/compute-hotcold)
 */
app.post('/api/tousen/compute-hotcold', async (req, res) => {
    try {
        console.log('Starting batch hot/cold computation...');
        await backfillHotCold();
        res.json({ message: 'Batch hot/cold computation completed successfully.' });
    } catch (e) {
        console.error('Error during batch computation:', e);
        res.status(500).send('Database error during batch computation.');
    }
});

/**
 * 12. 一括登録API (Bulk Registration API)
 * CSVファイルを想定したJSON配列を受け取り、一括でDBに登録/更新する。
 */
app.post('/api/tousen/bulk-register', async (req, res) => {
    const payload = req.body;
    if (!Array.isArray(payload)) {
        return res.status(400).send('Invalid payload: Expected an array.');
    }

    try {
        await db.exec('BEGIN TRANSACTION');

        const sql = `
            INSERT INTO TousenBango (
                kaibetsu, hit1, hit2, hit3, hit4, hit5, hit6, bonus, 
                guusuu, daishou, goukei, createdAt,
                rinsetsuCount, repeatCount, shimoiichikiCount, acValue
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(kaibetsu) DO UPDATE SET 
                hit1=excluded.hit1, hit2=excluded.hit2, hit3=excluded.hit3, 
                hit4=excluded.hit4, hit5=excluded.hit5, hit6=excluded.hit6, 
                bonus=excluded.bonus, guusuu=excluded.guusuu, daishou=excluded.daishou, 
                goukei=excluded.goukei, createdAt=excluded.createdAt,
                rinsetsuCount=excluded.rinsetsuCount, repeatCount=excluded.repeatCount,
                shimoiichikiCount=excluded.shimoiichikiCount, acValue=excluded.acValue
        `;

        const stmt = await db.prepare(sql);
        let successCount = 0;
        let updateCount = 0;
        let errorCount = 0;

        for (const data of payload) {
            const hits = [data.hit1, data.hit2, data.hit3, data.hit4, data.hit5, data.hit6].map(Number).sort((a, b) => a - b);
            const guusuu = hits.filter(n => n % 2 === 0).length;
            const daishou = hits.filter(n => n >= 22).length;
            const goukei = hits.reduce((a, b) => a + b, 0);
            const createdAt = data.createdAt || new Date().toISOString();

            // --- 新規4項目の計算 ---
            
            // 1. 下一桁ユニーク数
            const shimoiichikiCount = new Set(hits.map(n => n % 10)).size;
            
            // 2. AC値
            const acValue = calculateACValue(hits);

            // 3. 隣接数 & 4. リピート数（DBから前回の番号を取得）
            let rinsetsuCount = 0;
            let repeatCount = 0;
            const prevRecord = await db.get('SELECT hit1, hit2, hit3, hit4, hit5, hit6 FROM TousenBango WHERE kaibetsu = ?', data.kaibetsu - 1);
            
            if (prevRecord) {
                const prevHits = [prevRecord.hit1, prevRecord.hit2, prevRecord.hit3, prevRecord.hit4, prevRecord.hit5, prevRecord.hit6];
                // 隣接数計算
                for (let i = 0; i < hits.length - 1; i++) {
                    if (hits[i+1] - hits[i] === 1) rinsetsuCount++;
                }
                // リピート数計算
                repeatCount = hits.filter(n => prevHits.includes(n)).length;
            }

            try {
                const result = await stmt.run(
                    data.kaibetsu, hits[0], hits[1], hits[2], hits[3], hits[4], hits[5], data.bonus, 
                    guusuu, daishou, goukei, createdAt,
                    rinsetsuCount, repeatCount, shimoiichikiCount, acValue
                );
                
                if (result.changes > 0) {
                    if (result.lastID) successCount++;
                    else updateCount++;
                }
            } catch (innerError) {
                console.error(`Error processing kaibetsu ${data.kaibetsu}:`, innerError);
                errorCount++;
            }
        }
        
        await stmt.finalize();
        await db.exec('COMMIT');

        res.json({ 
            message: 'Bulk registration/update completed.', 
            inserted: successCount, 
            updated: updateCount,
            errors: errorCount 
        });

    } catch (e) {
        console.error('Bulk registration failed (Rolling back):', e);
        if (db) await db.exec('ROLLBACK');
        res.status(500).send('Database error during registration.');
    }
});

// 最新の当選番号を公式サイトから取得するAPI
app.get('/api/tousen/fetch-latest', async (req, res) => {
    try {
        // 非常に安定して取得可能な攻略サイトをターゲットにします
        const url = 'https://loto6.thekyo.jp/';
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        
        let kaibetsu = null;
        let mainNumbers = [];
        let bonus = null;

        // PDFの構造に基づき、テキストから「第xxxx回」と「当選番号の並び」を抽出します
        const pageText = $('body').text().replace(/\s+/g, ' ');

        // 1. 回号の抽出
        const kaibetsuMatch = pageText.match(/第(\d+)回ロト６\s*抽選結果/);
        if (kaibetsuMatch) {
            kaibetsu = parseInt(kaibetsuMatch[1]);
        }

        // 2. 本数字とボーナスの抽出
        // PDFによると「本数字 BO. 06 12 30 36 37 38 08」という並びになっています
        const numMatch = pageText.match(/本数字\s*BO\.\s*(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})/);
        
        if (numMatch) {
            mainNumbers = numMatch.slice(1, 7).map(n => parseInt(n));
            bonus = parseInt(numMatch[7]);
        }

        console.log('--- KYO Debug ---');
        console.log('Kaibetsu:', kaibetsu);
        console.log('Main:', mainNumbers);
        console.log('Bonus:', bonus);

        if (kaibetsu && mainNumbers.length === 6 && bonus !== null) {
            return res.json({
                kaibetsu,
                hit1: mainNumbers[0],
                hit2: mainNumbers[1],
                hit3: mainNumbers[2],
                hit4: mainNumbers[3],
                hit5: mainNumbers[4],
                hit6: mainNumbers[5],
                bonus
            });
        }

        throw new Error(`パターンマッチ失敗 (回:${kaibetsu}, 数:${mainNumbers.length}, B:${bonus})`);

    } catch (error) {
        console.error('Fetch Error:', error.message);
        res.status(500).json({ 
            error: '攻略サイトからのデータ取得に失敗しました。',
            detail: error.message 
        });
    }
});

// Start the server after initializing the database
initializeDB().then(() => {
    // Render.comなどの環境変数を優先し、なければ3000を使う
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`Local Access: http://localhost:${PORT}`);
    });
});
