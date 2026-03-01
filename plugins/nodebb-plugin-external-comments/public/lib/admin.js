'use strict';

define('admin/plugins/external-comments', ['settings'], function (Settings) {
	const ACP = {};
	const LOG_PREFIX = '[external-comments]';

	ACP.init = function () {
		const wrapper = $('.external-comments-settings');
		console.log(`${LOG_PREFIX} ACP.init`, {
			wrapperFound: !!wrapper.length,
			path: window.location.pathname,
		});
		Settings.load('external-comments', wrapper);
		console.log(`${LOG_PREFIX} Settings.load done`);

		$('#save').off('click').on('click', function () {
			console.log(`${LOG_PREFIX} Save clicked`, {
				serviceUid: $('#serviceUid').val(),
				categoryId: $('#categoryId').val(),
			});
			try {
				Settings.save('external-comments', wrapper, function () {
					console.log(`${LOG_PREFIX} Settings.save callback`);
					app.alertSuccess('Settings saved');
				});
			} catch (err) {
				console.error(`${LOG_PREFIX} Settings.save failed`, err);
				app.alertError(err && err.message ? err.message : 'Settings save failed');
			}
		});
		console.log(`${LOG_PREFIX} Save handler bound`);
	};

	return ACP;
});
