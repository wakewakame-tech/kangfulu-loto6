const express = require('express');
const { Pool } = require('pg'); // SQLiteから変更
const path = require('path');
const cors = require('cors'); 
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();

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
        // TousenBango
        await pool.query(`
            CREATE TABLE IF NOT EXISTS TousenBango (
                objectId SERIAL PRIMARY KEY,
                kaibetsu INTEGER UNIQUE,
                hit1 INTEGER, hit2 INTEGER, hit3 INTEGER, hit4 INTEGER, hit5 INTEGER, hit6 INTEGER,
                bonus INTEGER, guusuu INTEGER, daishou INTEGER, goukei INTEGER,
                createdAt TEXT, hotCount INTEGER, coldCount INTEGER, hotColdPattern TEXT, computedAt TEXT,
                rinsetsuCount INTEGER DEFAULT 0, repeatCount INTEGER DEFAULT 0,
                shimoiichikiCount INTEGER DEFAULT 0, acValue INTEGER DEFAULT 0
            )
        `);
        // HazureKaisu
        await pool.query(`
            CREATE TABLE IF NOT EXISTS HazureKaisu (
                objectId SERIAL PRIMARY KEY,
                kaibetsu INTEGER UNIQUE,
                ${Array.from({length:43}, (_, i) => `k${(i+1).toString().padStart(2,'0')} INTEGER`).join(', ')},
                goukei INTEGER, L10 INTEGER, createdAt TEXT
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
        const result = await pool.query('SELECT * FROM TousenBango ORDER BY kaibetsu DESC LIMIT 1');
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
    const recent = await pool.query('SELECT hit1, hit2, hit3, hit4, hit5, hit6 FROM TousenBango ORDER BY kaibetsu DESC LIMIT 10');
    const hotSet = new Set();
    recent.rows.forEach(r => [r.hit1, r.hit2, r.hit3, r.hit4, r.hit5, r.hit6].forEach(n => hotSet.add(n)));
    
    const { hotCount, coldCount, hotColdPattern, computedAt } = await computeHotColdForRecord(data, hotSet);
    
    // 前回データ取得（隣接・リピート用）
    const prevRes = await pool.query('SELECT * FROM TousenBango WHERE kaibetsu = $1', [data.kaibetsu - 1]);
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
        INSERT INTO TousenBango (kaibetsu, hit1, hit2, hit3, hit4, hit5, hit6, bonus, guusuu, daishou, goukei, createdAt, hotCount, coldCount, hotColdPattern, computedAt, rinsetsuCount, repeatCount, shimoiichikiCount, acValue)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT(kaibetsu) DO UPDATE SET
            hit1=EXCLUDED.hit1, hit2=EXCLUDED.hit2, hit3=EXCLUDED.hit3, hit4=EXCLUDED.hit4, hit5=EXCLUDED.hit5, hit6=EXCLUDED.hit6,
            bonus=EXCLUDED.bonus, guusuu=EXCLUDED.guusuu, daishou=EXCLUDED.daishou, goukei=EXCLUDED.goukei, 
            createdAt=EXCLUDED.createdAt, hotCount=EXCLUDED.hotCount, coldCount=EXCLUDED.coldCount, 
            hotColdPattern=EXCLUDED.hotColdPattern, computedAt=EXCLUDED.computedAt,
            rinsetsuCount=EXCLUDED.rinsetsuCount, repeatCount=EXCLUDED.repeatCount, 
            shimoiichikiCount=EXCLUDED.shimoiichikiCount, acValue=EXCLUDED.acValue
    `;

    try {
        await pool.query(sql, [data.kaibetsu, hits[0], hits[1], hits[2], hits[3], hits[4], hits[5], data.bonus, guusuu, daishou, goukei, createdAt, hotCount, coldCount, hotColdPattern, computedAt, rinsetsuCount, repeatCount, shimoiichikiCount, acValue]);
        res.json({ message: 'Success', kaibetsu: data.kaibetsu });
    } catch (e) {
        console.error(e);
        res.status(500).send('Database error.');
    }
});

// API: 履歴取得
app.get('/api/tousen/history/:limit', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM TousenBango ORDER BY kaibetsu DESC LIMIT $1', [req.params.limit]);
        res.json(result.rows);
    } catch (e) {
        res.status(500).send('Database error.');
    }
});

// すべてのルート（/）へのアクセスを index.html に誘導する設定
app.get('(.*)', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html')); 
});

// サーバー起動
initializeDB().then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
});
