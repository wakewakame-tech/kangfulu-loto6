const express = require('express');
const { Pool } = require('pg'); // SQLiteから変更
const path = require('path');
const cors = require('cors'); 
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
let db;

// Postgres接続設定（Renderの環境変数を使用）
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ヘルパー：ホット/コールド計算
async function computeHotColdForRecord(record, hotSet) {
    const mainNumbers = [Number(record.hits[0]), Number(record.hits[1]), Number(record.hits[2]), Number(record.hits[3]), Number(record.hits[4]), Number(record.hits[5])];
    const hotCount = mainNumbers.filter(n => hotSet.has(n)).length;
    const coldCount = 6 - hotCount;
    const pattern = `${hotCount}:${coldCount}`;
    const computedAt = new Date().toISOString();
    return { hotCount, coldCount, hotColdPattern: pattern, computedAt };
} 

// AC値計算
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

// 閲覧制限ミドルウェア
const allowOnlyLocal = (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const isLocal = ip.includes('127.0.0.1') || ip === '::1' || ip.includes('localhost');
    if (isLocal) {
        console.log(`[SERVER DEBUG] Incoming Request: ${req.method} ${req.url}`);
        next();
    } else {
        res.status(403).json({ error: "閲覧制限モード", message: "本番環境でのデータ更新は制限されています。" });
    }
};

app.use(cors()); 
app.use(express.json({ limit: '5mb' })); 
app.use(express.static(path.join(__dirname, 'public')));

// DB初期化（テーブル作成）
async function initializeDB() {
    try {
        // tousenbango
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tousenbango (
                objectid SERIAL PRIMARY KEY,
                kaibetsu INTEGER UNIQUE,
                hit1 INTEGER, hit2 INTEGER, hit3 INTEGER, hit4 INTEGER, hit5 INTEGER, hit6 INTEGER,
                bonus INTEGER, guusuu INTEGER, daishou INTEGER, goukei INTEGER,
                createdat TEXT, hotcount INTEGER, coldcount INTEGER, hotcoldpattern TEXT, computedat TEXT,
                rinsetsucount INTEGER DEFAULT 0, repeatcount INTEGER DEFAULT 0,
                shimoiichikicount INTEGER DEFAULT 0, acvalue INTEGER DEFAULT 0
            )
        `);
        // HazureKaisu
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hazurekaisu (
                objectid SERIAL PRIMARY KEY,
                kaibetsu INTEGER UNIQUE,
                ${Array.from({length:43}, (_, i) => `k${(i+1).toString().padStart(2,'0')} INTEGER`).join(', ')},
                goukei INTEGER, l10 INTEGER, createdat TEXT
            )
        `);
        console.log('Postgres tables ensured.');
    } catch (e) {
        console.error('Error initializing DB:', e);
    }
}

// API: 最新レコード取得
app.get('/api/tousen/latest', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tousenbango ORDER BY kaibetsu DESC LIMIT 1');
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ message: 'No records found.' });
        }
    } catch (e) {
        res.status(500).send('Database error.');
    }
});

// API: 単一登録
app.post('/api/tousen/register', allowOnlyLocal, async (req, res) => {
    const data = req.body;
    const hits = data.hits.map(Number);
    const createdAt = new Date().toISOString();
    
    const guusuu = hits.filter(n => n % 2 === 0).length;
    const daishou = hits.filter(n => n >= 23).length;
    const goukei = hits.reduce((a, b) => a + b, 0);

    // 直近10件からHotSet作成
    const recent = await pool.query('SELECT hit1, hit2, hit3, hit4, hit5, hit6 FROM tousenbango ORDER BY kaibetsu DESC LIMIT 10');
    const hotSet = new Set();
    recent.rows.forEach(r => [r.hit1, r.hit2, r.hit3, r.hit4, r.hit5, r.hit6].forEach(n => hotSet.add(n)));
    
    const { hotCount, coldCount, hotColdPattern, computedAt } = await computeHotColdForRecord(data, hotSet);
    
    // 前回データ取得（隣接・リピート用）
    const prevRes = await pool.query('SELECT * FROM tousenbango WHERE kaibetsu = $1', [data.kaibetsu - 1]);
    const prev = prevRes.rows[0];
    
    let rinsetsuCount = 0;
    let repeatCount = 0;
    if (prev) {
        const prevAll = [prev.hit1, prev.hit2, prev.hit3, prev.hit4, prev.hit5, prev.hit6, prev.bonus];
        const rinSet = new Set();
        prevAll.forEach(n => { if(n>1) rinSet.add(n-1); if(n<43) rinSet.add(n+1); });
        rinsetsuCount = hits.filter(n => rinSet.has(n)).length;
        
        const prevMain = new Set([prev.hit1, prev.hit2, prev.hit3, prev.hit4, prev.hit5, prev.hit6]);
        repeatCount = hits.filter(n => prevMain.has(n)).length;
    }
    
    const shimoiichikiCount = new Set(hits.map(n => n % 10)).size;
    const acValue = calculateACValue(hits);

    const sql = `
        INSERT INTO tousenbango (kaibetsu, hit1, hit2, hit3, hit4, hit5, hit6, bonus, guusuu, daishou, goukei, createdat, hotcount, coldcount, hotcoldpattern, computedat, rinsetsucount, repeatcount, shimoiichikicount, acvalue)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT(kaibetsu) DO UPDATE SET
            hit1=EXCLUDED.hit1, hit2=EXCLUDED.hit2, hit3=EXCLUDED.hit3, hit4=EXCLUDED.hit4, hit5=EXCLUDED.hit5, hit6=EXCLUDED.hit6,
            bonus=EXCLUDED.bonus, guusuu=EXCLUDED.guusuu, daishou=EXCLUDED.daishou, goukei=EXCLUDED.goukei, 
            createdat=EXCLUDED.createdat, hotcount=EXCLUDED.hotcount, coldcount=EXCLUDED.coldcount, 
            hotcoldpattern=EXCLUDED.hotcoldpattern, computedat=EXCLUDED.computedat,
            rinsetsucount=EXCLUDED.rinsetsucount, repeatcount=EXCLUDED.repeatcount, 
            shimoiichikicount=EXCLUDED.shimoiichikicount, acvalue=EXCLUDED.acvalue
    `;

    try {
        await pool.query(sql, [data.kaibetsu, hits[0], hits[1], hits[2], hits[3], hits[4], hits[5], data.bonus, guusuu, daishou, goukei, data.createdat, data.hotcount, data.coldcount, data.hotcoldpattern, data.computedat, rinsetsuCount, repeatCount, shimoiichikiCount, acValue]);
        res.json({ message: 'Success', kaibetsu: data.kaibetsu });
    } catch (e) {
        console.error(e);
        res.status(500).send('Database error.');
    }
});

// API: 履歴取得
app.get('/api/tousen/history/:limit', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tousenbango ORDER BY kaibetsu DESC LIMIT $1', [req.params.limit]);
        res.json(result.rows);
    } catch (e) {
        res.status(500).send('Database error.');
    }
});

// --- 追加：特定の数字の「はずれ回数」を取得するAPI ---
app.get('/api/tousen/hazure/:num', async (req, res) => {
    try {
        const num = parseInt(req.params.num);
        // 最新の当選回から、その数字が最後に出た回を探す
        const result = await pool.query(
            `SELECT MAX(kaibetsu) as last_kaibetsu FROM tousenbango 
             WHERE $1 IN (hit1, hit2, hit3, hit4, hit5, hit6)`, 
            [num]
        );
        const latest = await pool.query('SELECT MAX(kaibetsu) as max_k FROM tousenbango');
        
        const lastKaibetsu = result.rows[0].last_kaibetsu || 0;
        const currentMax = latest.rows[0].max_k || 0;
        
        res.json({ num: num, hazureKaisu: currentMax - lastKaibetsu });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Hazure calculation error' });
    }
});

app.post('/api/hazure/update', async (req, res) => {
    const data = req.body;
    const createdAt = new Date().toISOString();

    console.log("[SERVER DEBUG] Received Data:", JSON.stringify(data));
    
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
    /*
    const columns = ['kaibetsu', 'goukei', 'L10', 'createdAt'];
    const values = [data.kaibetsu, goukei, L10, createdAt];
    const updateSets = ['goukei=excluded.goukei', 'L10=excluded.L10', 'createdAt=excluded.createdAt'];
    
    for (let i = 1; i <= 43; i++) {
        const key = 'k' + (i < 10 ? '0' + i : i);
        columns.push(key);
        values.push(data[key] || 0); // Default to 0 if missing
        updateSets.push(`${key}=excluded.${key}`);
    }
    */
    try {
        // 1. カラム名と値の配列を準備
        // ログに基づき、不要な success を除き、必要なカラムを抽出
        const columns = Object.keys(data).filter(key => key !== 'success');
        const values = columns.map(key => data[key]);
        
        // 2. $1, $2, $3... のプレースホルダー文字列を作成
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        
        // 3. DO UPDATE SET 部分の作成 (kaibetsu以外のカラムを更新対象にする)
        const updateSets = columns
            .filter(col => col !== 'kaibetsu')
            .map(col => `${col} = EXCLUDED.${col}`)
            .join(', ');

        // 4. SQL文の組み立て
        const sql = `
            INSERT INTO hazurekaisu (${columns.join(', ')})
            VALUES (${placeholders})
            ON CONFLICT (kaibetsu)
            DO UPDATE SET ${updateSets}
        `;

        console.log(`[SERVER DEBUG] hazure/update sql: ${sql}`); // ★追加

        await pool.query(sql, values);
        res.json({ success: true, message: "Hazurekaisu updated (Postgres)" });

    } catch (e) {
        console.error(`[SERVER ERROR] Hazure Update Error:`, e.message);
        res.status(500).json({ 
            success: false, 
            message: "Database error", 
            detail: e.message 
        });
    }
    /*
    const sql = `
        INSERT INTO hazurekaisu (${columns.join(', ')}) 
        VALUES (${columns.map(() => '?').join(', ')})
        ON CONFLICT(kaibetsu) DO UPDATE SET ${updateSets.join(', ')}
    `;
    
    console.log(`[SERVER DEBUG] hazure/update sql: ${sql}`); // ★追加

    try {
        await pool.query(sql, values);
        res.json({ success: true });
    } catch (err) {
        console.error(`[SERVER ERROR] ${err.message}`);
        res.status(500).json({ success: false, message: 'Database error' });
    }
    */
});

// --- 追加：はずれ回数などの一括更新用API（もしapp.jsから呼ばれる場合） ---
//app.get('/api/tousen/record/:kaibetsu', async (req, res) => {
  app.get('/api/tousen/by-kaibetsu/:kaibetsu', async (req, res) => {
    console.log(`[SERVER DEBUG] Fetching record for kaibetsu: ${req.params.kaibetsu}`); // ★追加
    try {
        const result = await pool.query('SELECT * FROM tousenbango WHERE kaibetsu = $1', [req.params.kaibetsu]);
        console.log(`[SERVER DEBUG] DB Result rows count: ${result.rows.length}`); // ★追加
        if (result.rows.length > 0) {
            // app.jsが期待するキャメルケースに変換して返す
            const r = result.rows[0];
            res.json({
                success: true,
                data: {
                    kaibetsu: r.kaibetsu,
                    hit1: r.hit1, hit2: r.hit2, hit3: r.hit3, hit4: r.hit4, hit5: r.hit5, hit6: r.hit6,
                    acValue: r.acvalue,
                    rinsetsuCount: r.rinsetsucount,
                    // 必要に応じて他のカラムも追加
                }
            });
        } else {
            console.warn(`[SERVER DEBUG] Kaibetsu ${req.params.kaibetsu} not found in DB`); // ★追加
            res.status(404).json({ success: false, message: 'Not found' });
        }
    } catch (e) {
        console.error(`[SERVER DEBUG] SQL Error: ${e.message}`); // ★追加
        res.status(500).json({ error: e.message });
    }
});

// --- 既存の履歴取得APIも「小文字→大文字」変換付きに差し替え ---
app.get('/api/tousen/history/:limit', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM tousenbango ORDER BY kaibetsu DESC LIMIT $1', 
            [req.params.limit]
        );
        
        const mappedRows = result.rows.map(r => ({
            kaibetsu: r.kaibetsu,
            hit1: r.hit1, hit2: r.hit2, hit3: r.hit3, hit4: r.hit4, hit5: r.hit5, hit6: r.hit6,
            bonus: r.bonus,
            acValue: r.acvalue,
            rinsetsuCount: r.rinsetsucount,
            repeatCount: r.repeatcount,
            shimoiichikiCount: r.shimoiichikicount,
            goukei: r.goukei,
            guusuu: r.guusuu,
            daishou: r.daishou,
            hotCount: r.hotcount,
            coldCount: r.coldcount,
            hotColdPattern: r.hotcoldpattern
        }));
        
        res.json(mappedRows);
    } catch (e) {
        res.status(500).send('History API error');
    }
});

// --- app.js の「/api/hazure/latest」という要求に応える ---
app.get('/api/hazure/latest', async (req, res) => {
    try {
        const result = await pool.query('SELECT MAX(kaibetsu) as max_k FROM tousenbango');
        const maxKaibetsu = result.rows[0].max_k || 0;
        res.json({ success: true, kaibetsu: maxKaibetsu }); // kaibetsuを返す
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// すべてのルート（/）へのアクセスを index.html に誘導する設定
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html')); 
});

// 404エラーをJSONで返す（HTMLが返るのを防ぐ）
app.use((req, res) => {
    console.warn(`[404] Not Found: ${req.url}`);
    res.status(404).json({ success: false, message: `Endpoint ${req.url} not found.` });
});

// サーバー起動
initializeDB().then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
});
