// This is a JavaScript file

// Node.jsサーバーと通信するための設定：廃止
//const API_BASE_URL = 'http://localhost:3000/api'; 

// --- Constants ---
// 現在のページのドメインを自動取得してAPIのベースURLにする
// これにより、localhostでもRender.comでも設定変更なしで動きます
const API_BASE_URL = `${window.location.origin}/api`;

/**
 * 【改修設計案】予想生成エンジン用：直近10回の統計実績を保持するグローバル変数
 * フィルタリングの基準値として使用されます。
 */
var currentAnalysis = {
    avgHot: 2,          // 平均ホットナンバー数
    avgEven: 3,         // 平均偶数個数
    avgBig: 3,          // 平均大きい数字の個数
    avgTotal: 130,      // 平均合計値
    avgRinsetsu: 1.2,   // 隣接数のデフォルト平均値
    avgRepeat: 0.8,     // 前回番号分析
    avgShimoiichiki: 5.0,  // 下一桁バランス
    avgAC: 8.0
};

// --- API Communication Helper ---
/**
 * カスタムアラート機能 (window.alertの代わりに簡易的にコンソールに出力)
 */
var customAlert = function(message) {
    console.log(`[ALERT] ${message}`);
    // 実際のアプリケーションでは、専用のモーダルUIを使用すべき
    // window.alert(message); // 動作確認のため一時的にコメントアウト
};

// --- API Communication Helper ---
/**
 * APIエンドポイントのURLを構築
 * @param {string} endpoint - APIエンドポイントの相対パス (例: 'tousen/register')
 */
var buildUrl = function(endpoint) {
    // API_BASE_URL (例: '/api') と endpoint (例: 'tousen/register') を結合
    // 確実に一つのスラッシュが入るように調整
    const separator = API_BASE_URL.endsWith('/') || endpoint.startsWith('/') ? '' : '/';
    return `${API_BASE_URL}${separator}${endpoint}`;
};

var apiGet = async function(endpoint) {
	const url = buildUrl(endpoint);
	console.log(`[DEBUG] Requesting URL: ${url}`); // ★追加：実際に叩いているURLを確認
    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[DEBUG] Response Error: ${response.status} ${response.statusText}`); // ★追加：ステータスコードを確認
            try {
                const errorData = JSON.parse(errorText);
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.message || 'Unknown API Error'}`);
            } catch {
                throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
            }
        }
        console.log(`[DEBUG] response: ${response}`); // ★追加
        return await response.json();
    } catch (error) {
        console.error('API Get Error:', error);
        return null;
    }
};

var apiSend = async function(endpoint, method, data) {
    const url = buildUrl(endpoint);
    console.log(`[apiSend] url: ${url}`);
    console.log(`[apiSend] method: ${method}`);
    console.log(`[apiSend] data.kaibetsu: ${data.kaibetsu}`);
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        console.log(`[apiSend] response: ${response.body}`);
        if (!response.ok) {
            // サーバーからのエラー応答を解析
            const errorText = await response.text();
            try {
                const errorData = JSON.parse(errorText);
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.message || 'Unknown API Error'}`);
            } catch {
                 // **JSON解析エラー（HTMLが返された場合など）**
                throw new Error(`HTTP error! status: ${response.status}. Server response not valid JSON or unexpected format: ${errorText.substring(0, 50)}...`);
            }
        }
        // 成功時のJSON応答を解析
        return await response.json();
        
    } catch (error) {
        console.error(`Error sending data to ${endpoint}:`, error);
        // `Failed to fetch` エラーは接続に関する問題。
        let displayMessage = error.message;
        if (error.message.includes('Failed to fetch')) {
             displayMessage = 'サーバーに接続できませんでした。サーバーが起動しているか、またURLが正しいか確認してください。';
        }
        
        customAlert(`データの送信中にエラーが発生しました: ${displayMessage}`);
        return null;
    }
};
// --- Core Application Logic: TousenBango (Registration) ---
var touroku = async function() {
    const kaibetsu = parseInt(document.getElementById('kaibetsu').value);
    console.log(`kaibetsu ${kaibetsu}`);
    // ... (既存のバリデーションロジックは省略)
    const hits = [
        document.getElementById('hit1'), document.getElementById('hit2'), document.getElementById('hit3'), 
        document.getElementById('hit4'), document.getElementById('hit5'), document.getElementById('hit6')
    ].map(el => parseInt(el.value)).sort((a, b) => a - b); // 登録前に昇順ソート
    const bonus = parseInt(document.getElementById('bonus').value);
    if (isNaN(kaibetsu) || hits.some(isNaN) || isNaN(bonus)) {
        window.alert('回別と7つの数字をすべて入力してください。');
        return;
    }
    // 基本的な数字の範囲チェック (1-43)
    const allNumbers = [...hits, bonus];
    if (allNumbers.some(n => n < 1 || n > 43)) {
        window.alert('数字は1から43の範囲で入力してください。');
        return;
    }
    // 重複チェック (ボーナス以外)
    const uniqueHits = new Set(hits);
    if (uniqueHits.size !== 6) {
        window.alert('本数字6個に重複があります。');
        return;
    }
	// 当選番号6個の中にボーナス番号が含まれていないかチェック
    if (hits.includes(bonus)) {
        window.alert(`本数字の中にボーナス番号が含まれています。`);
        return;
    }
	
    const data = {
        kaibetsu: kaibetsu,
        hits: hits,
        bonus: bonus
    };
    console.log(`data.kaibetsu ${data.kaibetsu}`);
    const result = await apiSend('tousen/register', 'POST', data);
    if (result) {
        window.alert(`当選番号を登録/更新しました。\n回別: ${result.kaibetsu} (DB ID: ${result.objectId})`);
    }
};

// --- Core Application Logic: Bulk Registration ---
var parseCSV = function(csvText) {
    const lines = csvText.trim().split('\n');
    const dataLines = lines; 
    const parsedData = [];

    for (let i = 0; i < dataLines.length; i++) {
        const values = dataLines[i].split(',').map(v => v.trim());
        if (values.length !== 8) continue; 

        const kaibetsu = parseInt(values[0], 10);
        const numbers = values.slice(1).map(v => parseInt(v, 10));

        const isValid = !isNaN(kaibetsu) && kaibetsu > 0 && numbers.every(n => !isNaN(n) && n >= 1 && n <= 43);

        if (isValid) {
            parsedData.push({
                kaibetsu: kaibetsu,
                hit1: numbers[0],
                hit2: numbers[1],
                hit3: numbers[2],
                hit4: numbers[3],
                hit5: numbers[4],
                hit6: numbers[5],
                bonus: numbers[6]
            });
        } else {
            console.warn(`Skipping invalid CSV line at row ${i + 1}: ${dataLines[i]}`);
        }
    }
    return parsedData;
};

var bulkRegister = function() {
    const fileInput = document.getElementById('csvFile');
    const file = fileInput.files[0];

    if (!file) {
        window.alert('CSVファイルを選択してください。');
        return;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        const csvText = e.target.result;
        const dataArray = parseCSV(csvText);

        if (dataArray.length === 0) {
            window.alert('CSVファイルから有効なデータが見つかりませんでした。形式を確認してください。');
            return;
        }

        const result = await apiSend('tousen/bulk-register', 'POST', dataArray);

        if (result && result.insertedCount !== undefined && result.updatedCount !== undefined) {
            window.alert(`一括登録が完了しました！\n- 新規登録: ${result.insertedCount}件\n- 更新: ${result.updatedCount}件`);
        }
    };
    reader.readAsText(file);
};

// --- Core Application Logic: HazureKaisu (Miss Count) ---

var hazerukaisuUpdate = async function(latestTousen) {
    console.log(`hazureKaisuUpdate starting...`);

    let latestHazure = await apiGet('hazure/latest');

    console.log(`[DEBUG] サーバーから取得した最新回情報 latestHazure.kaibetsu: ${latestHazure.kaibetsu}`);

    // let currentKaibetsu = latestHazure ? latestHazure.kaibetsu + 1 : 1;
    let currentKaibetsu = (latestHazure && latestHazure.kaibetsu) ? latestHazure.kaibetsu + 1 : 1;
    //let currentKaibetsu = 1;
    let recordsUpdated = 0;

    console.log(`[DEBUG] latestTousen.kaibetsu: ${latestTousen.kaibetsu}`);
    console.log(`[DEBUG] currentKaibetsu: ${currentKaibetsu}`);
    const maxLoop = latestHazure && latestHazure.kaibetsu ? latestHazure.kaibetsu : 0;
    console.log(`[DEBUG] ループを開始します。maxLoop: ${maxLoop}`);

    // while (currentKaibetsu <= latestTousen.kaibetsu) {
       while (currentKaibetsu <= maxLoop) {
        
        console.log(`Processing kaibetsu: ${currentKaibetsu}`);
        
        // const tousenRecord = await apiGet(`tousen/by-kaibetsu/${currentKaibetsu}`);
        const tousenRecord = await apiGet(`tousen/by-kaibetsu/${currentKaibetsu}`);

        // サーバーからの生のレスポンスをログに出す（最重要！）
        console.log(`[DEBUG] 第${currentKaibetsu}回のレスポンス内容:`, tousenRecord);

        if (!tousenRecord || !tousenRecord.success || !tousenRecord.data) {
            console.warn(`tousenbango record missing for kaibetsu ${currentKaibetsu}. Stopping loop.`);
            console.warn(`[DEBUG] 第${currentKaibetsu}回が見つからない、またはエラーのためループを終了します。原因:`, tousenRecord ? tousenRecord.message : "レスポンス空");
            break; 
        }

        let newHazure = latestHazure ? {...latestHazure} : {}; 
        
        if (!latestHazure) {
            for(let i=1; i<=43; i++) {
                const key = 'k' + (i < 10 ? '0' + i : i);
                newHazure[key] = 0; 
            }
        }
        
        for(let i=1; i<=43; i++) {
            const key = 'k' + (i < 10 ? '0' + i : i);
            newHazure[key] = (newHazure[key] || 0) + 1; 
        }
        
         const d = tousenRecord.data;
        const tousen = [d.hit1, d.hit2, d.hit3, d.hit4, d.hit5, d.hit6];
        
        console.log(`[DEBUG] 第${currentKaibetsu}回のデータ解析を開始: hits=[${tousen.join(', ')}]`);

        tousen.forEach(num => {
             const key = 'k' + (num < 10 ? '0' + num : num);
             newHazure[key] = 0; 
        });
        
        newHazure.kaibetsu = currentKaibetsu;
        delete newHazure.objectId; 
        delete newHazure.createdAt; 
        delete newHazure.goukei; 
        delete newHazure.L10;
        
        // 更新処理の直前にログ
        console.log(`[DEBUG] 第${currentKaibetsu}回の更新APIを叩きます...`);

        const result = await apiSend('hazure/update', 'POST', newHazure);
        
        if (result) {
            recordsUpdated++;
            latestHazure = {
                ...newHazure, 
                objectId: result.objectId, 
                kaibetsu: currentKaibetsu 
            };
            console.log(`[DEBUG] 第${currentKaibetsu}回の更新結果:`, result);
        } else {
            console.error(`Error updating HazureKaisu for kaibetsu ${currentKaibetsu}. Stopping loop.`);
            break; 
        }

        currentKaibetsu++; 
    }
    console.log("[DEBUG] hazerukaisuUpdate: すべてのループが終了しました");
    return recordsUpdated > 0;
};

var hazure = async function() {
    console.log("hazure start");
    
    const latestTousen = await apiGet('tousen/latest');
    if (!latestTousen) {
        window.alert("最新の当選番号が登録されていません。先に当選番号を登録してください。");
        return;
    }
    
    const updateSuccess = await hazerukaisuUpdate(latestTousen);

    if (updateSuccess) {
         window.alert(`${latestTousen.kaibetsu}回までの、はずれ回数の計算・更新が完了しました。`);
    } else {
         const latestHazure = await apiGet('hazure/latest');
         if (latestHazure && latestHazure.kaibetsu === latestTousen.kaibetsu) {
             window.alert(`はずれ回数計算・更新はスキップされました。最新回 (${latestTousen.kaibetsu}回) は既に計算済みです。`);
         } else {
             window.alert('はずれ回数計算・更新はスキップされました。まだ計算すべき回が存在しないか、処理中にエラーが発生しました。');
         }
    }
};

// --- Core Application Logic: Statistical Analysis ---
/**
 * ホットナンバー (過去10回で出現) とコールドナンバー (過去10回で未出現) を分析する。
 * @returns {Object} { hotNumbers: [N1, N2...], coldNumbers: [N1, N2...] }
 */
var analyzeHotColdNumbers = async function() {
    const history = await apiGet('tousen/history/10');
    console.log('デバッグ: history', history); // 追加
    
    if (!history || history.length === 0) {
        return { hotNumbers: [], coldNumbers: Array.from({length: 43}, (_, i) => i + 1) }; // データ不足時は全部コールド
    }

    const appearedNumbers = new Set();
    history.forEach(record => {
        const allNumbers = [
            record.hit1, record.hit2, record.hit3, record.hit4, 
            record.hit5, record.hit6
            //record.bonus
        ];
        allNumbers.forEach(num => {
            if (num >= 1 && num <= 43) {
                appearedNumbers.add(num);
            }
        });
    });

    const hotNumbers = [];
    const coldNumbers = [];

    for (let i = 1; i <= 43; i++) {
        if (appearedNumbers.has(i)) {
            hotNumbers.push(i);
        } else {
            coldNumbers.push(i);
        }
    }
    
    return { 
        hotNumbers: hotNumbers.sort((a, b) => a - b),
        coldNumbers: coldNumbers.sort((a, b) => a - b)
    };
};

var statisticalAnalysis = async function() {
    console.log('統計分析を実行中...');
    
    const { hotNumbers, coldNumbers } = await analyzeHotColdNumbers();

    if (hotNumbers.length === 0 && coldNumbers.length === 43) {
         window.alert("データ不足のため分析をスキップしました。\n過去10回分の当選番号を登録してください。");
         return;
    }

    let analysisResult = `--- ホット／コールド ナンバー分析 ---\n\n`;
    analysisResult += `【ホットナンバー】 (過去10回で出現): ${hotNumbers.length}個\n`;
    analysisResult += hotNumbers.join(', ') + '\n\n';
    analysisResult += `【コールドナンバー】 (過去10回で未出現): ${coldNumbers.length}個\n`;
    analysisResult += coldNumbers.join(', ') + '\n';

    window.alert(analysisResult); 
};
// --- Core Application Logic: Prediction Generation (NEW) ---
/**
 * 数字配列をシャッフルする
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// AC値（複雑度分析）関連
function calculateACValue(numbers) {
    const diffs = new Set();
    const sorted = [...numbers].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            diffs.add(sorted[j] - sorted[i]);
        }
    }
    return diffs.size - (sorted.length - 1);
}

/**
 * サイレント・フィルタリング判定
 * 実績値(currentAnalysis)との乖離をチェックする
 * @param {Array} numbers - 生成された6つの数字
 * @returns {Boolean} - 合格ならtrue
 */
function isPassSilentFilter(numbers) {
    // 1. 偶数個数のチェック
    const evenCount = numbers.filter(n => n % 2 === 0).length;
    const evenDiff = Math.abs(evenCount - currentAnalysis.avgEven);
    if (evenDiff > 1.5) return false; // 実績平均から±1.5個以内なら合格

    // 2. 大数(22以上)個数のチェック
    const bigCount = numbers.filter(n => n >= 22).length;
    const bigDiff = Math.abs(bigCount - currentAnalysis.avgBig);
    if (bigDiff > 1.5) return false; // 実績平均から±1.5個以内なら合格

    // 3. 合計値のチェック
    const totalSum = numbers.reduce((a, b) => a + b, 0);
    const sumDiff = Math.abs(totalSum - currentAnalysis.avgTotal);
    if (sumDiff > 25) return false; // 実績平均合計から±25以内なら合格

    // 隣接番号フィルタ
    if (window.lastDrawNumbers) {
        const rinsetsuSet = new Set();
        window.lastDrawNumbers.forEach(n => {
            if (n > 1) rinsetsuSet.add(n - 1);
            if (n < 43) rinsetsuSet.add(n + 1);
        });
        const rCount = numbers.filter(n => rinsetsuSet.has(n)).length;
        
        // 平均が1.2個なら、0〜2個の範囲を許容とする（統計的な遊びを持たせる）
        const minR = Math.max(0, Math.floor(currentAnalysis.avgRinsetsu) - 1);
        const maxR = Math.ceil(currentAnalysis.avgRinsetsu) + 1;
        
        if (rCount < minR || rCount > maxR) return false;

        // ★リピート数（前回本数字と完全に一致する数）をカウント
        const prevMainSet = new Set(window.lastDrawNumbers.slice(0, 6)); 
        const rptCount = numbers.filter(n => prevMainSet.has(n)).length;

        // フィルタ条件：極端に多すぎるリピート（例：3個以上）は除外
        if (rptCount > 2) return false;

        // 「狙い」のロジック：リピートが0個の組み合わせを、統計に基づいて適度に間引く
        if (currentAnalysis.avgRepeat > 0.5 && rptCount === 0) {
            if (Math.random() > 0.3) return false; // 70%の確率でリピート0の組み合わせをボツにする
        }
    }

    // ★下一桁バランスのチェック
    const shimoSet = new Set(numbers.map(n => n % 10));
    const shimoCount = shimoSet.size;
    // フィルタ条件：下一桁の種類が3種類以下（＝同じ下一桁が3つ以上ある等）は、
    // バランスが悪いため、統計値(avg)が4.5以上の時は厳しめにカット
    if (currentAnalysis.avgShimoiichiki > 4.5 && shimoCount <= 3) {
        if (Math.random() > 0.2) return false; // 80%の確率でカット
    }

    // ★AC値（複雑度）のチェック
    const currentAC = calculateACValue(numbers);
    // フィルタ条件：AC値が7未満（0〜6）は規則的すぎて当選しにくいため排除
    // ロト6の当選番号の約80〜90%はAC値7〜10に集中しています
    if (currentAC < 7) {
        return false; // 厳しめにカット
    }
    
    return true;
}

var hotColdData = { hotNumbers: [], coldNumbers: [] };

var openPredictionModal = async function() {
    console.log('openPredictionModal start');
    hotColdData = await analyzeHotColdNumbers();
    // 変更: 保存済みhotCountを利用、未計算時は従来ロジックにフォールバック
    // Try to get latest record with computed hotCount
    document.getElementById('predictionResult').innerHTML = '<p class="text-gray-500 text-sm">「予想生成実行」ボタンを押すと結果が表示されます。</p>';
    document.getElementById('predictionModal').classList.add('open');
};

var closePredictionModal = function() {
    document.getElementById('predictionModal').classList.remove('open');
};
// 指定された配列から、重複なく指定個数だけランダムに数字を選ぶヘルパー関数
var selectRandomNumbers = function(sourceArray, count) {
    if (count > sourceArray.length) {
        return []; // 選べる個数を超えている場合は空を返す
    }
    const shuffled = sourceArray.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
};

var generateNumberSet = function(hotCount, coldCount) {
    const { hotNumbers, coldNumbers } = hotColdData; 
    // hotColdDataには何も入ってない？
    console.log('デバッグ: generateNumberSet', { hotCount, coldCount, hotNumbersLen: hotNumbers.length, coldNumbersLen: coldNumbers.length }); // 追加
    
    // 必要な個数が、候補の数を超えていないかチェック
    if (hotCount > hotNumbers.length || coldCount > coldNumbers.length || hotCount + coldCount !== 6) {
        console.log('デバッグ: チェック失敗', { hotCount, coldCount, hotNumbersLen: hotNumbers.length, coldNumbersLen: coldNumbers.length }); // 追加
        return null; // 不正な設定
    }

    // 1. ホットとコールドから指定数を選ぶ
    let selectedHot = selectRandomNumbers(hotNumbers, hotCount);
    let selectedCold = selectRandomNumbers(coldNumbers, coldCount);

    // 2. 組み合わせた後、昇順にソートして完成
    let finalSet = selectedHot.concat(selectedCold);
    
    // 3. 重複チェック (理論上は発生しないはずだが念のため)
    if (new Set(finalSet).size !== 6) {
         console.error("Generated set has duplicates, retrying.");
         return null;
    }
    return finalSet.sort((a, b) => a - b);
};

var generatePredictions = function() {
    const patternCountInput = document.getElementById('patternCount');
    const patternCount = parseInt(patternCountInput.value) || 5;
    
    // 実績平均からホットナンバーのピックアップ数を決定（四捨五入）
    const hotCountReq = Math.round(currentAnalysis.avgHot);
    const coldCountReq = 6 - hotCountReq;

    //const data = await apiGet('tousen/data');
    //if (!data) return;

    const { hotNumbers, coldNumbers } = hotColdData;

    const resultArea = document.getElementById('predictionResult');
    resultArea.innerHTML = '<p class="text-blue-600 animate-pulse text-center">最新の実績に基づき最適化中...</p>';

    const patterns = [];
    let attempts = 0;
    const MAX_ATTEMPTS = 500; // 無限ループ防止

    // 指定された口数分、フィルターを通過するまで生成を繰り返す
    while (patterns.length < patternCount && attempts < MAX_ATTEMPTS) {
        attempts++;

        // 基本選出 (ホット/コールド比率遵守)
        const selectedHot = shuffleArray([...hotNumbers]).slice(0, hotCountReq);
        const selectedCold = shuffleArray([...coldNumbers]).slice(0, coldCountReq);
        const candidate = [...selectedHot, ...selectedCold].sort((a, b) => a - b);

        // サイレント・フィルタリング
        if (isPassSilentFilter(candidate)) {
            // 重複パターンでなければ採用
            const key = candidate.join(',');
            if (!patterns.some(p => p.join(',') === key)) {
                patterns.push(candidate);
            }
        }
    }
    console.log(`生成完了: 試行回数 ${attempts}回`);
    renderPredictionResults(patterns);

};

function renderPredictionResults(patterns) {
    const resultArea = document.getElementById('predictionResult');
    if (patterns.length === 0) {
        resultArea.innerHTML = '<p class="text-red-500 text-sm text-center">条件に合う数字が見つかりませんでした。<br>もう一度お試しください。</p>';
        return;
    }

    let html = '<div class="space-y-2">';
    patterns.forEach((p, i) => {
        html += `<div class="flex items-center space-x-2 bg-white p-2 rounded border border-gray-200 shadow-sm animate-fade-in">
            <span class="text-xs font-bold text-gray-400 w-6">#${i+1}</span>
            <div class="flex space-x-1">
                ${p.map(n => `<span class="w-8 h-8 flex items-center justify-center rounded-full bg-indigo-600 text-white text-xs font-bold">${n}</span>`).join('')}
            </div>
        </div>`;
    });
    html += '</div>';
    resultArea.innerHTML = html;
}


var predictionGeneration = function() {
    console.log(`predictionGeneration start`);
    openPredictionModal();
};

// Placeholder functions for unimplemented features
var temporaryCalculation = function() {
    window.alert('臨時計算を実行します... (未実装)');
};

/**
 * 直近10回のデータを取得し、ダッシュボードの全統計（ホット/コールド、バランス、合計値）を更新する
 */
var updateDashboardStats = async function() {
    // 直近10回の履歴を取得
    const records = await apiGet('tousen/history/10');
    if (!records || records.length === 0) return;

    let totalEven = 0, totalBig = 0, totalSum = 0, totalHot = 0;

    records.forEach(r => {
        totalEven += (r.guusuu || 0);
        totalBig += (r.daishou || 0);
        totalSum += (r.goukei || 0);
        totalHot += (r.hotCount || 0);
    });
    const count = records.length;
    
    // 実績平均を保存
    currentAnalysis.avgEven = Math.round(totalEven / count);
    currentAnalysis.avgBig = Math.round(totalBig / count);
    currentAnalysis.avgTotal = Math.round(totalSum / count);
    currentAnalysis.avgHot = Math.round(totalHot / count);

    // --- 1. 出現傾向（ホット・コールド）の算出と表示 ---
    const validHotRecords = records.filter(r => r.hotCount !== undefined && r.hotCount !== null);
    if (validHotRecords.length > 0) {
        //const totalHot = validHotRecords.reduce((sum, r) => sum + r.hotCount, 0);
        const LavgHot = Math.round((totalHot / validHotRecords.length) * 10) / 10;
        const LavgCold = Math.round((6 - LavgHot) * 10) / 10;

        const hotColdInfo = document.getElementById('hotColdInfo');
        if (hotColdInfo) {
            hotColdInfo.innerHTML = `
                <div class="flex justify-between items-end">
                    <span class="text-2xl font-bold text-indigo-600">${LavgHot}</span>
                    <span class="text-gray-400 text-sm pb-1">：</span>
                    <span class="text-2xl font-bold text-orange-600">${LavgCold}</span>
                </div>
                <div class="flex justify-between text-xs font-semibold text-gray-500 uppercase tracking-tighter">
                    <span>HOT</span>
                    <span>COLD</span>
                </div>
            `;
        }
    }
    // --- 2. バランス統計（偶数・大小）の算出と表示 ---
    const LavgEven = totalEven / records.length;
    const LavgOdd = 6 - LavgEven;
    const LavgBig = totalBig / records.length;
    const LavgSmall = 6 - LavgBig;
    const LavgTotal = totalSum / records.length;

    // --- 【データ取得の統合】 統計データの統合保持 ---
    // 改修設計案に基づき、予想生成エンジンでフィルタリング基準として使用するための値を保持
    // 既存の表示画面（index.html）への影響を避けるため、表示用変数とは別に整数化して格納

    // HTMLへの反映（バーとラベル）
    updateBalanceBar('evenOddBar', 'evenOddLabel', LavgEven, LavgOdd, '#2563eb', '#dc2626');
    updateBalanceBar('bigSmallBar', 'bigSmallLabel', LavgBig, LavgSmall, '#4f46e5', '#ea580c');

    // --- 3. 合計値の推移（古い順）の表示 ---
    const totalSumHistory = document.getElementById('totalSumHistory');
    if (totalSumHistory) {
        totalSumHistory.innerHTML = '';
        const chronological = [...records].reverse();
        chronological.forEach(r => {
            const span = document.createElement('span');
            span.className = 'px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-sm font-bold border border-amber-200';
            span.textContent = r.goukei;
            totalSumHistory.appendChild(span);
        });
    }
    // 隣接番号の平均値を画面に反映
    const rinsetsuEl = document.getElementById('avgRinsetsuDisplay');
    if (rinsetsuEl) {
        rinsetsuEl.textContent = currentAnalysis.avgRinsetsu.toFixed(1);
    }
    const totalRepeat = records.reduce((sum, r) => sum + (r.repeatCount || 0), 0);
    currentAnalysis.avgRepeat = totalRepeat / records.length;
    // UIに反映
    const repeatEl = document.getElementById('avgRepeatDisplay');
    if (repeatEl) {
        repeatEl.textContent = currentAnalysis.avgRepeat.toFixed(1);
    }
    // 直近10回の「下一桁の種類の多さ」の平均を計算し画面に表示
    const totalShimo = records.reduce((sum, r) => sum + (r.shimoiichikiCount || 0), 0);
    currentAnalysis.avgShimoiichiki = totalShimo / records.length;
    // UIに反映
    const shimoEl = document.getElementById('avgShimoiichikiDisplay');
    if (shimoEl) {
        shimoEl.textContent = currentAnalysis.avgShimoiichiki.toFixed(1);
    }

    // AC値（複雑度分析）
    const totalAC = records.reduce((sum, r) => sum + (r.acValue || 0), 0);
    currentAnalysis.avgAC = totalAC / records.length;
    // UIに反映
    const acEl = document.getElementById('avgACDisplay');
    if (acEl) {
        acEl.textContent = currentAnalysis.avgAC.toFixed(1);
    }
};
/**
 * バランスバー（ステータスバー）とラベルを更新する補助関数
 */
function updateBalanceBar(barId, labelId, val1, val2, color1, color2) {
    const barEl = document.getElementById(barId);
    const labelEl = document.getElementById(labelId);
    if (!barEl || !labelEl) return;

    const pct1 = (val1 / 6) * 100;
    const pct2 = (val2 / 6) * 100;

    barEl.innerHTML = `
        <div style="width: ${pct1}%; background-color: ${color1}; transition: width 0.5s;"></div>
        <div style="width: ${pct2}%; background-color: ${color2}; transition: width 0.5s;"></div>
    `;
    //labelEl.textContent = `${val1} ： ${val2}`;
    labelEl.textContent = `${Math.round(val1 * 10) / 10} ： ${Math.round(val2 * 10) / 10}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const fetchBtn = document.getElementById('fetchLatestBtn');

    // ボタンが存在する場合のみイベントを設定する
    if (fetchBtn) {
        fetchBtn.addEventListener('click', async () => {
            if (!confirm('公式サイトから最新の当選番号を取得しますか？')) return;

            const originalText = fetchBtn.innerText;
            fetchBtn.disabled = true;
            fetchBtn.innerText = '取得中...';

            try {
                const response = await fetch(`${API_BASE_URL}/tousen/fetch-latest`);
                const data = await response.json();

                if (data.error) throw new Error(data.error);

                const confirmMsg = `第${data.kaibetsu}回のデータを取得しました。\n` +
                                   `本数字: ${data.hit1}, ${data.hit2}, ${data.hit3}, ${data.hit4}, ${data.hit5}, ${data.hit6}\n` +
                                   `ボーナス: ${data.bonus}\n\n` +
                                   `この内容でデータベースに登録（更新）しますか？`;

                if (confirm(confirmMsg)) {
                    // サーバーの登録APIが期待する形式（hits配列）に変換する
                    const requestData = {
                        kaibetsu: data.kaibetsu,
                        hits: [data.hit1, data.hit2, data.hit3, data.hit4, data.hit5, data.hit6],
                        bonus: data.bonus
                    };

                    const regResponse = await fetch(`${API_BASE_URL}/tousen/register`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestData)  // 変換したデータを送る
                    });
                    
                    const regResult = await regResponse.json();
                    
                    if (regResult.success) {
                        alert(`第${data.kaibetsu}回の登録が完了しました！`);
                        location.reload(); 
                    } else {
                        throw new Error(regResult.error || '登録に失敗しました。');
                    }
                }
            } catch (err) {
                alert('エラーが発生しました: ' + err.message);
                console.error(err);
            } finally {
                fetchBtn.disabled = false;
                fetchBtn.innerText = originalText;
            }
        });
    }
});

// ページロード時に統計情報を表示
window.addEventListener('DOMContentLoaded', function() {
    updateDashboardStats();
});
