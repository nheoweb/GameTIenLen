<?php
/**
 * Lưu trữ trạng thái phòng chơi trong MySQL WordPress kèm khóa chống tranh chấp (GET_LOCK).
 *
 * @package TienLenMienNam
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TLMN_Storage {

	/** Phòng không có hoạt động trong 4 giờ sẽ tự động bị dọn sạch. */
	const STALE_ROOM_SECONDS = 14400;

	/**
	 * Tên bảng phòng chơi kèm prefix WordPress.
	 *
	 * @return string
	 */
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . 'tien_len_rooms';
	}

	/**
	 * Tên bảng tín hiệu WebRTC Voice Chat kèm prefix WordPress.
	 *
	 * @return string
	 */
	public static function signals_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'tien_len_voice_signals';
	}

	/**
	 * Tạo bảng MySQL khi kích hoạt plugin.
	 *
	 * @return void
	 */
	public static function create_table() {
		global $wpdb;
		$table_name      = self::table_name();
		$signals_table   = self::signals_table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table_name} (
			room_id varchar(8) NOT NULL,
			state_json longtext NOT NULL,
			version bigint(20) unsigned NOT NULL DEFAULT 1,
			status varchar(20) NOT NULL DEFAULT 'WAITING',
			updated_at bigint(20) unsigned NOT NULL DEFAULT 0,
			PRIMARY KEY  (room_id),
			KEY idx_updated_at (updated_at)
		) {$charset_collate};";

		$sql_signals = "CREATE TABLE {$signals_table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			room_id varchar(8) NOT NULL,
			from_token varchar(64) NOT NULL,
			to_token varchar(64) NOT NULL,
			signal_type varchar(20) NOT NULL,
			payload longtext NOT NULL,
			created_at bigint(20) unsigned NOT NULL DEFAULT 0,
			PRIMARY KEY  (id),
			KEY idx_room_to_id (room_id, to_token, id),
			KEY idx_created_at (created_at)
		) {$charset_collate};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
		dbDelta( $sql_signals );
	}

	/**
	 * Xóa bảng khi gỡ bỏ plugin hoàn toàn (uninstall).
	 *
	 * @return void
	 */
	public static function drop_table() {
		global $wpdb;
		$table_name    = self::table_name();
		$signals_table = self::signals_table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query( "DROP TABLE IF EXISTS {$table_name}" );
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query( "DROP TABLE IF EXISTS {$signals_table}" );
	}

	/**
	 * Khóa thao tác theo room_id bằng MySQL GET_LOCK để tránh 2 người ghi đè state cùng lúc.
	 *
	 * @param string $room_id Mã phòng.
	 * @param int    $timeout Thời gian chờ khóa (giây).
	 * @return bool
	 */
	public static function acquire_lock( $room_id, $timeout = 3 ) {
		global $wpdb;
		$lock_name = 'tlmn_room_' . preg_replace( '/[^0-9a-zA-Z_]/', '', (string) $room_id );
		$locked    = $wpdb->get_var(
			$wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock_name, (int) $timeout )
		);
		return '1' === (string) $locked;
	}

	/**
	 * Giải phóng khóa MySQL.
	 *
	 * @param string $room_id Mã phòng.
	 * @return void
	 */
	public static function release_lock( $room_id ) {
		global $wpdb;
		$lock_name = 'tlmn_room_' . preg_replace( '/[^0-9a-zA-Z_]/', '', (string) $room_id );
		$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
	}

	/**
	 * Thực thi callback an toàn trong vòng khóa của 1 phòng.
	 *
	 * @param string   $room_id  Mã phòng.
	 * @param callable $callback Hàm nhận (&$room) và trả kết quả.
	 * @return mixed
	 */
	public static function with_room_lock( $room_id, callable $callback ) {
		$got_lock = self::acquire_lock( $room_id, 3 );
		try {
			return $callback( $got_lock );
		} finally {
			if ( $got_lock ) {
				self::release_lock( $room_id );
			}
		}
	}

	/**
	 * Kiểm tra nhanh version và status của phòng (giúp poll nhẹ tối đa).
	 *
	 * @param string $room_id Mã phòng.
	 * @return array<string, mixed>|null
	 */
	public static function get_room_meta( $room_id ) {
		global $wpdb;
		$table = self::table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$row = $wpdb->get_row(
			$wpdb->prepare( "SELECT room_id, version, status, updated_at FROM {$table} WHERE room_id = %s", (string) $room_id ),
			ARRAY_A
		);
		return is_array( $row ) ? $row : null;
	}

	/**
	 * Lấy toàn bộ state của 1 phòng từ MySQL.
	 *
	 * @param string $room_id Mã phòng.
	 * @return array<string, mixed>|null
	 */
	public static function get_room( $room_id ) {
		global $wpdb;
		$table = self::table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$json = $wpdb->get_var(
			$wpdb->prepare( "SELECT state_json FROM {$table} WHERE room_id = %s", (string) $room_id )
		);
		if ( empty( $json ) ) {
			return null;
		}
		$data = json_decode( $json, true );
		return is_array( $data ) ? $data : null;
	}

	/**
	 * Lưu state phòng (INSERT hoặc UPDATE).
	 *
	 * @param array<string, mixed> $room Trạng thái phòng.
	 * @return bool
	 */
	public static function save_room( array $room ) {
		global $wpdb;
		$table = self::table_name();
		$json  = wp_json_encode( $room );
		if ( false === $json ) {
			return false;
		}

		$result = $wpdb->replace(
			$table,
			array(
				'room_id'    => (string) $room['roomId'],
				'state_json' => $json,
				'version'    => isset( $room['version'] ) ? (int) $room['version'] : 1,
				'status'     => isset( $room['status'] ) ? (string) $room['status'] : 'WAITING',
				'updated_at' => time(),
			),
			array( '%s', '%s', '%d', '%s', '%d' )
		);

		return false !== $result;
	}

	/**
	 * Xóa phòng khỏi MySQL.
	 *
	 * @param string $room_id Mã phòng.
	 * @return void
	 */
	public static function delete_room( $room_id ) {
		global $wpdb;
		$wpdb->delete(
			self::table_name(),
			array( 'room_id' => (string) $room_id ),
			array( '%s' )
		);
		self::delete_room_signals( $room_id );
	}

	/**
	 * Lưu 1 tín hiệu WebRTC Voice Chat (offer / answer / ice / hello / bye / mic_state).
	 *
	 * @param string $room_id      Mã phòng.
	 * @param string $from_token   Token người gửi.
	 * @param string $to_token     Token người nhận (hoặc '*' cho cả phòng).
	 * @param string $signal_type  Loại tín hiệu.
	 * @param string $payload_json Chuỗi JSON dữ liệu tín hiệu.
	 * @return int ID bản ghi vừa thêm (0 nếu thất bại).
	 */
	public static function insert_voice_signal( $room_id, $from_token, $to_token, $signal_type, $payload_json ) {
		global $wpdb;
		$table = self::signals_table_name();
		$now   = time();

		// Tự dọn các tín hiệu quá 90 giây để bảng luôn siêu nhẹ.
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query(
			$wpdb->prepare( "DELETE FROM {$table} WHERE created_at < %d", $now - 90 )
		);

		$ok = $wpdb->insert(
			$table,
			array(
				'room_id'     => (string) $room_id,
				'from_token'  => (string) $from_token,
				'to_token'    => (string) $to_token,
				'signal_type' => (string) $signal_type,
				'payload'     => (string) $payload_json,
				'created_at'  => $now,
			),
			array( '%s', '%s', '%s', '%s', '%s', '%d' )
		);

		return false !== $ok ? (int) $wpdb->insert_id : 0;
	}

	/**
	 * Đọc các tín hiệu WebRTC mới dành cho 1 người chơi trong phòng.
	 *
	 * @param string $room_id      Mã phòng.
	 * @param string $viewer_token Token người nhận.
	 * @param int    $after_id     Chỉ lấy bản ghi có id > after_id.
	 * @param int    $limit        Số bản ghi tối đa.
	 * @return array<string, mixed>
	 */
	public static function get_voice_signals( $room_id, $viewer_token, $after_id = 0, $limit = 50 ) {
		global $wpdb;
		$table     = self::signals_table_name();
		$after_id  = max( 0, (int) $after_id );
		$limit     = max( 1, min( 100, (int) $limit ) );
		$min_time  = time() - 45;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, from_token, to_token, signal_type, payload, created_at
				FROM {$table}
				WHERE room_id = %s
				  AND id > %d
				  AND created_at >= %d
				  AND from_token <> %s
				  AND (to_token = %s OR to_token = '*')
				ORDER BY id ASC
				LIMIT %d",
				(string) $room_id,
				$after_id,
				$min_time,
				(string) $viewer_token,
				(string) $viewer_token,
				$limit
			),
			ARRAY_A
		);

		$signals   = array();
		$latest_id = $after_id;

		if ( is_array( $rows ) ) {
			foreach ( $rows as $row ) {
				$sid = (int) $row['id'];
				if ( $sid > $latest_id ) {
					$latest_id = $sid;
				}
				$decoded_payload = json_decode( (string) $row['payload'], true );
				$signals[]       = array(
					'id'         => $sid,
					'fromToken'  => (string) $row['from_token'],
					'toToken'    => (string) $row['to_token'],
					'signalType' => (string) $row['signal_type'],
					'payload'    => is_array( $decoded_payload ) ? $decoded_payload : null,
					'createdAt'  => (int) $row['created_at'],
				);
			}
		}

		return array(
			'signals'  => $signals,
			'latestId' => $latest_id,
		);
	}

	/**
	 * Xóa toàn bộ tín hiệu WebRTC của 1 phòng.
	 *
	 * @param string $room_id Mã phòng.
	 * @return void
	 */
	public static function delete_room_signals( $room_id ) {
		global $wpdb;
		$wpdb->delete(
			self::signals_table_name(),
			array( 'room_id' => (string) $room_id ),
			array( '%s' )
		);
	}

	/**
	 * Sinh mã phòng 4 chữ số chưa trùng trong DB.
	 *
	 * @return string
	 */
	public static function generate_unique_room_id() {
		global $wpdb;
		$table = self::table_name();
		for ( $attempt = 0; $attempt < 100; $attempt++ ) {
			$code = (string) random_int( 1000, 9999 );
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$exists = $wpdb->get_var(
				$wpdb->prepare( "SELECT 1 FROM {$table} WHERE room_id = %s LIMIT 1", $code )
			);
			if ( ! $exists ) {
				return $code;
			}
		}
		return substr( (string) time(), -4 );
	}

	/**
	 * Lấy danh sách tất cả các phòng đang mở cho Sảnh chờ (tự dọn phòng quá hạn).
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public static function get_all_rooms() {
		global $wpdb;
		self::cleanup_stale_rooms();

		$table = self::table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$rows = $wpdb->get_results(
			"SELECT state_json FROM {$table} ORDER BY updated_at DESC LIMIT 50",
			ARRAY_A
		);

		$rooms = array();
		if ( is_array( $rows ) ) {
			foreach ( $rows as $row ) {
				$decoded = json_decode( $row['state_json'], true );
				if ( is_array( $decoded ) && ! empty( $decoded['players'] ) ) {
					$rooms[] = $decoded;
				}
			}
		}
		return $rooms;
	}

	/**
	 * Rời khỏi các phòng khác mà playerToken đang ngồi (trước khi tạo/vào phòng mới).
	 *
	 * @param string      $player_token   Token người chơi.
	 * @param string|null $except_room_id Phòng loại trừ không rời.
	 * @return void
	 */
	public static function leave_other_rooms_by_token( $player_token, $except_room_id = null ) {
		global $wpdb;
		$table = self::table_name();
		$like  = '%' . $wpdb->esc_like( '"' . $player_token . '"' ) . '%';

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$room_ids = $wpdb->get_col(
			$wpdb->prepare( "SELECT room_id FROM {$table} WHERE state_json LIKE %s", $like )
		);

		if ( empty( $room_ids ) ) {
			return;
		}

		foreach ( $room_ids as $rid ) {
			if ( null !== $except_room_id && (string) $rid === (string) $except_room_id ) {
				continue;
			}
			self::with_room_lock(
				$rid,
				function () use ( $rid, $player_token ) {
					$room = self::get_room( $rid );
					if ( ! $room ) {
						return;
					}
					$res = TLMN_Room_Manager::leave_room( $room, $player_token );
					if ( ! empty( $res['roomDeleted'] ) ) {
						self::delete_room( $rid );
					} elseif ( ! empty( $res['ok'] ) ) {
						self::save_room( $room );
					}
				}
			);
		}
	}

	/**
	 * Dọn dẹp các phòng cũ không có tương tác quá 4 giờ.
	 *
	 * @param int|null $max_age_seconds Tuổi tối đa (mặc định 4 giờ).
	 * @return int Số phòng đã xóa.
	 */
	public static function cleanup_stale_rooms( $max_age_seconds = null ) {
		global $wpdb;
		$table   = self::table_name();
		$seconds = null !== $max_age_seconds ? (int) $max_age_seconds : self::STALE_ROOM_SECONDS;
		$cutoff  = time() - $seconds;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$deleted = $wpdb->query(
			$wpdb->prepare( "DELETE FROM {$table} WHERE updated_at < %d", $cutoff )
		);

		$signals_table = self::signals_table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query(
			$wpdb->prepare( "DELETE FROM {$signals_table} WHERE created_at < %d", time() - 120 )
		);

		return (int) $deleted;
	}

	/**
	 * Đếm số phòng đang hoạt động (dùng cho trang cài đặt WP Admin).
	 *
	 * @return int
	 */
	public static function count_active_rooms() {
		global $wpdb;
		$table = self::table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
	}
}
