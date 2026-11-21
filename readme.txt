=== Tiến Lên Miền Nam Nội Bộ ===
Contributors: gametienlen
Tags: card game, tien len, multiplayer, game
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.2.0
License: GPLv2 or later

Game bài Tiến Lên Miền Nam Online nội bộ (2–4 người chơi), chạy thuần PHP + MySQL + REST API ngay trên hosting WordPress.

== Description ==

Plugin game bài Tiến Lên Miền Nam dành cho nhóm bạn bè nội bộ (2–4 người), cài trực tiếp lên website WordPress (tối ưu cho shared hosting như Hostinger + LiteSpeed Cache) mà không cần server Node.js riêng.

Tính năng nổi bật:
* Sảnh chờ trực tiếp (Live Lobby), tạo bàn và nhận mã 4 chữ số + link mời `?room=XXXX`.
* Tự động tạo sẵn trang chơi toàn màn hình `/tien-len/` ngay khi kích hoạt plugin.
* Không cần tạo tài khoản WordPress — khách vào tự nhập tên chơi ngay (ai đã đăng nhập WP tự điền sẵn tên).
* Tự giữ ghế & bài khi lỡ bấm F5 tải lại trang.
* Cơ chế Sẵn sàng (Cách 1): 2–3 người sẵn sàng thì Chủ phòng bấm Chia bài; đủ 4/4 người sẵn sàng thì tự đếm ngược 3..2..1 và chia bài.
* Hệ thống âm thanh Web Audio API (chuông báo đủ 4/4 người, gõ bàn gọi đồng đội đang ẩn tab, chặt Heo/Hàng, chia bài, thắng ván).
* Luật Tiến Lên Miền Nam xác thực phía Server (PHP), giấu bài đối thủ chống gian lận.

== Installation ==

1. Trong WordPress Admin, vào **Plugins → Add New → Upload Plugin**.
2. Chọn file `tien-len-mien-nam.zip`, bấm **Install Now** rồi bấm **Activate**.
3. Bấm vào menu riêng **Tiến Lên Game** trên thanh menu trái của WP Admin để lấy ngay đường link sảnh chơi (mặc định là `https://ten-mien-cua-ban/tien-len/`) gửi cho bạn bè.

== Shortcodes ==

* `[tien_len_game]` — Hiển thị toàn màn hình riêng (khuyên dùng).
* `[tien_len_game fullscreen="no"]` — Nhúng khung game bên trong bố cục trang hiện tại của theme.

== Changelog ==

= 1.0.0 =
* Phiên bản đầu tiên chuyển đổi hoàn chỉnh sang WordPress Plugin thuần PHP + MySQL + REST API.
