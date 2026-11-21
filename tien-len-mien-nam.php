<?php
/**
 * Plugin Name:       Tiến Lên Miền Nam Nội Bộ
 * Plugin URI:        https://wordpress.org/
 * Description:       Game bài Tiến Lên Miền Nam Online nội bộ (2–4 người chơi), chạy thuần PHP + MySQL + REST API ngay trên WordPress không cần server Node.js.
 * Version:           1.2.1
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Game Tiến Lên Nội Bộ
 * License:           GPLv2 or later
 * Text Domain:       tien-len-mien-nam
 *
 * @package TienLenMienNam
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'TLMN_VERSION', '1.2.1' );
define( 'TLMN_DB_VERSION', '1.0.0' );
define( 'TLMN_PLUGIN_FILE', __FILE__ );
define( 'TLMN_PLUGIN_PATH', plugin_dir_path( __FILE__ ) );
define( 'TLMN_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require_once TLMN_PLUGIN_PATH . 'includes/class-tlmn-deck.php';
require_once TLMN_PLUGIN_PATH . 'includes/class-tlmn-rules.php';
require_once TLMN_PLUGIN_PATH . 'includes/class-tlmn-room-manager.php';
require_once TLMN_PLUGIN_PATH . 'includes/class-tlmn-storage.php';
require_once TLMN_PLUGIN_PATH . 'includes/class-tlmn-rest-api.php';

class TLMN_Plugin {

	const TEMPLATE_SLUG  = 'tlmn-fullscreen';
	const PAGE_OPTION    = 'tlmn_game_page_id';
	const ENABLED_OPTION = 'tlmn_game_enabled';

	/**
	 * Kiểm tra sảnh game có đang được Admin bật cho phép hiển thị hay không.
	 *
	 * @return bool
	 */
	public static function is_game_enabled() {
		return '0' !== (string) get_option( self::ENABLED_OPTION, '1' );
	}

	/**
	 * Khởi chạy toàn bộ hooks của plugin.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'plugins_loaded', array( __CLASS__, 'maybe_upgrade_db' ) );
		add_action( 'rest_api_init', array( 'TLMN_Rest_Api', 'register_routes' ) );
		add_shortcode( 'tien_len_game', array( __CLASS__, 'render_shortcode' ) );

		// Đăng ký Page Template Toàn màn hình & tự nhận diện trang chứa shortcode.
		add_filter( 'theme_page_templates', array( __CLASS__, 'register_page_template' ) );
		add_filter( 'template_include', array( __CLASS__, 'maybe_load_fullscreen_template' ), 99 );

		// Trang Cài đặt / Link chơi trong WP Admin.
		add_action( 'admin_menu', array( __CLASS__, 'register_admin_menu' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( TLMN_PLUGIN_FILE ), array( __CLASS__, 'add_plugin_action_links' ) );
	}

	/**
	 * Kích hoạt plugin: tạo bảng MySQL & tự tạo sẵn trang chơi /tien-len/.
	 *
	 * @return void
	 */
	public static function activate() {
		TLMN_Storage::create_table();
		update_option( 'tlmn_db_version', TLMN_DB_VERSION );
		self::ensure_game_page_exists();
	}

	/**
	 * Đảm bảo bảng DB tồn tại khi nâng cấp phiên bản.
	 *
	 * @return void
	 */
	public static function maybe_upgrade_db() {
		if ( get_option( 'tlmn_db_version' ) !== TLMN_DB_VERSION ) {
			TLMN_Storage::create_table();
			update_option( 'tlmn_db_version', TLMN_DB_VERSION );
		}
	}

	/**
	 * Tạo sẵn trang chơi Tiến Lên Miền Nam nếu chưa có.
	 *
	 * @return int ID của trang chơi bài.
	 */
	public static function ensure_game_page_exists() {
		$page_id = (int) get_option( self::PAGE_OPTION, 0 );
		if ( $page_id > 0 && 'publish' === get_post_status( $page_id ) ) {
			return $page_id;
		}

		$existing = get_page_by_path( 'tien-len' );
		if ( $existing && 'publish' === $existing->post_status ) {
			update_option( self::PAGE_OPTION, (int) $existing->ID );
			update_post_meta( (int) $existing->ID, '_wp_page_template', self::TEMPLATE_SLUG );
			return (int) $existing->ID;
		}

		$new_id = wp_insert_post(
			array(
				'post_title'   => 'Tiến Lên Miền Nam',
				'post_name'    => 'tien-len',
				'post_content' => '[tien_len_game]',
				'post_status'  => 'publish',
				'post_type'    => 'page',
			)
		);

		if ( ! is_wp_error( $new_id ) && $new_id > 0 ) {
			update_option( self::PAGE_OPTION, (int) $new_id );
			update_post_meta( (int) $new_id, '_wp_page_template', self::TEMPLATE_SLUG );
			return (int) $new_id;
		}

		return 0;
	}

	/**
	 * Lấy version động theo filemtime để tự động phá cache trình duyệt mobile/desktop khi cập nhật plugin.
	 *
	 * @param string $relative_path Đường dẫn tương đối tính từ thư mục plugin.
	 * @return string
	 */
	public static function get_asset_version( $relative_path ) {
		$full_path = TLMN_PLUGIN_PATH . ltrim( (string) $relative_path, '/\\' );
		$mtime     = file_exists( $full_path ) ? (int) filemtime( $full_path ) : 0;
		return $mtime > 0 ? TLMN_VERSION . '.' . $mtime : TLMN_VERSION;
	}

	/**
	 * Lấy cấu hình truyền xuống JavaScript frontend.
	 *
	 * @return array<string, mixed>
	 */
	public static function get_frontend_config() {
		$wp_user_name = '';
		if ( is_user_logged_in() ) {
			$user = wp_get_current_user();
			if ( $user && ! empty( $user->display_name ) ) {
				$wp_user_name = $user->display_name;
			}
		}

		return array(
			'restBase'    => esc_url_raw( rest_url( TLMN_Rest_Api::API_NAMESPACE ) ),
			'homeUrl'     => esc_url_raw( home_url( '/' ) ),
			'audioBase'   => esc_url_raw( TLMN_PLUGIN_URL . 'assets/audio/' ),
			'audioVer'    => self::get_asset_version( 'assets/audio/counter_1.mp3' ),
			'wpUserName'  => $wp_user_name,
			'pollRoomMs'  => 900,
			'pollLobbyMs' => 2500,
		);
	}

	/**
	 * Thêm lựa chọn Page Template "Tiến Lên Miền Nam (Toàn màn hình)".
	 *
	 * @param array<string, string> $templates Danh sách template hiện có.
	 * @return array<string, string>
	 */
	public static function register_page_template( $templates ) {
		$templates[ self::TEMPLATE_SLUG ] = 'Tiến Lên Miền Nam (Toàn màn hình)';
		return $templates;
	}

	/**
	 * Tự động nạp template toàn màn hình nếu trang dùng template plugin
	 * hoặc chứa shortcode [tien_len_game] (trừ khi truyền fullscreen="no").
	 *
	 * @param string $template Đường dẫn template hiện tại của theme.
	 * @return string
	 */
	public static function maybe_load_fullscreen_template( $template ) {
		if ( ! is_singular() ) {
			return $template;
		}

		$post = get_queried_object();
		if ( ! $post || ! isset( $post->ID ) ) {
			return $template;
		}

		$selected_tpl = get_page_template_slug( $post->ID );
		if ( self::TEMPLATE_SLUG === $selected_tpl ) {
			return TLMN_PLUGIN_PATH . 'templates/page-fullscreen.php';
		}

		$content = isset( $post->post_content ) ? (string) $post->post_content : '';
		if ( has_shortcode( $content, 'tien_len_game' ) ) {
			// Nếu người dùng cố tình nhúng dạng khung nhỏ [tien_len_game fullscreen="no"] thì giữ nguyên theme.
			if ( ! preg_match( '/\[tien_len_game[^\]]*fullscreen\s*=\s*["\']?no["\']?/i', $content ) ) {
				return TLMN_PLUGIN_PATH . 'templates/page-fullscreen.php';
			}
		}

		return $template;
	}

	/**
	 * Xử lý shortcode [tien_len_game] (hỗ trợ cả chế độ nhúng fullscreen="no").
	 *
	 * @param array<string, mixed>|string $atts Thuộc tính shortcode.
	 * @return string
	 */
	public static function render_shortcode( $atts = array() ) {
		$atts = shortcode_atts(
			array(
				'fullscreen' => 'yes',
			),
			$atts,
			'tien_len_game'
		);

		wp_enqueue_style(
			'tlmn-style',
			TLMN_PLUGIN_URL . 'assets/css/tien-len.css',
			array(),
			self::get_asset_version( 'assets/css/tien-len.css' )
		);

		if ( self::is_game_enabled() ) {
			wp_enqueue_script(
				'tlmn-audio',
				TLMN_PLUGIN_URL . 'assets/js/audio.js',
				array(),
				self::get_asset_version( 'assets/js/audio.js' ),
				true
			);

			wp_enqueue_script(
				'tlmn-app',
				TLMN_PLUGIN_URL . 'assets/js/app.js',
				array( 'tlmn-audio' ),
				self::get_asset_version( 'assets/js/app.js' ),
				true
			);

			wp_localize_script( 'tlmn-app', 'TLMN_CONFIG', self::get_frontend_config() );
		}

		$tlmn_is_fullscreen = ( 'no' !== strtolower( trim( (string) $atts['fullscreen'] ) ) );

		ob_start();
		require TLMN_PLUGIN_PATH . 'templates/game-markup.php';
		return (string) ob_get_clean();
	}

	/**
	 * Đăng ký menu cấp cao nhất (Top-level Menu) riêng biệt trên thanh bên WP Admin.
	 *
	 * @return void
	 */
	public static function register_admin_menu() {
		add_menu_page(
			'Tiến Lên Miền Nam',
			'Tiến Lên Game',
			'manage_options',
			'tien-len-mien-nam',
			array( __CLASS__, 'render_admin_page' ),
			'dashicons-games',
			31
		);
	}

	/**
	 * Thêm link "Mở trang chơi & Cài đặt" ngay trong danh sách Plugins.
	 *
	 * @param array<int, string> $links Các link thao tác plugin.
	 * @return array<int, string>
	 */
	public static function add_plugin_action_links( $links ) {
		$settings_url = admin_url( 'admin.php?page=tien-len-mien-nam' );
		array_unshift(
			$links,
			'<a href="' . esc_url( $settings_url ) . '"><strong>Link chơi &amp; Cài đặt</strong></a>'
		);
		return $links;
	}

	/**
	 * Hiển thị trang quản trị gọn nhẹ trong WP Admin.
	 *
	 * @return void
	 */
	public static function render_admin_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$notice = '';
		if ( isset( $_POST['tlmn_action'] ) && check_admin_referer( 'tlmn_admin_nonce', 'tlmn_nonce' ) ) {
			$action = sanitize_text_field( wp_unslash( $_POST['tlmn_action'] ) );
			if ( 'enable_game' === $action ) {
				update_option( self::ENABLED_OPTION, '1' );
				$notice = '🟢 Đã BẬT mở lại giao diện Sảnh Game Tiến Lên Miền Nam!';
			} elseif ( 'disable_game' === $action ) {
				update_option( self::ENABLED_OPTION, '0' );
				$deleted = TLMN_Storage::cleanup_stale_rooms( -1 );
				$notice  = '🔴 Đã TẮT giao diện Sảnh Game và đóng toàn bộ ' . $deleted . ' bàn đang mở.';
			} elseif ( 'cleanup_stale' === $action ) {
				$deleted = TLMN_Storage::cleanup_stale_rooms();
				$notice  = 'Đã dọn sạch ' . $deleted . ' phòng cũ không hoạt động quá 4 giờ.';
			} elseif ( 'cleanup_all' === $action ) {
				$deleted = TLMN_Storage::cleanup_stale_rooms( -1 );
				$notice  = 'Đã đóng và dọn sạch toàn bộ ' . $deleted . ' phòng đang lưu.';
			} elseif ( 'recreate_page' === $action ) {
				$page_id = self::ensure_game_page_exists();
				$notice  = $page_id > 0 ? 'Đã tạo lại trang chơi Tiến Lên Miền Nam thành công!' : 'Không thể tạo trang mới.';
			}
		}

		$is_enabled   = self::is_game_enabled();
		$page_id      = (int) get_option( self::PAGE_OPTION, 0 );
		$page_url     = ( $page_id > 0 && 'publish' === get_post_status( $page_id ) ) ? get_permalink( $page_id ) : '';
		$active_rooms = TLMN_Storage::count_active_rooms();
		?>
		<div class="wrap">
			<h1>🃏 Tiến Lên Miền Nam Nội Bộ (2 – 4 người)</h1>

			<?php if ( '' !== $notice ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php echo esc_html( $notice ); ?></p></div>
			<?php endif; ?>

			<div class="card" style="max-width: 720px; padding: 16px 20px; margin-top: 16px; border-left: 4px solid <?php echo $is_enabled ? '#22c55e' : '#ef4444'; ?>;">
				<h2 style="margin-top: 0;">1. Công tắc Bật / Tắt hiển thị Sảnh Game (Kiểm soát của Admin)</h2>
				<p>
					Trạng thái hiện tại:
					<?php if ( $is_enabled ) : ?>
						<strong style="color: #15803d; background: #dcfce7; padding: 3px 10px; border-radius: 999px;">🟢 ĐANG BẬT (Cho phép hiển thị giao diện game)</strong>
					<?php else : ?>
						<strong style="color: #b91c1c; background: #fee2e2; padding: 3px 10px; border-radius: 999px;">🔴 ĐANG TẮT (Đã khóa giao diện &amp; đóng mọi bàn chơi)</strong>
					<?php endif; ?>
				</p>
				<p style="color: #4b5563;">
					Khi chuyển sang <strong>TẮT</strong>, toàn bộ giao diện bàn chơi và các cổng API sẽ bị khóa ngay lập tức (đồng thời hủy mọi bàn đang mở) để ngăn chặn người lạ tự ý truy cập hoặc lợi dụng chơi ngoài sự kiểm soát của Quản trị viên.
				</p>
				<form method="post" style="margin-top: 12px;">
					<?php wp_nonce_field( 'tlmn_admin_nonce', 'tlmn_nonce' ); ?>
					<?php if ( $is_enabled ) : ?>
						<input type="hidden" name="tlmn_action" value="disable_game" />
						<button type="submit" class="button" style="background: #dc2626; border-color: #b91c1c; color: #fff; font-weight: 600;" onclick="return confirm('Bạn có chắc muốn TẮT giao diện sảnh game và đóng toàn bộ các bàn đang chơi không?');">
							🔒 Tắt Sảnh Game Ngay (Ẩn giao diện &amp; Khóa truy cập)
						</button>
					<?php else : ?>
						<input type="hidden" name="tlmn_action" value="enable_game" />
						<button type="submit" class="button button-primary" style="font-weight: 600;">
							🔓 Bật Mở Lại Giao Diện Sảnh Game
						</button>
					<?php endif; ?>
				</form>
			</div>

			<div class="card" style="max-width: 720px; padding: 16px 20px; margin-top: 16px;">
				<h2 style="margin-top: 0;">2. Đường link vào chơi ngay</h2>
				<?php if ( '' !== $page_url ) : ?>
					<p>Trang chơi toàn màn hình đã sẵn sàng — bạn chỉ cần gửi đường link này cho nhóm bạn bè:</p>
					<p>
						<input type="text" readonly value="<?php echo esc_attr( $page_url ); ?>" style="width: 100%; max-width: 520px; font-family: monospace;" onclick="this.select();" />
					</p>
					<p>
						<a href="<?php echo esc_url( $page_url ); ?>" target="_blank" rel="noopener noreferrer" class="button button-primary">
							🃏 Mở Sảnh Chơi Ngay (Tab mới)
						</a>
					</p>
				<?php else : ?>
					<p>Trang chơi mặc định chưa tồn tại hoặc đã bị xóa.</p>
					<form method="post">
						<?php wp_nonce_field( 'tlmn_admin_nonce', 'tlmn_nonce' ); ?>
						<input type="hidden" name="tlmn_action" value="recreate_page" />
						<button type="submit" class="button button-primary">➕ Tự động tạo trang /tien-len/</button>
					</form>
				<?php endif; ?>
			</div>

			<div class="card" style="max-width: 720px; padding: 16px 20px; margin-top: 16px;">
				<h2 style="margin-top: 0;">3. Cách nhúng vào trang khác (Shortcode)</h2>
				<ul style="list-style: disc; margin-left: 20px;">
					<li><code>[tien_len_game]</code> — Tự động mở chế độ <strong>Toàn màn hình</strong> (không dính Header/Footer theme, khuyên dùng cho cả PC &amp; điện thoại).</li>
					<li><code>[tien_len_game fullscreen="no"]</code> — Nhúng khung game trực tiếp bên trong giao diện bài viết hiện tại của theme.</li>
				</ul>
			</div>

			<div class="card" style="max-width: 720px; padding: 16px 20px; margin-top: 16px;">
				<h2 style="margin-top: 0;">4. Trạng thái sảnh &amp; Bảo trì</h2>
				<p>Số phòng hiện đang lưu trong cơ sở dữ liệu: <strong><?php echo esc_html( (string) $active_rooms ); ?></strong> phòng. <em>(Các phòng không tương tác quá 4 giờ sẽ tự động bị dọn.)</em></p>
				<div style="display: flex; gap: 10px; flex-wrap: wrap;">
					<form method="post">
						<?php wp_nonce_field( 'tlmn_admin_nonce', 'tlmn_nonce' ); ?>
						<input type="hidden" name="tlmn_action" value="cleanup_stale" />
						<button type="submit" class="button">🧹 Dọn phòng cũ (&gt; 4 giờ)</button>
					</form>
					<form method="post" onsubmit="return confirm('Bạn có chắc muốn đóng toàn bộ các bàn đang mở hiện tại không?');">
						<?php wp_nonce_field( 'tlmn_admin_nonce', 'tlmn_nonce' ); ?>
						<input type="hidden" name="tlmn_action" value="cleanup_all" />
						<button type="submit" class="button">🗑️ Đóng &amp; Xóa tất cả bàn hiện tại</button>
					</form>
				</div>
			</div>
		</div>
		<?php
	}
}

register_activation_hook( TLMN_PLUGIN_FILE, array( 'TLMN_Plugin', 'activate' ) );
TLMN_Plugin::init();
