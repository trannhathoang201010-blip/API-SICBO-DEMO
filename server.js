const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH CHUNG ====================
const ALL_VI = [4,5,6,7,8,9,10,11,12,13,14,15,16,17];
const VI_TAI = ALL_VI.filter(v => v > 10);
const VI_XIU = ALL_VI.filter(v => v <= 10);

// API nguồn
const API_SUNWIN_SICBO = 'https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=200&tableId=39791215743193&curPage=1';
const API_789_SICBO = 'https://demo7892.fun/history/getLastResult?gameId=ktrng_3986&size=100&tableId=398625062021&curPage=1';

// ==================== LỊCH SỬ & THỐNG KÊ ====================
let history = {
    sunwin: { data: [], thongKeVi: {} },
    club789: { data: [], thongKeVi: {} }
};

// Khởi tạo thống kê cho từng vị
ALL_VI.forEach(v => {
    history.sunwin.thongKeVi[v] = { tong: 0, dung: 0, tiLe: '0%' };
    history.club789.thongKeVi[v] = { tong: 0, dung: 0, tiLe: '0%' };
});

// Cập nhật thống kê khi có kết quả thực tế
function capNhatThongKe(tenGame, viThucTe, cacViDuDoan) {
    const thongKe = history[tenGame].thongKeVi;
    for (let vi of cacViDuDoan) {
        thongKe[vi].tong++;
        if (vi === viThucTe) thongKe[vi].dung++;
        thongKe[vi].tiLe = (thongKe[vi].dung / thongKe[vi].tong * 100).toFixed(1) + '%';
    }
}

// ==================== THUẬT TOÁN DỰ ĐOÁN 4 VỊ VIP ====================
class ViPredictorVIP {
    constructor() {
        this.lichSuTong = [];
        this.lichSuVi = [];
        this.khoangCach = [];
    }

    themPhien(tong) {
        this.lichSuTong.unshift(tong);
        if (this.lichSuTong.length > 300) this.lichSuTong.pop();
        if (ALL_VI.includes(tong)) {
            if (this.lichSuVi.length > 0) {
                this.khoangCach.unshift(Math.abs(tong - this.lichSuVi[0]));
                if (this.khoangCach.length > 200) this.khoangCach.pop();
            }
            this.lichSuVi.unshift(tong);
            if (this.lichSuVi.length > 200) this.lichSuVi.pop();
        }
    }

    // 1. Tần suất xuất hiện
    tinhTanSuat() {
        if (this.lichSuVi.length < 30) return null;
        const dem = {};
        ALL_VI.forEach(v => dem[v] = 0);
        const recent = this.lichSuVi.slice(0, 100);
        for (let v of recent) dem[v]++;
        const sorted = ALL_VI.map(v => ({ vi: v, count: dem[v] })).sort((a,b) => b.count - a.count);
        const top4 = sorted.slice(0,4).map(item => item.vi);
        const diem = top4.reduce((s, v) => s + dem[v], 0);
        return { viList: top4, doTinCay: 50 + Math.min(30, diem) };
    }

    // 2. Xu hướng trung bình trượt
    tinhXuHuong() {
        if (this.lichSuTong.length < 20) return null;
        const ganDay = this.lichSuTong.slice(0, 10);
        const truoc = this.lichSuTong.slice(10, 20);
        const avgGan = ganDay.reduce((a,b)=>a+b,0)/10;
        const avgTruoc = truoc.reduce((a,b)=>a+b,0)/10;
        let delta = avgGan - avgTruoc;
        let duDoanTong = Math.round(avgGan + delta * 0.6);
        duDoanTong = Math.min(17, Math.max(4, duDoanTong));
        let cacVi = [];
        for (let i = -1; i <= 2; i++) {
            let v = duDoanTong + i;
            if (v >= 4 && v <= 17) cacVi.push(v);
        }
        while (cacVi.length < 4) {
            let v = duDoanTong + (cacVi.length - 2);
            if (v >= 4 && v <= 17 && !cacVi.includes(v)) cacVi.push(v);
        }
        cacVi = cacVi.slice(0,4);
        return { viList: cacVi, doTinCay: 55 + Math.min(25, Math.abs(delta)*2) };
    }

    // 3. Markov bậc 2
    tinhMarkov() {
        if (this.lichSuVi.length < 10) return null;
        const map = new Map();
        for (let i=0; i<this.lichSuVi.length-2; i++) {
            const key = `${this.lichSuVi[i]}_${this.lichSuVi[i+1]}`;
            const next = this.lichSuVi[i+2];
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(next);
        }
        const lastKey = `${this.lichSuVi[0]}_${this.lichSuVi[1]}`;
        const nextList = map.get(lastKey);
        if (!nextList || nextList.length === 0) return null;
        const dem = {};
        for (let v of nextList) dem[v] = (dem[v]||0) + 1;
        const sorted = Object.entries(dem).map(([vi, count]) => ({ vi: parseInt(vi), count })).sort((a,b) => b.count - a.count);
        const top4 = sorted.slice(0,4).map(item => item.vi);
        while (top4.length < 4) top4.push(ALL_VI[Math.floor(Math.random() * ALL_VI.length)]);
        return { viList: top4, doTinCay: 60 + Math.min(25, nextList.length) };
    }

    // 4. Dao động tài/xỉu
    tinhDaoDong() {
        if (this.lichSuTong.length < 15) return null;
        const recent = this.lichSuTong.slice(0, 15);
        const soTai = recent.filter(t => t > 10).length;
        const soXiu = recent.filter(t => t <= 10).length;
        let duDoanVi = [];
        if (soTai >= 10) duDoanVi = [14,15,16,17];
        else if (soXiu >= 10) duDoanVi = [4,5,6,7];
        else if (soTai > soXiu + 3) duDoanVi = [12,13,14,16];
        else if (soXiu > soTai + 3) duDoanVi = [5,6,8,10];
        else return null;
        return { viList: duDoanVi, doTinCay: 60 + Math.abs(soTai - soXiu) };
    }

    // 5. Phân phối khoảng cách
    tinhChuoiPhanPhoi() {
        if (this.khoangCach.length < 20) return null;
        const avgKhoang = this.khoangCach.slice(0,30).reduce((a,b)=>a+b,0) / Math.min(30, this.khoangCach.length);
        const lastVi = this.lichSuVi[0];
        let duDoanVi = [];
        for (let i = 1; i <= 4; i++) {
            let v = lastVi + Math.round(avgKhoang * i);
            if (v > 17) v = 17 - (v - 17);
            if (v < 4) v = 4 + (4 - v);
            v = Math.min(17, Math.max(4, v));
            if (!duDoanVi.includes(v)) duDoanVi.push(v);
        }
        while (duDoanVi.length < 4) {
            let v = Math.floor(Math.random() * 14) + 4;
            if (!duDoanVi.includes(v)) duDoanVi.push(v);
        }
        return { viList: duDoanVi, doTinCay: 55 + Math.min(20, avgKhoang) };
    }

    // Xác định xu hướng tài/xỉu tổng thể từ điểm số của top candidates
    xacDinhXuHuong(viList, diemMap) {
        let tongTai = 0, tongXiu = 0;
        for (let vi of viList) {
            if (vi > 10) tongTai += diemMap[vi];
            else tongXiu += diemMap[vi];
        }
        return tongTai > tongXiu ? 'Tài' : 'Xỉu';
    }

    // Lọc danh sách vị theo xu hướng (Tài: >10 và có 17; Xỉu: ≤10)
    locViTheoXuHuong(viListTho, xuHuong) {
        let filtered = viListTho.filter(v => xuHuong === 'Tài' ? v > 10 : v <= 10);
        if (filtered.length < 4) {
            const boSung = xuHuong === 'Tài' ? VI_TAI : VI_XIU;
            for (let v of boSung) {
                if (!filtered.includes(v)) filtered.push(v);
                if (filtered.length === 4) break;
            }
        }
        if (xuHuong === 'Tài' && !filtered.includes(17)) {
            filtered[3] = 17; // thay thế vị cuối bằng 17
        }
        filtered.sort((a,b) => a-b);
        return filtered;
    }

    // Dự đoán 4 vị chính
    duDoan4Vi() {
        let cacPhuongPhap = [
            this.tinhTanSuat(),
            this.tinhXuHuong(),
            this.tinhMarkov(),
            this.tinhDaoDong(),
            this.tinhChuoiPhanPhoi()
        ].filter(p => p !== null);

        if (cacPhuongPhap.length === 0) {
            const macDinh = [11,12,13,14];
            const loai = this.lichSuTong.length > 0 && this.lichSuTong[0] > 10 ? 'Tài' : 'Xỉu';
            const finalVi = this.locViTheoXuHuong(macDinh, loai);
            return { viList: finalVi, loai, doTinCay: 55 };
        }

        let diem = {};
        ALL_VI.forEach(v => diem[v] = 0);
        let tongTrongSo = 0;
        for (let phuongPhap of cacPhuongPhap) {
            const w = phuongPhap.doTinCay / 10;
            for (let vi of phuongPhap.viList) diem[vi] += w;
            tongTrongSo += w;
        }

        let xepHang = ALL_VI.map(v => ({ vi: v, diem: diem[v] })).sort((a,b) => b.diem - a.diem);
        let top4 = xepHang.slice(0,4).map(item => item.vi);
        let loai = this.xacDinhXuHuong(top4, diem);
        let finalVi = this.locViTheoXuHuong(top4, loai);
        let doTinCay = Math.min(92, 50 + (top4.reduce((s, v) => s + diem[v], 0) / tongTrongSo) * 8);
        return { viList: finalVi, loai, doTinCay: Math.round(doTinCay) };
    }
}

// Khởi tạo 2 predictor riêng cho từng game
const sunwinPredictor = new ViPredictorVIP();
const club789Predictor = new ViPredictorVIP();

// ==================== FETCH DỮ LIỆU ====================
async function fetchSicbo(url, gameName) {
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': gameName === '789' ? 'https://demo7892.fun/' : 'https://api.wsktnus8.net/'
        };
        const res = await axios.get(url, { timeout: 10000, headers });
        if (res.data?.data?.resultList?.length) {
            const last = res.data.data.resultList[0];
            const tong = last.score;
            return {
                phien: parseInt(last.gameNum.replace('#', '')),
                tong: tong,
                dices: last.facesList
            };
        }
        return null;
    } catch (e) {
        console.error(`Fetch ${gameName} Sicbo lỗi:`, e.message);
        return null;
    }
}

// ==================== API ====================
// Sunwin Sicbo
app.get('/sunwin-sicbo', async (req, res) => {
    try {
        const data = await fetchSicbo(API_SUNWIN_SICBO, 'sunwin');
        if (!data) return res.status(503).json({ error: 'Không thể fetch Sunwin Sicbo' });

        // Cập nhật lịch sử cho predictor
        sunwinPredictor.themPhien(data.tong);

        // Cập nhật kết quả cho dự đoán trước
        const lastPred = history.sunwin.data[0];
        if (lastPred && lastPred.phien_thuc_te === data.phien - 1) {
            capNhatThongKe('sunwin', data.tong, lastPred.du_doan_4vi);
            lastPred.thuc_te_vi = data.tong;
            lastPred.dung_sai = lastPred.du_doan_4vi.includes(data.tong) ? 'Trúng 1 vị' : 'Sai';
        }

        // Dự đoán 4 vị mới
        const duDoan = sunwinPredictor.duDoan4Vi();
        const newPred = {
            phien_du_doan: data.phien + 1,
            du_doan_4vi: duDoan.viList,
            loai: duDoan.loai,
            do_tin_cay: duDoan.doTinCay,
            thoi_gian: new Date(),
            phien_thuc_te: data.phien,
            thuc_te_vi: null,
            dung_sai: null
        };
        history.sunwin.data.unshift(newPred);
        if (history.sunwin.data.length > 100) history.sunwin.data.pop();

        // Lấy thống kê tỉ lệ thắng từng vị
        const thongKe = history.sunwin.thongKeVi;
        res.json({
            game: 'Sunwin Sicbo',
            phien_hien_tai: data.phien,
            ket_qua_truoc: { tong: data.tong, bo_xuc_xac: data.dices.join('-') },
            du_doan_4_vi: duDoan.viList,
            loai: duDoan.loai,
            do_tin_cay: duDoan.doTinCay + '%',
            thong_ke_ti_le_thang: thongKe,
            id: '@tranhoang2286'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 789Club Sicbo
app.get('/club789-sicbo', async (req, res) => {
    try {
        const data = await fetchSicbo(API_789_SICBO, '789');
        if (!data) return res.status(503).json({ error: 'Không thể fetch 789Club Sicbo, có thể bị chặn. Thử lại sau.' });

        club789Predictor.themPhien(data.tong);

        const lastPred = history.club789.data[0];
        if (lastPred && lastPred.phien_thuc_te === data.phien - 1) {
            capNhatThongKe('club789', data.tong, lastPred.du_doan_4vi);
            lastPred.thuc_te_vi = data.tong;
            lastPred.dung_sai = lastPred.du_doan_4vi.includes(data.tong) ? 'Trúng 1 vị' : 'Sai';
        }

        const duDoan = club789Predictor.duDoan4Vi();
        const newPred = {
            phien_du_doan: data.phien + 1,
            du_doan_4vi: duDoan.viList,
            loai: duDoan.loai,
            do_tin_cay: duDoan.doTinCay,
            thoi_gian: new Date(),
            phien_thuc_te: data.phien,
            thuc_te_vi: null,
            dung_sai: null
        };
        history.club789.data.unshift(newPred);
        if (history.club789.data.length > 100) history.club789.data.pop();

        const thongKe = history.club789.thongKeVi;
        res.json({
            game: '789Club Sicbo',
            phien_hien_tai: data.phien,
            ket_qua_truoc: { tong: data.tong, bo_xuc_xac: data.dices.join('-') },
            du_doan_4_vi: duDoan.viList,
            loai: duDoan.loai,
            do_tin_cay: duDoan.doTinCay + '%',
            thong_ke_ti_le_thang: thongKe,
            id: '@tranhoang2286',
            note: 'Nếu fetch lỗi, API 789Club có thể yêu cầu headers đặc biệt. Hãy thử chạy lại sau.'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Lịch sử dự đoán
app.get('/lich-su', (req, res) => {
    res.json({
        sunwin: history.sunwin.data.slice(0, 20).map(p => ({
            phien_du_doan: p.phien_du_doan,
            du_doan_4vi: p.du_doan_4vi,
            loai: p.loai,
            thuc_te: p.thuc_te_vi,
            ket_qua: p.dung_sai
        })),
        club789: history.club789.data.slice(0, 20).map(p => ({
            phien_du_doan: p.phien_du_doan,
            du_doan_4vi: p.du_doan_4vi,
            loai: p.loai,
            thuc_te: p.thuc_te_vi,
            ket_qua: p.dung_sai
        }))
    });
});

app.get('/', (req, res) => {
    res.json({
        name: 'API SICBO - Dự đoán 4 vị VIP',
        endpoints: {
            'Sunwin Sicbo': '/sunwin-sicbo',
            '789Club Sicbo': '/club789-sicbo',
            'Lịch sử': '/lich-su'
        }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎲 SICBO VIP SERVER chạy tại port ${PORT}`);
    console.log(`✓ Sunwin Sicbo: /sunwin-sicbo`);
    console.log(`✓ 789Club Sicbo: /club789-sicbo`);
    console.log(`📊 Tỉ lệ thắng thực tế theo từng vị`);
});