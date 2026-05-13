const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH ====================
const ALL_VI = Array.from({ length: 14 }, (_, i) => i + 4); // 4..17
const VI_TAI = ALL_VI.filter(v => v > 10);
const VI_XIU = ALL_VI.filter(v => v <= 10);

const SUNWIN_API = 'https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=200&tableId=39791215743193&curPage=1';
const CLUB789_API = 'https://demo7892.fun/history/getLastResult?gameId=ktrng_3986&size=100&tableId=398625062021&curPage=1';

// ==================== LỊCH SỬ & THỐNG KÊ ====================
let history = {
    sunwin: { data: [], thongKeVi: {}, cache: new Map() },
    club789: { data: [], thongKeVi: {}, cache: new Map() }
};

ALL_VI.forEach(v => {
    history.sunwin.thongKeVi[v] = { tong: 0, dung: 0, tiLe: '0%' };
    history.club789.thongKeVi[v] = { tong: 0, dung: 0, tiLe: '0%' };
});

function capNhatThongKe(game, viThucTe, cacViDuDoan) {
    const tk = history[game].thongKeVi;
    for (let vi of cacViDuDoan) {
        tk[vi].tong++;
        if (vi === viThucTe) tk[vi].dung++;
        tk[vi].tiLe = (tk[vi].dung / tk[vi].tong * 100).toFixed(1) + '%';
    }
}

// ==================== THUẬT TOÁN DỰ ĐOÁN (TẤT ĐỊNH) ====================
function duDoan4Vi(lichSuTong, lichSuVi, khoangCach) {
    if (lichSuTong.length < 10) {
        const loai = lichSuTong[0] > 10 ? 'Tài' : 'Xỉu';
        const macDinh = loai === 'Tài' ? [11,12,13,17] : [4,5,6,10];
        return { viList: macDinh, loai, doTinCay: 55 };
    }

    let diem = {};
    ALL_VI.forEach(v => diem[v] = 0);
    let trongSo = 0;

    // 1. Tần suất (trọng số 1.5)
    if (lichSuVi.length >= 30) {
        const dem = {};
        ALL_VI.forEach(v => dem[v] = 0);
        lichSuVi.slice(0, 100).forEach(v => dem[v]++);
        const max = Math.max(...ALL_VI.map(v => dem[v]));
        for (let v of ALL_VI) diem[v] += (dem[v] / max) * 1.5;
        trongSo += 1.5;
    }

    // 2. Xu hướng tổng (trọng số 2.0)
    if (lichSuTong.length >= 20) {
        const gan = lichSuTong.slice(0, 10), truoc = lichSuTong.slice(10, 20);
        const avgGan = gan.reduce((a,b)=>a+b,0)/10;
        const avgTruoc = truoc.reduce((a,b)=>a+b,0)/10;
        let delta = avgGan - avgTruoc;
        let duDoanTong = Math.min(17, Math.max(4, Math.round(avgGan + delta * 0.5)));
        for (let i = -2; i <= 2; i++) {
            let v = duDoanTong + i;
            if (v >= 4 && v <= 17) diem[v] += (1 - Math.abs(i)/3) * 2.0;
        }
        trongSo += 2.0;
    }

    // 3. Markov bậc 2 (trọng số 1.8)
    if (lichSuVi.length >= 8) {
        const map = new Map();
        for (let i=0; i<lichSuVi.length-2; i++) {
            const key = `${lichSuVi[i]}_${lichSuVi[i+1]}`;
            const next = lichSuVi[i+2];
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(next);
        }
        const lastKey = `${lichSuVi[0]}_${lichSuVi[1]}`;
        const nextList = map.get(lastKey);
        if (nextList && nextList.length) {
            const dem = {};
            nextList.forEach(v => dem[v] = (dem[v]||0)+1);
            const maxMarkov = Math.max(...Object.values(dem));
            for (let [v, cnt] of Object.entries(dem)) {
                diem[parseInt(v)] += (cnt / maxMarkov) * 1.8;
            }
            trongSo += 1.8;
        }
    }

    // 4. Dao động tài/xỉu (trọng số 1.2)
    if (lichSuTong.length >= 15) {
        const recent = lichSuTong.slice(0, 15);
        const tai = recent.filter(t => t > 10).length;
        const xiu = recent.filter(t => t <= 10).length;
        let uuTien = [];
        if (tai >= 10) uuTien = [14,15,16,17];
        else if (xiu >= 10) uuTien = [4,5,6,7];
        else if (tai > xiu + 2) uuTien = [12,13,14,16];
        else if (xiu > tai + 2) uuTien = [5,6,8,10];
        if (uuTien.length) {
            uuTien.forEach(v => diem[v] += 1.2);
            trongSo += 1.2;
        }
    }

    // 5. Khoảng cách (trọng số 1.0)
    if (khoangCach.length >= 10) {
        const avg = khoangCach.slice(0,20).reduce((a,b)=>a+b,0) / Math.min(20, khoangCach.length);
        const lastVi = lichSuVi[0];
        for (let i = 1; i <= 4; i++) {
            let v = lastVi + Math.round(avg * i);
            if (v > 17) v = 17 - (v - 17);
            if (v < 4) v = 4 + (4 - v);
            v = Math.min(17, Math.max(4, v));
            diem[v] += 1.0;
        }
        trongSo += 1.0;
    }

    if (trongSo === 0) {
        const loai = lichSuTong[0] > 10 ? 'Tài' : 'Xỉu';
        return { viList: loai === 'Tài' ? [11,12,13,17] : [4,5,6,10], loai, doTinCay: 50 };
    }

    let sorted = ALL_VI.map(v => ({ vi: v, diem: diem[v] })).sort((a,b) => b.diem - a.diem);
    let top4 = sorted.slice(0,4).map(item => item.vi);
    let sumTai = 0, sumXiu = 0;
    for (let i=0; i<Math.min(10, sorted.length); i++) {
        if (sorted[i].vi > 10) sumTai += sorted[i].diem;
        else sumXiu += sorted[i].diem;
    }
    let loai = sumTai > sumXiu ? 'Tài' : 'Xỉu';

    let finalVi = top4.filter(v => loai === 'Tài' ? v > 10 : v <= 10);
    const boSung = loai === 'Tài' ? VI_TAI : VI_XIU;
    for (let v of boSung) {
        if (!finalVi.includes(v)) finalVi.push(v);
        if (finalVi.length === 4) break;
    }
    if (loai === 'Tài' && !finalVi.includes(17)) finalVi[3] = 17;
    finalVi.sort((a,b)=>a-b);

    let doTinCay = Math.min(92, Math.round(50 + (top4.reduce((s,v)=>s+diem[v],0)/trongSo)*4));
    return { viList: finalVi, loai, doTinCay };
}

// ==================== FETCH DỮ LIỆU ====================
async function fetchSicbo(url, gameType) {
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': gameType === '789' ? 'https://demo7892.fun/' : 'https://api.wsktnus8.net/',
            'Origin': gameType === '789' ? 'https://demo7892.fun' : 'https://api.wsktnus8.net'
        };
        const res = await axios.get(url, { timeout: 10000, headers });
        if (res.data?.data?.resultList?.length) {
            const last = res.data.data.resultList[0];
            return {
                phien: parseInt(last.gameNum.replace('#', '')),
                tong: last.score,
                dices: last.facesList
            };
        }
        return null;
    } catch (e) {
        console.error(`${gameType} fetch error:`, e.message);
        return null;
    }
}

// ==================== XỬ LÝ REQUEST ====================
async function xuLyGame(game, apiUrl, gameType, gameKey) {
    const data = await fetchSicbo(apiUrl, gameType);
    if (!data) throw new Error(`Cannot fetch ${game} data`);

    const hist = history[gameKey];
    const lastPred = hist.data[0];
    if (lastPred && lastPred.phien_thuc_te === data.phien - 1) {
        capNhatThongKe(gameKey, data.tong, lastPred.viList);
        lastPred.thuc_te = data.tong;
        lastPred.dung_sai = lastPred.viList.includes(data.tong) ? '✅ Trúng' : '❌ Sai';
    }

    const cacheKey = data.phien;
    if (hist.cache.has(cacheKey)) {
        const cached = hist.cache.get(cacheKey);
        hist.data.unshift({
            phien_du_doan: data.phien + 1,
            viList: cached.viList,
            loai: cached.loai,
            do_tin_cay: cached.doTinCay,
            thoi_gian: new Date(),
            phien_thuc_te: data.phien,
            thuc_te: null,
            dung_sai: null
        });
        if (hist.data.length > 100) hist.data.pop();
        return {
            phien_hien_tai: data.phien,
            ket_qua_truoc: { tong: data.tong, bo: data.dices.join('-') },
            du_doan_4_vi: cached.viList,
            loai: cached.loai,
            do_tin_cay: cached.doTinCay + '%',
            thong_ke: hist.thongKeVi
        };
    }

    // Xây dựng lịch sử cho thuật toán
    let lichSuTong = [data.tong], lichSuVi = [], khoangCach = [];
    if (ALL_VI.includes(data.tong)) lichSuVi.push(data.tong);
    for (let item of hist.data) {
        if (item.thuc_te !== null) {
            lichSuTong.push(item.thuc_te);
            if (ALL_VI.includes(item.thuc_te)) {
                if (lichSuVi.length) khoangCach.push(Math.abs(item.thuc_te - lichSuVi[0]));
                lichSuVi.unshift(item.thuc_te);
            }
        }
    }

    const duDoan = duDoan4Vi(lichSuTong, lichSuVi, khoangCach);
    hist.cache.set(cacheKey, { viList: duDoan.viList, loai: duDoan.loai, doTinCay: duDoan.doTinCay });
    if (hist.cache.size > 20) hist.cache.delete(Math.min(...hist.cache.keys()));

    hist.data.unshift({
        phien_du_doan: data.phien + 1,
        viList: duDoan.viList,
        loai: duDoan.loai,
        do_tin_cay: duDoan.doTinCay,
        thoi_gian: new Date(),
        phien_thuc_te: data.phien,
        thuc_te: null,
        dung_sai: null
    });
    if (hist.data.length > 100) hist.data.pop();

    return {
        phien_hien_tai: data.phien,
        ket_qua_truoc: { tong: data.tong, bo: data.dices.join('-') },
        du_doan_4_vi: duDoan.viList,
        loai: duDoan.loai,
        do_tin_cay: duDoan.doTinCay + '%',
        thong_ke: hist.thongKeVi
    };
}

// ==================== API ENDPOINTS ====================
app.get('/sunwin-sicbo', async (req, res) => {
    try {
        const result = await xuLyGame('Sunwin', SUNWIN_API, 'sunwin', 'sunwin');
        res.json({ game: 'Sunwin Sicbo', ...result, id: '@tranhoang2286' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/club789-sicbo', async (req, res) => {
    try {
        const result = await xuLyGame('789Club', CLUB789_API, '789', 'club789');
        res.json({ game: '789Club Sicbo', ...result, id: '@tranhoang2286' });
    } catch (e) {
        res.status(503).json({ error: 'API 789Club hiện không khả dụng (có thể bị chặn). Thử lại sau.' });
    }
});

app.get('/lich-su', (req, res) => {
    res.json({
        sunwin: history.sunwin.data.slice(0,20).map(p => ({ phien_doan: p.phien_du_doan, vi_doan: p.viList, thuc_te: p.thuc_te, ket_qua: p.dung_sai })),
        club789: history.club789.data.slice(0,20).map(p => ({ phien_doan: p.phien_du_doan, vi_doan: p.viList, thuc_te: p.thuc_te, ket_qua: p.dung_sai }))
    });
});

app.get('/', (req, res) => {
    res.json({
        name: 'Sicbo VIP - Dự đoán 4 vị (Tài bắt buộc có 17, Xỉu ≤10)',
        endpoints: { 'Sunwin': '/sunwin-sicbo', '789Club': '/club789-sicbo', 'Lịch sử': '/lich-su' }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server chạy tại port ${PORT}`);
    console.log(`✓ /sunwin-sicbo\n✓ /club789-sicbo\n✓ Dự đoán cố định, không đổi khi F5`);
});
