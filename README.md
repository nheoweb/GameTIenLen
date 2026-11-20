# 🃏 Tiến Lên Miền Nam Online Nội Bộ (2–4 Người Chơi)

Web Game Tiến Lên Miền Nam thời gian thực (Node.js + Express + Socket.IO) dành cho nhóm 2 đến 4 người chơi nội bộ qua mạng LAN hoặc Internet.

## Tính năng nổi bật
- **Sảnh chờ nội bộ trực tiếp (Live Lobby):** Xem danh sách bàn đang mở theo thời gian thực, 1 click vào ngồi.
- **Mã phòng 4 số & Link mời trực tiếp (`?room=XXXX`):** Copy link gửi qua Zalo/Slack/Teams, bạn bè bấm vào là vào thẳng bàn.
- **Tự giữ chỗ chống F5:** Tự lưu phiên người chơi (`sessionStorage`), tải lại trang vẫn giữ đúng ghế và bài trên tay.
- **Cơ chế Sẵn sàng & Chia bài (Cách 1):**
  - Bàn **2–3 người:** Khi 100% người chơi trong bàn bấm **Sẵn sàng ✅**, Chủ phòng mở khóa nút **🃏 Bắt đầu chia bài**.
  - Bàn **đủ 4/4 người:** Ngay khi người thứ 4 vào bàn sẽ nổ **Âm báo Tập hợp (Web Audio API)** + Thông báo góc màn hình + Nháy tiêu đề Tab. Khi cả 4 người bấm **Sẵn sàng ✅**, hệ thống tự động đếm ngược 3..2..1 và chia bài.
- **Nút 🔔 Gõ bàn gọi bạn:** Phát âm thanh gõ bàn & chuông nhắc đồng đội đang ẩn tab.
- **Luật Tiến Lên Miền Nam chuẩn:** Xác thực phía Server (ẩn bài đối thủ chống gian lận), hỗ trợ chặt Heo / Đôi Heo / Hàng bằng 3 đôi thông, Tứ quý, 4 đôi thông.

## Chạy ở máy cá nhân / Mạng LAN
```bash
npm install
npm start
```
Mở `http://localhost:3000` (hoặc địa chỉ LAN hiển thị trên Terminal cho các máy cùng Wi-Fi).

## Chạy kiểm thử tự động
```bash
npm test
```

## Deploy miễn phí lên Render.com
1. Đăng nhập [Render.com](https://render.com) bằng GitHub.
2. Chọn **New +** → **Web Service** → Chọn repository này.
3. Build Command: `npm install`, Start Command: `npm start`, Plan: **Free** → **Create Web Service**.
