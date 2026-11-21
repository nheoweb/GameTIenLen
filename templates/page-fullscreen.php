<?php
/**
 * Template trang chơi Tiến Lên Miền Nam Toàn màn hình (độc lập, không dính CSS của theme).
 *
 * @package TienLenMienNam
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Báo LiteSpeed Cache và các plugin cache khác không cache trang phòng chơi.
if ( ! defined( 'DONOTCACHEPAGE' ) ) {
	define( 'DONOTCACHEPAGE', true );
}
if ( ! headers_sent() ) {
	nocache_headers();
	header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
	header( 'Pragma: no-cache' );
	header( 'Expires: 0' );
	header( 'X-LiteSpeed-Cache-Control: no-cache, no-store' );
}

$tlmn_config    = TLMN_Plugin::get_frontend_config();
$tlmn_css_ver   = TLMN_Plugin::get_asset_version( 'assets/css/tien-len.css' );
$tlmn_audio_ver = TLMN_Plugin::get_asset_version( 'assets/js/audio.js' );
$tlmn_app_ver   = TLMN_Plugin::get_asset_version( 'assets/js/app.js' );
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title><?php echo esc_html( get_the_title() ? get_the_title() . ' — ' . get_bloginfo( 'name' ) : 'Tiến Lên Miền Nam — Chơi Nội Bộ Online' ); ?></title>
	<link rel="stylesheet" href="<?php echo esc_url( TLMN_PLUGIN_URL . 'assets/css/tien-len.css?ver=' . rawurlencode( $tlmn_css_ver ) ); ?>" />
</head>
<body class="tlmn-fullscreen-page">
	<?php
	$tlmn_is_fullscreen = true;
	require TLMN_PLUGIN_PATH . 'templates/game-markup.php';
	?>
	<script>
		window.TLMN_CONFIG = <?php echo wp_json_encode( $tlmn_config ); ?>;
	</script>
	<script src="<?php echo esc_url( TLMN_PLUGIN_URL . 'assets/js/audio.js?ver=' . rawurlencode( $tlmn_audio_ver ) ); ?>"></script>
	<script src="<?php echo esc_url( TLMN_PLUGIN_URL . 'assets/js/app.js?ver=' . rawurlencode( $tlmn_app_ver ) ); ?>"></script>
</body>
</html>
