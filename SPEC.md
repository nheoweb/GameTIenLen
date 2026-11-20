# Spec: Tiến Lên Miền Nam Online Nội Bộ (2–4 Người Chơi)

## 1. Objective (Mục tiêu & Phạm vi)
Xây dựng Web Game **Tiến Lên Miền Nam Online Nội Bộ** dành cho nhóm từ **2 đến tối đa 4 người chơi** theo thời gian thực (Real-time Multiplayer), tối ưu cho trải nghiệm rủ nhau chơi nhanh trong văn phòng hoặc nhóm bạn mà không cần đăng ký tài khoản phức tạp.

### Tính năng cốt lõi:
1. **Định danh nhanh & Giữ chỗ (Zero-Friction Auth & Reconnect):**
   - Người chơi chỉ cần nhập **Nickname** (tự động lưu cùng `playerToken` vào `localStorage`).
   - Hỗ trợ tự động kết nối lại đúng ghế và bài trên tay nếu người chơi vô tình tải lại trang (F5) hoặc rớt mạng ngắn hạn.
2. **Sảnh Chờ Nội Bộ & Tham Gia Room (3 hình thức):**
   - **Sảnh chờ trực tiếp (Live Lobby):** Hiển thị danh sách tất cả các bàn đang mở theo thời gian thực (Mã bàn, Chủ bàn, Số người hiện tại `2/4`, Trạng thái `Đang chờ` / `Đang chơi`). Click 1 chạm để vào bàn.
   - **Mã phòng 4 chữ số:** Nhập mã 4 số (VD: `4821`) để vào nhanh.
   - **Link mời trực tiếp (`?room=4821`):** Nút "Copy Link Mời" để gửi qua Zalo/Slack/Teams; người nhận mở link sẽ tự động vào thẳng phòng.
   - **Chế độ Khán giả (Spectator):** Nếu bàn đang đánh dở ván mà có người thứ 3 hoặc thứ 4 mới vào, người đó sẽ xem bàn đấu và tự động được xếp vào ghế ở ván kế tiếp.
3. **Cơ chế "Sẵn Sàng" & Bắt Đầu Chia Bài (Theo Cách 1 đã chốt):**
   - Mỗi người chơi khi vào bàn có nút **"Sẵn sàng" (Ready ✅ / Hủy sẵn sàng)**.
   - **Khi phòng có 2 hoặc 3 người:** Nút **"🃏 Bắt đầu chia bài"** của Chủ phòng (Host) sẽ bật sáng khi **100% người chơi đang có mặt trong bàn đã bấm Sẵn sàng**. Chủ phòng có thể bấm chia bài ngay hoặc chờ thêm người thứ 3, thứ 4 vào.
   - **Khi phòng đủ 4/4 người:**
     - Ngay khoảnh khắc người thứ 4 vào bàn: Phát **Âm báo Tập hợp** + Thông báo màn hình để gọi tất cả quay lại tab.
     - Khi cả **4/4 người đều đã bấm Sẵn sàng**: Hệ thống **tự động đếm ngược 3... 2... 1** (kèm âm bíp) và chia bài ngay lập tức.
4. **Hệ thống Thông báo Âm thanh Đa tầng (Web Audio API & Browser Alerts):**
   - Mở khóa `AudioContext` ngay từ thao tác click *"Tạo bàn"* hoặc *"Vào bàn"* để vượt qua chính sách chặn Autoplay của trình duyệt.
   - **Âm thanh phân cấp:**
     - Người thứ 2, 3 vào phòng: Tiếng *"Ting-tong"* nhẹ.
     - Người thứ 4 vào phòng (Đủ 4/4): **Âm báo Tập hợp (Chuông reng + Fanfare 2.5s)** vang rõ ngay cả khi đang chuyển sang tab khác.
     - Nút **"🔔 Gõ bàn / Hú đồng đội"**: Phát âm thanh gõ bàn/còi gọi người chơi đang treo máy (AFK) chưa bấm Sẵn sàng hoặc quên đánh bài.
     - Đếm ngược chia bài (`3.. 2.. 1..`), tiếng chia bài, đánh bài, chặt Heo, và thắng ván.
   - **Thông báo ngoài tab:** Đẩy `Desktop Notification` góc màn hình máy tính và nhấp nháy tiêu đề Tab (`🔔 [4/4 ĐỦ NGƯỜI!]`) khi người chơi đang ẩn tab.
5. **Luật Tiến Lên Miền Nam Chuẩn:**
   - Bộ bài 52 lá. Thứ tự độ lớn số: `3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2 (Heo)`.
   - Thứ tự chất: `Bích (♠) < Chuồn/Tép (♣) < Rô (♦) < Cơ (♥)`.
   - Các bộ bài hợp lệ: Lá lẻ, Đôi, Sám cô (3 lá cùng số), Sảnh (từ 3 lá liên tiếp trở lên, không chứa lá 2), Ba đôi thông, Tứ quý, Bốn đôi thông.
   - Luật đi trước: Ván đầu tiên của phòng, ai có lá nhỏ nhất trên bàn (ưu tiên `3♠` nếu chia trúng) được đánh trước và phải đánh tổ hợp có chứa lá nhỏ nhất đó. Từ ván thứ 2 trở đi, người về Nhất ván trước được đi trước.
   - Luật chặt Heo / Đôi Heo / Hàng:
     - **3 đôi thông** chặt được 1 cây Heo (2) hoặc 3 đôi thông nhỏ hơn (cần trong vòng).
     - **Tứ quý** chặt được 1 cây Heo, Đôi Heo, 3 đôi thông, hoặc Tứ quý nhỏ hơn.
     - **4 đôi thông** chặt được 1 cây Heo, Đôi Heo, 3 đôi thông, Tứ quý, hoặc 4 đôi thông nhỏ hơn (không cần vòng).
   - Kết thúc ván & Xếp hạng: Xếp hạng Nhất - Nhì - Ba - Bét và bảng tổng kết điểm sau mỗi ván.

---

## 2. Tech Stack (Công nghệ sử dụng)
- **Runtime:** Node.js (v18+ / v20+, ES Modules).
- **Backend & Real-time:** `express` (v4.x) + `socket.io` (v4.x) — phục vụ cả Web UI và WebSocket trên cùng 1 cổng (Port 3000), cực kỳ thuận tiện để chạy mạng LAN nội bộ hoặc deploy 1-click lên Render/Railway.
- **Frontend:** HTML5, CSS3 (Responsive Tabletop UI), Vanilla ES6 Modules + **Web Audio API** (tự tổng hợp âm thanh sắc nét không phụ thuộc file âm thanh rời bên ngoài).
- **Testing:** Node.js Built-in Test Runner (`node --test`) + `socket.io-client` cho kiểm thử tích hợp.

---

## 3. Commands (Các lệnh thực thi)
```bash
# Cài đặt thư viện
npm install

# Chạy server chế độ phát triển (tự động reload khi sửa file)
npm run dev

# Chạy server chính thức (mặc định http://localhost:3000 và IP LAN)
npm start

# Chạy toàn bộ Unit Test & Integration Test
npm test
```

---

## 4. Project Structure (Cấu trúc thư mục)
```text
d:\DU_AN\Game Tien Len\
├── package.json
├── SPEC.md
├── tasks/
│   ├── plan.md              # Kế hoạch triển khai kỹ thuật
│   └── todo.md              # Danh sách task chi tiết
├── src/
│   ├── server.js            # Express + Socket.IO entrypoint, hiển thị IP LAN khi khởi động
│   └── game/
│       ├── deck.js          # Khởi tạo bộ bài 52 lá, xáo bài (Fisher-Yates), chia 13 lá/người
│       ├── rules.js         # Luật Tiến Lên Miền Nam (nhận diện bộ bài, so sánh, chặt Heo)
│       └── roomManager.js   # Quản lý Sảnh chờ, Mã phòng 4 số, Ghế ngồi, Sẵn sàng, Đếm ngược, Reconnect
├── public/
│   ├── index.html           # Giao diện Sảnh chờ & Bàn chơi Tiến Lên
│   ├── css/
│   │   └── style.css        # Thiết kế bàn bài trực quan, hiệu ứng lá bài, responsive
│   └── js/
│       ├── app.js           # Logic kết nối Socket.IO, xử lý URL ?room=XXXX, cập nhật UI
│       └── audio.js         # Bộ tổng hợp âm thanh Web Audio API + Desktop Notification + Tab Flasher
└── tests/
    ├── rules.test.js        # Unit test kiểm thử toàn bộ luật bài & chặt Heo
    └── roomManager.test.js  # Unit test luồng Tạo phòng, Sẵn sàng, Đếm ngược, Chơi 2-4 người, Reconnect
```

---

## 5. Code Style (Quy chuẩn mã nguồn)
Sử dụng ES Modules (`import`/`export`), hàm thuần khiết (pure functions) cho logic luật bài để dễ kiểm thử 100%, và tách biệt rõ trạng thái server với dữ liệu trả về cho từng người chơi (ẩn bài trên tay của đối thủ để chống gian lận).

```javascript
// Ví dụ quy chuẩn hàm kiểm tra bộ bài hợp lệ trong src/game/rules.js
export function classifyHand(cards) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return { valid: false, type: 'INVALID' };
  }
  const sorted = [...cards].sort((a, b) => a.power - b.power);
  if (sorted.length === 1) {
    return { valid: true, type: 'SINGLE', highCard: sorted[0], length: 1 };
  }
  // ...
}
```

---

## 6. Testing Strategy (Chiến lược kiểm thử)
- **Unit Tests (`tests/rules.test.js`):** Kiểm thử 100% các trường hợp nhận diện bài (Lẻ, Đôi, Sám, Sảnh, 3 đôi thông, Tứ quý, 4 đôi thông), cấm sảnh chứa Heo (`2`), và luật chặt Heo/Hàng.
- **Room & Gameplay Tests (`tests/roomManager.test.js`):**
  - Tạo phòng 4 số, danh sách Sảnh chờ.
  - Logic **Cách 1**: Phòng 2–3 người cần 100% Ready để Host bấm Chia bài; Phòng đủ 4/4 người kích hoạt cờ `roomFullAlert` và khi cả 4 Ready thì tự động kích hoạt đếm ngược chia bài.
  - Bảo mật trạng thái bài: Người chơi A không thể nhìn thấy mảng lá bài của Người chơi B qua payload mạng.
  - Kết nối lại (Reconnect) bằng `playerToken` khi đứt kết nối.

---

## 7. Boundaries (Ranh giới & Nguyên tắc)
- **Always do (Luôn thực hiện):**
  - Xác thực mọi nước đánh ở phía Server (`src/game/rules.js`), không tin tưởng dữ liệu từ Client.
  - Ẩn danh sách bài của đối thủ (chỉ gửi số lượng lá bài còn lại `cardCount` của đối thủ về Client).
  - Chạy `npm test` xanh 100% sau mỗi bước triển khai.
- **Ask first (Hỏi trước khi làm):**
  - Thay đổi cơ chế bắt đầu ván hoặc thêm cơ sở dữ liệu ngoài (SQLite/PostgreSQL).
- **Never do (Không bao giờ làm):**
  - Dùng thư viện âm thanh nặng hoặc file media ngoại tuyến dễ lỗi CORS.
  - Tự động chia bài khi có người đang ngồi trong phòng nhưng chưa bấm "Sẵn sàng".

---

## 8. Success Criteria (Tiêu chí hoàn thành)
1. Người chơi mở web, nhập Nickname, thấy ngay **Sảnh chờ nội bộ** cập nhật danh sách bàn theo thời gian thực.
2. Tạo bàn sinh **Mã phòng 4 số** và nút **Copy Link Mời (`?room=XXXX`)**; mở link trên tab/máy khác vào thẳng phòng.
3. Khi người thứ 4 vừa vào bàn (4/4): Phát **Âm báo Tập hợp** rõ ràng + Thông báo Desktop + Nháy tiêu đề Tab.
4. Có nút **🔔 Gõ bàn** phát âm thanh nhắc nhở những người trong phòng chưa bấm Sẵn sàng.
5. Khi có 2–3 người và tất cả đã bấm **Sẵn sàng**, Chủ phòng bấm được nút **"🃏 Bắt đầu chia bài"**. Khi có đủ 4/4 người và cả 4 đều bấm **Sẵn sàng**, hệ thống tự động đếm ngược 3 giây (có tiếng bíp) và chia bài.
6. Chơi trọn vẹn ván Tiến Lên Miền Nam từ 2 đến 4 người (đánh theo vòng, bỏ lượt, chặt Heo, xếp hạng Nhất - Nhì - Ba - Bét, chơi tiếp ván mới) và tự giữ ghế khi F5 trang.

---

## 9. Open Questions (Câu hỏi mở)
- Hiện không còn câu hỏi mở nào — toàn bộ cơ chế Room, Âm thanh báo đủ người và Luật bắt đầu ván (Cách 1) đã được thống nhất.
