<?php
/**
 * Dọn sạch bảng dữ liệu & option khi người dùng bấm Delete plugin trong WordPress Admin.
 *
 * @package TienLenMienNam
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

global $wpdb;
$table_name = $wpdb->prefix . 'tien_len_rooms';
// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
$wpdb->query( "DROP TABLE IF EXISTS {$table_name}" );

delete_option( 'tlmn_db_version' );
delete_option( 'tlmn_game_page_id' );
