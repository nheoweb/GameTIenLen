# Danh Sách Công Việc Chi Tiết (Task Breakdown)

---

## Phase 1: Core Engine & Room Logic (Nền tảng Luật bài & Phòng chờ)

### Task 1: Khởi tạo dự án, Bộ bài 52 lá và Luật Tiến Lên Miền Nam
**Description:** Thiết lập `package.json`, xây dựng module tạo/xáo bộ bài 52 lá (`src/game/deck.js`) và bộ máy kiểm tra luật Tiến Lên Miền Nam (`src/game/rules.js`) bao gồm nhận diện bộ bài (Lẻ, Đôi, Sám, Sảnh, 3 đôi thông, Tứ quý, 4 đôi thông) và luật đè bài / chặt Heo.

**Acceptance criteria:**
- [x] Mỗi lá bài có định danh, số (`rank`), chất (`suit`) và sức mạnh (`power` từ `3♠ = 0` đến `2♥ = 51`).
- [x] Phân loại chính xác tất cả các bộ bài hợp lệ và từ chối các bộ không hợp lệ (ví dụ: sảnh có chứa lá `2`, sảnh dưới 3 lá).
- [x] Xử lý chính xác luật chặt: 3 đôi thông chặt 1 Heo; Tứ quý chặt 1 Heo / Đôi Heo / 3 đôi thông; 4 đôi thông chặt 1 Heo / Đôi Heo / 3 đôi thông / Tứ quý.

**Verification:**
- [x] Tests pass: `node --test tests/rules.test.js`
- [x] Manual check: Kiểm tra kết quả phân loại và so sánh các trường hợp biên (Sảnh `3-4-5` vs `4-5-6`, Đôi `2♠ 2♣` bị chặt bởi Tứ quý `4`).

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `src/game/deck.js`
- `src/game/rules.js`
- `tests/rules.test.js`

**Estimated scope:** Medium (4 files)

---

### Task 2: Xây dựng Bộ Quản lý Phòng, Sảnh chờ, Cơ chế Sẵn sàng (Cách 1) & Reconnect
**Description:** Xây dựng `src/game/roomManager.js` quản lý vòng đời của các bàn chơi: tạo mã bàn 4 chữ số, cập nhật Sảnh chờ, xếp ghế (tối đa 4 ghế + khán giả), cơ chế bấm Sẵn sàng theo **Cách 1**, phát cờ báo động khi đủ 4/4 người, luồng đánh bài theo vòng và kết nối lại bằng `playerToken`.

**Acceptance criteria:**
- [x] Tạo phòng sinh mã 4 số duy nhất (VD: `1024`..`9999`), trả về danh sách phòng cho Sảnh chờ.
- [x] Khi người thứ 2 hoặc thứ 3 vào phòng: trả về sự kiện `joinAlertType = 'PLAYER_JOINED'`. Khi người thứ 4 vào phòng (đủ 4/4): trả về `joinAlertType = 'ROOM_FULL_4'` để kích hoạt chuông báo tập hợp.
- [x] **Đúng cơ chế Cách 1:**
  - Khi bàn có 2 hoặc 3 người: Chỉ khi 100% người chơi trong bàn đã `ready = true`, Chủ phòng mới được phép kích hoạt bắt đầu ván.
  - Khi bàn đủ 4/4 người: Khi cả 4/4 người đều `ready = true`, tự động trả về cờ `autoStartCountdown = true` để bắt đầu đếm ngược 3 giây chia bài.
- [x] Ván bài chạy đúng vòng đánh, bỏ lượt (pass), sang vòng mới khi 3 người bỏ lượt, xếp hạng Nhất - Nhì - Ba - Bét và ẩn bài đối thủ trong dữ liệu gửi về client.
- [x] Khi người chơi F5 và gửi lại `playerToken`, khôi phục đúng ghế và bài trên tay.

**Verification:**
- [x] Tests pass: `node --test tests/roomManager.test.js`
- [x] Manual check: Kiểm tra payload `getPublicStateForPlayer(roomId, playerToken)` đảm bảo không lộ mảng bài của người chơi khác.

**Dependencies:** Task 1

**Files likely touched:**
- `src/game/roomManager.js`
- `tests/roomManager.test.js`

**Estimated scope:** Small (2 files)

---

### Checkpoint 1: Sau Task 1 & Task 2
- [x] Toàn bộ Unit Tests cho Luật bài và Quản lý phòng (`npm test`) chạy xanh 100%.
- [x] Không có lỗi cú pháp hoặc rò rỉ dữ liệu bài của đối thủ.

---

## Phase 2: Real-time Server & Audio Engine (Kết nối Thời gian thực & Âm báo)

### Task 3: Xây dựng Server Express + Socket.IO Real-time
**Description:** Xây dựng `src/server.js` kết nối Express và Socket.IO với `roomManager`, xử lý các sự kiện thời gian thực: cập nhật Sảnh chờ (`lobby:list`), Tạo/Vào phòng (`room:create`, `room:join`), Bấm Sẵn sàng (`room:ready`), Chủ phòng bấm Chia bài (`room:start`), Đếm ngược 3 giây (`room:countdown`), Gõ bàn gọi bạn (`room:nudge`), và Đánh bài / Bỏ lượt (`game:play`, `game:pass`).

**Acceptance criteria:**
- [x] Khởi động server hiển thị rõ cả địa chỉ `http://localhost:3000` và địa chỉ IP LAN (`http://192.168.x.x:3000`) trên Terminal.
- [x] Mọi thay đổi ở phòng (tạo bàn, có người vào/ra, bắt đầu chơi) đều broadcast ngay lập tức ra Sảnh chờ.
- [x] Đếm ngược 3..2..1 phát sự kiện mỗi giây xuống toàn bộ người trong bàn và tự hủy nếu có người hủy Sẵn sàng hoặc rời bàn.
- [x] Sự kiện `room:nudge` (Gõ bàn) gửi âm báo nhắc nhở đến toàn phòng hoặc người chưa Sẵn sàng.

**Verification:**
- [x] Tests pass: `npm test`
- [x] Manual check: Khởi chạy `node src/server.js` và kiểm tra phản hồi Socket.IO.

**Dependencies:** Task 2

**Files likely touched:**
- `src/server.js`
- `tests/server.test.js`

**Estimated scope:** Small (2 files)

---

### Task 4: Xây dựng Hệ thống Âm thanh Đa tầng (Web Audio API) & Thông báo ngoài Tab
**Description:** Tạo `public/js/audio.js` sử dụng Web Audio API để tổng hợp hiệu ứng âm thanh không cần file rời, kết hợp Desktop Notification và hiệu ứng nhấp nháy tiêu đề Tab khi người chơi đang chuyển sang cửa sổ khác.

**Acceptance criteria:**
- [x] Có hàm `unlockAudio()` gắn vào thao tác click của người dùng để mở khóa `AudioContext`.
- [x] Có đầy đủ các âm thanh riêng biệt:
  - `playJoinSound()`: Tiếng *"Ting-tong"* nhẹ khi người thứ 2, 3 vào phòng.
  - `playRoomFullAlarm()`: **Âm báo Tập hợp (Chuông reng + Fanfare 2.5 giây)** vang rõ khi đủ 4/4 người vào phòng.
  - `playNudgeSound()`: Tiếng gõ bàn / còi hú khi đồng đội bấm nút *"🔔 Gõ bàn"*.
  - `playCountdownBeep(sec)`: Tiếng bíp đếm ngược `3.. 2.. 1..` và âm báo bắt đầu chia bài.
  - `playCardSound()`, `playChopPigSound()`, `playWinSound()`: Âm thanh đánh bài, chặt Heo và chiến thắng.
- [x] Hỗ trợ nút Bật/Tắt âm thanh (Mute/Unmute) + Nút "🔊 Nghe thử chuông báo" ngay trong phòng chờ.
- [x] Tự động đẩy `Notification` góc màn hình và nháy tiêu đề Tab (`🔔 [4/4 ĐỦ NGƯỜI!]`) khi `document.hidden === true`.

**Verification:**
- [x] Manual check: Gọi từng hàm âm thanh trên trình duyệt để kiểm tra độ rõ, âm lượng và thông báo tab.

**Dependencies:** None

**Files likely touched:**
- `public/js/audio.js`

**Estimated scope:** Small (1 file)

---

### Checkpoint 2: Sau Task 3 & Task 4
- [x] Server Socket.IO chạy ổn định và vượt qua toàn bộ bài test tích hợp.
- [x] Module âm thanh và thông báo hoạt động không lỗi trên trình duyệt.

---

## Phase 3: Frontend UI & End-to-End Verification (Giao diện & Kiểm thử Thực tế)

### Task 5: Xây dựng Giao diện Sảnh chờ, Phòng chờ 4 ghế & Bàn đánh bài Tiến Lên
**Description:** Xây dựng giao diện người dùng hoàn chỉnh tại `public/index.html`, `public/css/style.css` và `public/js/app.js` kết nối với Socket.IO và `audio.js`.

**Acceptance criteria:**
- [x] **Màn hình Sảnh chờ:** Nhập/đổi Nickname nhanh, nút Tạo Bàn Mới, ô nhập Mã phòng 4 số, và Danh sách các bàn đang mở theo thời gian thực (bấm 1 click vào bàn ngay).
- [x] **Hỗ trợ Link mời trực tiếp (`?room=XXXX`):** Mở link tự động đưa vào bàn (nếu chưa có Nickname thì hỏi Nickname rồi tự vào thẳng bàn đó). Có nút "📋 Copy Link Mời" tiện lợi.
- [x] **Phòng chờ & Cơ chế Cách 1:**
  - Hiển thị 4 ghế ngồi trực quan xung quanh bàn bài cùng trạng thái `Sẵn sàng ✅` hoặc `Đang chờ...`.
  - Hiển thị rõ nút **"Sẵn sàng / Hủy sẵn sàng"** cho người chơi, nút **"🔔 Gõ bàn gọi bạn"**, và nút **"🃏 Bắt đầu chia bài"** cho Chủ phòng (chỉ sáng lên khi có $\ge 2$ người và 100% đã Sẵn sàng).
  - Banner thông báo nổi bật + Đếm ngược `3.. 2.. 1` giữa bàn khi chuẩn bị chia bài.
- [x] **Bàn chơi Tiến Lên:**
  - Lá bài của bản thân xếp quạt dưới màn hình, tự động sắp xếp từ nhỏ đến lớn, click chọn nhiều lá để đánh, gợi ý/cảnh báo nếu bộ bài chọn chưa hợp lệ.
  - Khu vực giữa bàn hiển thị bộ bài vừa đánh trên bàn và hiệu ứng đặc biệt khi chặt Heo / Tứ quý / Đôi thông.
  - Bảng kết quả Nhất - Nhì - Ba - Bét cuối ván kèm nút bấm **"Sẵn sàng ván mới"**.

**Verification:**
- [x] Manual check: Kiểm tra giao diện trên cả kích thước Desktop và Mobile.

**Dependencies:** Task 3, Task 4

**Files likely touched:**
- `public/index.html`
- `public/css/style.css`
- `public/js/app.js`

**Estimated scope:** Medium (3 files)

---

### Task 6: Kiểm thử toàn diện đa cửa sổ (2–4 người chơi) & Nghiệm thu
**Description:** Chạy server thực tế và kiểm thử toàn bộ luồng từ Sảnh chờ -> Link mời -> Đủ 4 người nổ chuông báo -> Bấm Sẵn sàng chia bài -> Đánh hết ván -> F5 kết nối lại.

**Acceptance criteria:**
- [x] Mở 2–4 phiên người chơi độc lập: kiểm tra luồng 2 người chơi (Chủ phòng bấm Chia bài sau khi cả 2 Sẵn sàng) và luồng 4 người chơi (Vừa vào đủ 4 người phát âm báo tập hợp, cả 4 bấm Sẵn sàng tự động đếm ngược 3s chia bài).
- [x] Kiểm tra F5 trình duyệt giữa ván bài: người chơi tự quay lại đúng ghế và giữ nguyên bài trên tay.
- [x] Toàn bộ test tự động (`npm test`) đạt 100% pass.

**Verification:**
- [x] Tests pass: `npm test`
- [x] Runtime verification: Kiểm tra trực tiếp trên trình duyệt tại `http://localhost:3000`.

**Dependencies:** Task 5

**Files likely touched:**
- `tests/server.test.js` (bổ sung test case nếu phát hiện edge case)

**Estimated scope:** Small (1 file)

---

### Checkpoint 3: Hoàn tất & Bàn giao
- [x] Tất cả 8 tiêu chí hoàn thành (Success Criteria) trong [SPEC.md](file:///d:/DU_AN/Game%20Tien%20Len/SPEC.md) đều đạt.
- [x] Hướng dẫn cách chạy trong mạng LAN và cách chia sẻ link cho bạn bè chơi online.
