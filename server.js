const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH ====================
const ALL_VI = [4,5,6,7,8,9,10,11,12,13,14,15,16,17];
const VI_TAI = ALL_VI.filter(v => v > 10);
const VI_XIU = ALL_VI.filter(v => v <= 10);

// API nguồn duy nhất cho Sunwin (cả TX và Sicbo đều từ API này, vì API trả về đủ thông tin)
const SUNWIN_API = 'https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=200&tableId=39791215743193&curPage=1';

// Lưu trữ cho từng loại
let history = {
    tx: { data: [], cache: new Map() },      // cho Tài Xỉu (dự đoán xúc xắc)
    sicbo: { data: [], cache: new Map(), thongKeVi: {} }  // cho vị cược
};

// Khởi tạo thống kê vị
ALL_VI.forEach(v => { history.sicbo.thongKeVi[v] = { tong: 0, dung: 0, tiLe: '0%' }; });

// Cập nhật thống kê vị
function capNhatThongKeVi(viThucTe, cacViDuDoan) {
    for (let vi of cacViDuDoan) {
        let st = history.sicbo.thongKeVi[vi];
        st.tong++;
        if (vi === viThucTe) st.dung++;
        st.tiLe = (st.dung / st.tong * 100).toFixed(1) + '%';
    }
}

// ==================== HÀM FETCH ====================
async function fetchSunwinData() {
    try {
        const res = await axios.get(SUNWIN_API, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (res.data?.data?.resultList?.length) {
            const last = res.data.data.resultList[0];
            return {
                phien: parseInt(last.gameNum.replace('#', '')),
                tong: last.score,
                dices: last.facesList,      // [a,b,c]
                resultType: last.resultType
            };
        }
        return null;
    } catch (e) {
        console.error('Fetch Sunwin error:', e.message);
        return null;
    }
}

// ==================== THUẬT TOÁN DỰ ĐOÁN 3 MẶT XÚC XẮC (TÀI XỈU) ====================
function duDoanXucXac(lichSuTong, lichSuDice) {
    // Nếu chưa đủ dữ liệu, trả về mặc định 3-4-4
    if (lichSuTong.length < 10) return { dice: [3,4,4], tong: 11, doTinCay: 55, loai: 'Tài' };

    // Dùng phương pháp trung bình trượt cho từng vị trí
    let pos1 = [], pos2 = [], pos3 = [];
    for (let dice of lichSuDice) {
        if (dice && dice.length === 3) {
            pos1.push(dice[0]); pos2.push(dice[1]); pos3.push(dice[2]);
        }
    }
    if (pos1.length < 10) return { dice: [3,4,4], tong: 11, doTinCay: 55, loai: 'Tài' };

    const predictNext = (arr) => {
        const recent = arr.slice(0,5);
        const trend = (recent[0] - recent[4]) / 4;
        let next = recent[0] + trend;
        next = Math.min(6, Math.max(1, Math.round(next)));
        return next;
    };
    let d1 = predictNext(pos1), d2 = predictNext(pos2), d3 = predictNext(pos3);
    let dice = [d1, d2, d3].sort((a,b)=>a-b);
    let tong = dice.reduce((a,b)=>a+b,0);
    let loai = tong > 10 ? 'Tài' : 'Xỉu';
    let doTinCay = 60 + Math.min(20, (pos1.length + pos2.length + pos3.length)/3);
    return { dice, tong, doTinCay: Math.min(90, doTinCay), loai };
}

// ==================== THUẬT TOÁN DỰ ĐOÁN 4 VỊ (THEO XÁC SUẤT) ====================
function duDoan4Vi(lichSuTong, lichSuVi, khoangCach) {
    if (lichSuTong.length < 10) {
        const loai = lichSuTong[0] > 10 ? 'Tài' : 'Xỉu';
        const macDinh = loai === 'Tài' ? [11,12,13,17] : [4,5,6,10];
        return { viList: macDinh, loai, doTinCay: 55 };
    }

    let diem = {};
    ALL_VI.forEach(v => diem[v] = 0);
    let trongSo = 0;

    // 1. Tần suất (30%)
    if (lichSuVi.length >= 20) {
        const dem = {};
        ALL_VI.forEach(v => dem[v] = 0);
        lichSuVi.slice(0, 100).forEach(v => dem[v]++);
        const maxDem = Math.max(...ALL_VI.map(v => dem[v]));
        for (let v of ALL_VI) diem[v] += (dem[v] / maxDem) * 30;
        trongSo += 30;
    }

    // 2. Xu hướng tổng (25%)
    if (lichSuTong.length >= 20) {
        const gan = lichSuTong.slice(0,10), truoc = lichSuTong.slice(10,20);
        const avgGan = gan.reduce((a,b)=>a+b,0)/10;
        const avgTruoc = truoc.reduce((a,b)=>a+b,0)/10;
        let delta = avgGan - avgTruoc;
        let duDoanTong = Math.min(17, Math.max(4, Math.round(avgGan + delta)));
        for (let i = -2; i <= 2; i++) {
            let v = duDoanTong + i;
            if (v>=4 && v<=17) diem[v] += (1 - Math.abs(i)/3)*25;
        }
        trongSo += 25;
    }

    // 3. Markov bậc 1 (20%)
    if (lichSuVi.length >= 10) {
        const map = new Map();
        for (let i=0; i<lichSuVi.length-1; i++) {
            let key = lichSuVi[i];
            let next = lichSuVi[i+1];
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(next);
        }
        const last = lichSuVi[0];
        const nextList = map.get(last);
        if (nextList && nextList.length) {
            const dem = {};
            nextList.forEach(v => dem[v] = (dem[v]||0)+1);
            const maxM = Math.max(...Object.values(dem));
            for (let [v,cnt] of Object.entries(dem)) {
                diem[parseInt(v)] += (cnt/maxM)*20;
            }
            trongSo += 20;
        }
    }

    // 4. Dao động tài/xỉu (15%)
    if (lichSuTong.length >= 15) {
        const recent = lichSuTong.slice(0,15);
        const tai = recent.filter(t=>t>10).length;
        const xiu = recent.filter(t=>t<=10).length;
        let uuTien = [];
        if (tai >= 10) uuTien = [14,15,16,17];
        else if (xiu >= 10) uuTien = [4,5,6,7];
        else if (tai > xiu+2) uuTien = [12,13,14,16];
        else if (xiu > tai+2) uuTien = [5,6,8,10];
        if (uuTien.length) {
            uuTien.forEach(v => diem[v] += 15);
            trongSo += 15;
        }
    }

    // 5. Khoảng cách (10%)
    if (khoangCach.length >= 10) {
        const avg = khoangCach.slice(0,20).reduce((a,b)=>a+b,0) / Math.min(20, khoangCach.length);
        const lastVi = lichSuVi[0];
        for (let i=1; i<=4; i++) {
            let v = lastVi + Math.round(avg*i);
            if (v>17) v = 17 - (v-17);
            if (v<4) v = 4 + (4-v);
            v = Math.min(17, Math.max(4, v));
            diem[v] += 10;
        }
        trongSo += 10;
    }

    // Nếu không có phương pháp nào, dùng mặc định
    if (trongSo === 0) {
        const loai = lichSuTong[0] > 10 ? 'Tài' : 'Xỉu';
        return { viList: loai === 'Tài' ? [11,12,13,17] : [4,5,6,10], loai, doTinCay: 50 };
    }

    // Chọn 4 vị có điểm cao nhất
    let sorted = ALL_VI.map(v => ({ vi: v, diem: diem[v] })).sort((a,b) => b.diem - a.diem);
    let topCandidates = sorted.slice(0,8);
    let tongTai = topCandidates.filter(c=>c.vi>10).reduce((s,c)=>s+c.diem,0);
    let tongXiu = topCandidates.filter(c=>c.vi<=10).reduce((s,c)=>s+c.diem,0);
    let loai = tongTai > tongXiu ? 'Tài' : 'Xỉu';

    // Lấy top4 nhưng lọc theo loại
    let finalVi = [];
    for (let item of sorted) {
        if (loai === 'Tài' && item.vi > 10) finalVi.push(item.vi);
        else if (loai === 'Xỉu' && item.vi <= 10) finalVi.push(item.vi);
        if (finalVi.length === 4) break;
    }
    // Nếu chưa đủ 4, bổ sung
    const boSung = loai === 'Tài' ? VI_TAI : VI_XIU;
    for (let v of boSung) {
        if (!finalVi.includes(v)) finalVi.push(v);
        if (finalVi.length === 4) break;
    }
    // Nếu loại Tài, bắt buộc có 17
    if (loai === 'Tài' && !finalVi.includes(17)) finalVi[3] = 17;
    finalVi.sort((a,b)=>a-b);

    let doTinCay = Math.min(92, 40 + Math.round((topCandidates.reduce((s,c)=>s+c.diem,0)/trongSo)*12));
    return { viList: finalVi, loai, doTinCay };
}

// ==================== XỬ LÝ REQUEST DÙNG CHUNG ====================
async function xuLyYeuCau(loaiGame) {
    const data = await fetchSunwinData();
    if (!data) throw new Error('Không fetch được dữ liệu Sunwin');
    const phienHT = data.phien;

    // Lấy lịch sử phù hợp
    const hist = loaiGame === 'tx' ? history.tx : history.sicbo;
    const lastPred = hist.data[0];

    // Cập nhật kết quả cho dự đoán trước (nếu có dữ liệu thực tế)
    if (lastPred && lastPred.phien_thuc_te === phienHT - 1) {
        if (loaiGame === 'tx') {
            // Kiểm tra dự đoán xúc xắc
            const thucTeDice = data.dices;
            const dung = (lastPred.dice[0] === thucTeDice[0] && lastPred.dice[1] === thucTeDice[1] && lastPred.dice[2] === thucTeDice[2]);
            lastPred.thuc_te = thucTeDice;
            lastPred.dung_sai = dung ? 'Đúng' : 'Sai';
        } else {
            // Cập nhật thống kê vị
            capNhatThongKeVi(data.tong, lastPred.viList);
            lastPred.thuc_te_vi = data.tong;
            lastPred.dung_sai = lastPred.viList.includes(data.tong) ? 'Trúng 1 vị' : 'Sai';
        }
    }

    // Kiểm tra cache theo phiên (để F5 không đổi)
    const cacheKey = phienHT;
    if (hist.cache.has(cacheKey)) {
        const cached = hist.cache.get(cacheKey);
        // Ghi lại dự đoán mới (chỉ để lịch sử, nhưng nội dung từ cache)
        const newPred = {
            phien_du_doan: phienHT + 1,
            ...cached,
            thoi_gian: new Date(),
            phien_thuc_te: phienHT,
            thuc_te: null,
            dung_sai: null
        };
        if (loaiGame === 'tx') {
            newPred.dice = cached.dice;
            newPred.tong = cached.tong;
            newPred.loai = cached.loai;
        } else {
            newPred.viList = cached.viList;
            newPred.loai = cached.loai;
        }
        hist.data.unshift(newPred);
        if (hist.data.length > 100) hist.data.pop();
        // Trả về kết quả
        if (loaiGame === 'tx') {
            return { game: 'Sunwin Tài Xỉu', phien_hien_tai: phienHT, ket_qua_truoc: { tong: data.tong, xuc_xac: data.dices.join('-') }, du_doan_3mat: cached.dice, tong_du_doan: cached.tong, loai: cached.loai, do_tin_cay: cached.doTinCay+'%', id: '@tranhoang2286' };
        } else {
            return { game: 'Sunwin Sicbo', phien_hien_tai: phienHT, ket_qua_truoc: { tong: data.tong, xuc_xac: data.dices.join('-') }, du_doan_4_vi: cached.viList, loai: cached.loai, do_tin_cay: cached.doTinCay+'%', thong_ke_vi: history.sicbo.thongKeVi, id: '@tranhoang2286' };
        }
    }

    // Xây dựng lịch sử cho thuật toán
    let lichSuTong = [data.tong];
    let lichSuDice = [data.dices];
    let lichSuVi = [];
    let khoangCach = [];
    if (ALL_VI.includes(data.tong)) lichSuVi.push(data.tong);
    for (let item of hist.data) {
        if (loaiGame === 'tx' && item.thuc_te !== null) {
            lichSuTong.push(item.tong_du_doan); // hoặc lấy từ thực tế? Ở đây dùng tổng thực tế
            lichSuDice.push(item.thuc_te);
        } else if (loaiGame !== 'tx' && item.thuc_te_vi !== null) {
            lichSuTong.push(item.thuc_te_vi);
            if (ALL_VI.includes(item.thuc_te_vi)) {
                if (lichSuVi.length) khoangCach.push(Math.abs(item.thuc_te_vi - lichSuVi[0]));
                lichSuVi.unshift(item.thuc_te_vi);
            }
        }
    }
    // Giới hạn độ dài
    if (lichSuTong.length > 200) lichSuTong = lichSuTong.slice(0,200);
    if (lichSuDice.length > 200) lichSuDice = lichSuDice.slice(0,200);

    let duDoan;
    if (loaiGame === 'tx') {
        duDoan = duDoanXucXac(lichSuTong, lichSuDice);
        const cacheData = { dice: duDoan.dice, tong: duDoan.tong, loai: duDoan.loai, doTinCay: duDoan.doTinCay };
        hist.cache.set(cacheKey, cacheData);
        const newPred = {
            phien_du_doan: phienHT + 1,
            dice: duDoan.dice,
            tong_du_doan: duDoan.tong,
            loai: duDoan.loai,
            do_tin_cay: duDoan.doTinCay,
            thoi_gian: new Date(),
            phien_thuc_te: phienHT,
            thuc_te: null,
            dung_sai: null
        };
        hist.data.unshift(newPred);
        if (hist.data.length > 100) hist.data.pop();
        return { game: 'Sunwin Tài Xỉu', phien_hien_tai: phienHT, ket_qua_truoc: { tong: data.tong, xuc_xac: data.dices.join('-') }, du_doan_3mat: duDoan.dice, tong_du_doan: duDoan.tong, loai: duDoan.loai, do_tin_cay: duDoan.doTinCay+'%', id: '@tranhoang2286' };
    } else {
        duDoan = duDoan4Vi(lichSuTong, lichSuVi, khoangCach);
        const cacheData = { viList: duDoan.viList, loai: duDoan.loai, doTinCay: duDoan.doTinCay };
        hist.cache.set(cacheKey, cacheData);
        const newPred = {
            phien_du_doan: phienHT + 1,
            viList: duDoan.viList,
            loai: duDoan.loai,
            do_tin_cay: duDoan.doTinCay,
            thoi_gian: new Date(),
            phien_thuc_te: phienHT,
            thuc_te_vi: null,
            dung_sai: null
        };
        hist.data.unshift(newPred);
        if (hist.data.length > 100) hist.data.pop();
        return { game: 'Sunwin Sicbo', phien_hien_tai: phienHT, ket_qua_truoc: { tong: data.tong, xuc_xac: data.dices.join('-') }, du_doan_4_vi: duDoan.viList, loai: duDoan.loai, do_tin_cay: duDoan.doTinCay+'%', thong_ke_vi: history.sicbo.thongKeVi, id: '@tranhoang2286' };
    }
}

// ==================== ENDPOINTS ====================
app.get('/sunwin-tx', async (req, res) => {
    try {
        const result = await xuLyYeuCau('tx');
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/sunwin-sicbo', async (req, res) => {
    try {
        const result = await xuLyYeuCau('sicbo');
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/lich-su', (req, res) => {
    res.json({
        tai_xiu: history.tx.data.slice(0,20).map(p => ({
            phien_du_doan: p.phien_du_doan,
            du_doan_dice: p.dice,
            thuc_te: p.thuc_te,
            ket_qua: p.dung_sai
        })),
        sicbo: history.sicbo.data.slice(0,20).map(p => ({
            phien_du_doan: p.phien_du_doan,
            vi_doan: p.viList,
            thuc_te: p.thuc_te_vi,
            ket_qua: p.dung_sai
        }))
    });
});

app.get('/', (req, res) => {
    res.json({
        name: 'Sunwin Tài Xỉu & Sicbo - Dự đoán động',
        endpoints: {
            'Tài Xỉu (dự đoán 3 mặt xúc xắc)': '/sunwin-tx',
            'Sicbo (dự đoán 4 vị cược)': '/sunwin-sicbo',
            'Lịch sử': '/lich-su'
        },
        note: 'Mỗi phiên dự đoán chỉ tính một lần, F5 không đổi kết quả. Vị Sicbo: Tài >10 và có 17, Xỉu ≤10.'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server Sunwin đang chạy tại port ${PORT}`);
    console.log(`🎲 Tài Xỉu: /sunwin-tx → dự đoán 3 mặt xúc xắc`);
    console.log(`🎯 Sicbo: /sunwin-sicbo → dự đoán 4 vị cược (xác suất động)`);
});
