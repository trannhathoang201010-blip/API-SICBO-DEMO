const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Cấu hình API HitClub mới
// const API_HITCLUB_OLD = 'https://wtxmd52.tele68.com/v1/txmd5/sessions?cp=R&cl=R&pf=web&at=e2f4446802e76a39767a5bab32154970';
const API_HITCLUB_NEW = 'https://sun-win.onrender.com/api/history';

// Lưu trữ lịch sử và thống kê
let hitclubDB = {
    data: [],          // Lưu các phiên đã dự đoán
    cache: new Map(),   // Cache dự đoán theo phiên (F5 không đổi)
    thongKe: {          // Thống kê tổng thể
        tongSoPhien: 0,
        soLanDung: 0,
        soLanSai: 0,
        tiLeDung: '0%'
    }
};

// ==================== THUẬT TOÁN DỰ ĐOÁN (XÁC SUẤT THỰC TẾ, KHÔNG RANDOM) ====================
function duDoanXucXac(lichSuResult, lichSuDice) {
    // Nếu chưa có đủ dữ liệu, trả về mặc định an toàn
    if (lichSuResult.length < 10) {
        return {
            duDoan: 'TAI',
            dice: [4, 4, 4],
            tong: 12,
            doTinCay: 55,
            giaiThich: 'Chưa đủ dữ liệu, dự đoán mặc định TAI (4,4,4) với độ tin cậy 55%'
        };
    }
    
    // 1️⃣ Phân tích xu hướng từ kết quả Tài/Xỉu (trọng số 40%)
    let diemTaiXiu = { TAI: 0, XIU: 0 };
    let trongSo = 0;
    
    // 5 phiên gần nhất
    const last5 = lichSuResult.slice(0, 5);
    const taiCount5 = last5.filter(r => r === 'TAI').length;
    if (taiCount5 >= 4) diemTaiXiu.XIU += 40;
    else if (taiCount5 <= 1) diemTaiXiu.TAI += 40;
    else if (taiCount5 >= 3) diemTaiXiu.TAI += 25;
    else diemTaiXiu.XIU += 25;
    trongSo += 40;
    
    // 10 phiên gần nhất
    if (lichSuResult.length >= 10) {
        const last10 = lichSuResult.slice(0, 10);
        const taiCount10 = last10.filter(r => r === 'TAI').length;
        if (taiCount10 >= 7) diemTaiXiu.XIU += 30;
        else if (taiCount10 <= 3) diemTaiXiu.TAI += 30;
        trongSo += 30;
    }
    
    // 2️⃣ Phân tích chuỗi (Streak) - Phá cầu (trọng số 20%)
    let streak = 1;
    const lastResult = lichSuResult[0];
    for (let i = 1; i < lichSuResult.length; i++) {
        if (lichSuResult[i] === lastResult) streak++;
        else break;
    }
    if (streak >= 4) {
        if (lastResult === 'TAI') diemTaiXiu.XIU += 20;
        else diemTaiXiu.TAI += 20;
        trongSo += 20;
    } else if (streak === 3) {
        if (lastResult === 'TAI') diemTaiXiu.XIU += 15;
        else diemTaiXiu.TAI += 15;
        trongSo += 15;
    }
    
    // 3️⃣ Phân tích xu hướng từ dice (các mặt xúc xắc) - trọng số 25%
    if (lichSuDice.length >= 10) {
        const recentDice = lichSuDice.slice(0, 10);
        // Tính trung bình từng vị trí
        const sumPos = [0, 0, 0];
        for (let dice of recentDice) {
            for (let i = 0; i < 3; i++) {
                sumPos[i] += dice[i];
            }
        }
        const avgPos = sumPos.map(s => s / recentDice.length);
        // Dự đoán xu hướng tăng/giảm cho từng vị trí
        let tongDuDoan = 0;
        let diceDuDoan = [];
        for (let i = 0; i < 3; i++) {
            const recentVals = recentDice.map(d => d[i]);
            let trend = (recentVals[0] - recentVals[4]) / 4;
            let nextVal = Math.round(avgPos[i] + trend);
            nextVal = Math.min(6, Math.max(1, nextVal));
            diceDuDoan.push(nextVal);
            tongDuDoan += nextVal;
        }
        const loaiTuDice = tongDuDoan > 10 ? 'TAI' : 'XIU';
        if (loaiTuDice === 'TAI') diemTaiXiu.TAI += 25;
        else diemTaiXiu.XIU += 25;
        trongSo += 25;
    }
    
    // 4️⃣ Tổng hợp và quyết định
    const duDoanCuoi = diemTaiXiu.TAI > diemTaiXiu.XIU ? 'TAI' : 'XIU';
    let chenhLech = Math.abs(diemTaiXiu.TAI - diemTaiXiu.XIU);
    let tyLeTinCay = 50 + Math.min(30, chenhLech);
    tyLeTinCay = Math.min(80, Math.max(50, tyLeTinCay));
    
    // Tạo bộ dice dự đoán tương ứng
    let diceDuDoan = [];
    if (lichSuDice.length >= 10) {
        const recentDice = lichSuDice.slice(0, 10);
        const sumPos = [0, 0, 0];
        for (let dice of recentDice) {
            for (let i = 0; i < 3; i++) {
                sumPos[i] += dice[i];
            }
        }
        const avgPos = sumPos.map(s => s / recentDice.length);
        for (let i = 0; i < 3; i++) {
            const recentVals = recentDice.map(d => d[i]);
            let trend = (recentVals[0] - recentVals[4]) / 4;
            let nextVal = Math.round(avgPos[i] + trend);
            nextVal = Math.min(6, Math.max(1, nextVal));
            diceDuDoan.push(nextVal);
        }
    } else {
        diceDuDoan = duDoanCuoi === 'TAI' ? [4, 4, 4] : [3, 3, 3];
    }
    
    diceDuDoan.sort((a,b) => a - b);
    let tongDuDoan = diceDuDoan.reduce((a,b) => a + b, 0);
    
    return {
        duDoan: duDoanCuoi,
        dice: diceDuDoan,
        tong: tongDuDoan,
        doTinCay: tyLeTinCay,
        giaiThich: `Thuật toán tổng hợp từ phân tích xu hướng (Tài/Xỉu: ${diemTaiXiu.TAI}/${diemTaiXiu.XIU})`
    };
}

// Hàm cập nhật thống kê khi có kết quả thực tế
function capNhatThongKe(duDoan, thucTe) {
    hitclubDB.thongKe.tongSoPhien++;
    const dung = (duDoan === thucTe);
    if (dung) hitclubDB.thongKe.soLanDung++;
    else hitclubDB.thongKe.soLanSai++;
    hitclubDB.thongKe.tiLeDung = (hitclubDB.thongKe.soLanDung / hitclubDB.thongKe.tongSoPhien * 100).toFixed(1) + '%';
    return dung;
}

// Hàm fetch dữ liệu từ API HitClub mới
async function fetchHitClub() {
    try {
        const res = await axios.get(API_HITCLUB_NEW, { timeout: 10000 });
        // Kiểm tra cấu trúc dữ liệu trả về từ API mới
        if (res.data && res.data.taixiu && res.data.taixiu.length > 0) {
            // API mới trả về một mảng các phiên gần nhất, phiên đầu tiên là mới nhất
            const history = res.data.taixiu.slice(0, 200);
            // Chuẩn hóa dữ liệu từ API mới sang định dạng mà thuật toán đang dùng
            const normalizedHistory = history.map(item => ({
                phien: item.Phien,
                resultTruyenThong: item.Ket_qua === 'Tài' ? 'TAI' : 'XIU',  // Chuyển "Tài" -> "TAI"
                dices: [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3],
                point: item.Tong
            }));
            
            // Lấy phiên mới nhất
            const current = normalizedHistory[0];
            
            return { current, history: normalizedHistory };
        }
        return null;
    } catch (error) {
        console.error('Lỗi fetch HitClub API:', error.message);
        return null;
    }
}

// Endpoint chính
app.get('/hitclub', async (req, res) => {
    try {
        const result = await fetchHitClub();
        if (!result) {
            return res.status(503).json({ error: 'Không thể lấy dữ liệu từ HitClub, vui lòng thử lại sau' });
        }
        
        const { current, history } = result;
        
        // Cập nhật dự đoán trước đó (nếu có)
        const lastPred = hitclubDB.data[0];
        if (lastPred && lastPred.phien_thuc_te === current.phien - 1) {
            const dung = capNhatThongKe(lastPred.duDoan, current.resultTruyenThong);
            lastPred.thuc_te = current.resultTruyenThong;
            lastPred.dice_thuc_te = current.dices;
            lastPred.ket_qua = dung ? 'ĐÚNG' : 'SAI';
        }
        
        // Kiểm tra cache theo phiên (để F5 không đổi kết quả)
        const phienHienTai = current.phien;
        if (hitclubDB.cache.has(phienHienTai)) {
            const cached = hitclubDB.cache.get(phienHienTai);
            // Ghi lại dự đoán từ cache
            const newPred = {
                phien_du_doan: phienHienTai + 1,
                duDoan: cached.duDoan,
                dice_du_doan: cached.dice,
                tong_du_doan: cached.tong,
                do_tin_cay: cached.doTinCay,
                phien_thuc_te: phienHienTai,
                thuc_te: null,
                dice_thuc_te: null,
                ket_qua: null,
                thoi_gian: new Date()
            };
            hitclubDB.data.unshift(newPred);
            if (hitclubDB.data.length > 100) hitclubDB.data.pop();
            
            return res.json({
                success: true,
                game: 'HITCLUB TÀI XỈU (HŨ)',
                phien_hien_tai: phienHienTai,
                ket_qua_truoc: {
                    phien: current.phien,
                    ket_qua: current.resultTruyenThong,
                    dice: current.dices,
                    tong: current.point
                },
                du_doan_phien_tiep: {
                    phien: phienHienTai + 1,
                    du_doan: cached.duDoan,
                    dice_du_doan: cached.dice,
                    tong_du_doan: cached.tong,
                    do_tin_cay: cached.doTinCay + '%'
                },
                thong_ke_tong_hop: hitclubDB.thongKe,
                thoi_gian_du_doan: new Date(),
                author: '@tranhoang2286'
            });
        }
        
        // Xây dựng lịch sử kết quả từ API
        const lichSuResult = history.map(item => item.resultTruyenThong);
        const lichSuDice = history.map(item => item.dices);
        
        // Dự đoán cho phiên tiếp theo
        const duDoan = duDoanXucXac(lichSuResult, lichSuDice);
        
        // Lưu cache theo phiên hiện tại
        hitclubDB.cache.set(phienHienTai, {
            duDoan: duDoan.duDoan,
            dice: duDoan.dice,
            tong: duDoan.tong,
            doTinCay: duDoan.doTinCay
        });
        if (hitclubDB.cache.size > 20) {
            const firstKey = hitclubDB.cache.keys().next().value;
            hitclubDB.cache.delete(firstKey);
        }
        
        // Lưu dự đoán vào lịch sử
        const newPred = {
            phien_du_doan: phienHienTai + 1,
            duDoan: duDoan.duDoan,
            dice_du_doan: duDoan.dice,
            tong_du_doan: duDoan.tong,
            do_tin_cay: duDoan.doTinCay,
            phien_thuc_te: phienHienTai,
            thuc_te: null,
            dice_thuc_te: null,
            ket_qua: null,
            thoi_gian: new Date()
        };
        hitclubDB.data.unshift(newPred);
        if (hitclubDB.data.length > 100) hitclubDB.data.pop();
        
        // Trả về kết quả
        res.json({
            success: true,
            game: 'HITCLUB TÀI XỈU (HŨ)',
            phien_hien_tai: phienHienTai,
            ket_qua_truoc: {
                phien: current.phien,
                ket_qua: current.resultTruyenThong,
                dice: current.dices,
                tong: current.point
            },
            du_doan_phien_tiep: {
                phien: phienHienTai + 1,
                du_doan: duDoan.duDoan,
                dice_du_doan: duDoan.dice,
                tong_du_doan: duDoan.tong,
                do_tin_cay: duDoan.doTinCay + '%',
                giai_thich: duDoan.giaiThich
            },
            thong_ke_tong_hop: hitclubDB.thongKe,
            thoi_gian_du_doan: new Date(),
            author: '@tranhoang2286'
        });
        
    } catch (error) {
        console.error('Lỗi xử lý request:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau' });
    }
});

// Endpoint xem lịch sử dự đoán
app.get('/hitclub/lich-su', (req, res) => {
    res.json({
        success: true,
        lich_su_du_doan: hitclubDB.data.slice(0, 30).map(item => ({
            phien_du_doan: item.phien_du_doan,
            du_doan: item.duDoan,
            dice_du_doan: item.dice_du_doan,
            thuc_te: item.thuc_te,
            dice_thuc_te: item.dice_thuc_te,
            ket_qua: item.ket_qua,
            thoi_gian: item.thoi_gian
        })),
        thong_ke_tong_hop: hitclubDB.thongKe
    });
});

app.get('/', (req, res) => {
    res.json({
        name: 'API HITCLUB TÀI XỈU - DỰ ĐOÁN XÚC XẮC',
        author: '@tranhoang2286',
        version: '3.0',
        endpoints: {
            'Dự đoán phiên tiếp theo': '/hitclub',
            'Xem lịch sử dự đoán': '/hitclub/lich-su'
        },
        giai_thich: 'Thuật toán sử dụng phân tích xác suất thực tế từ lịch sử kết quả, không có random. Độ tin cậy 50-80% dựa trên mức độ đồng thuận của các thuật toán.'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 HITCLUB TÀI XỈU API`);
    console.log(`📡 PORT: ${PORT}`);
    console.log(`🎯 Endpoint: http://localhost:${PORT}/hitclub`);
    console.log(`📊 Thuật toán: Xác suất thực tế, không random`);
    console.log(`👤 Author: @tranhoang2286`);
});
