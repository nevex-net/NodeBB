<div class="acp-page-container">
	<div component="settings/main/header" class="row border-bottom py-2 m-0 sticky-top acp-page-main-header align-items-center">
		<div class="col-12 col-md-8 px-0 mb-1 mb-md-0">
			<h4 class="fw-bold tracking-tight mb-0">External Comments</h4>
		</div>
		<div class="col-12 col-md-4 px-0 px-md-3">
			<button id="save" class="btn btn-primary btn-sm fw-semibold ff-secondary w-100 text-center text-nowrap">Save changes</button>
		</div>
	</div>

	<div class="row m-0">
		<div id="spy-container" class="col-12 col-md-8 px-0 mb-4" tabindex="0">
			<form role="form" class="external-comments-settings mb-4">
				<div class="mb-3">
					<label class="form-label" for="serviceUid">Service User UID</label>
					<input id="serviceUid" name="serviceUid" type="number" class="form-control" data-field="serviceUid" placeholder="e.g. 2" />
					<div class="form-text">Topic creator uid (e.g. comments-bot uid)</div>
				</div>

				<div class="mb-3">
					<label class="form-label" for="categoryId">Category ID</label>
					<input id="categoryId" name="categoryId" type="number" class="form-control" data-field="categoryId" placeholder="e.g. 1" />
					<div class="form-text">Category where comment topics will be created</div>
				</div>

				<div class="mb-3">
					<label class="form-label" for="keycloakWebhookSecret">Keycloak Webhook Secret</label>
					<input id="keycloakWebhookSecret" name="keycloakWebhookSecret" type="password" class="form-control" data-field="keycloakWebhookSecret" placeholder="shared secret for x-keycloak-signature" />
					<div class="form-text">Used to validate HMAC SHA-256 signature from Keycloak (`x-keycloak-signature`)</div>
				</div>

			</form>
		</div>

		<div class="col-md-4 d-none d-md-block px-3 hidden" component="settings/toc">
			<div class="sticky-top" style="top: 4.0rem;">
				<div class="fw-bold text-xs text-muted mb-1">On this page:</div>
				<nav id="settings-navbar" class="h-100 flex-column align-items-stretch">
					<nav class="nav nav-pills flex-column gap-2" component="settings/toc/list"></nav>
				</nav>
			</div>
		</div>
	</div>
</div>

<script>
	(function () {
		const root = document.querySelector('.external-comments-settings');
		if (!root) {
			return;
		}
		if (root.dataset.initialized === '1') {
			return;
		}
		root.dataset.initialized = '1';

		const serviceUidEl = document.getElementById('serviceUid');
		const categoryIdEl = document.getElementById('categoryId');
		const keycloakWebhookSecretEl = document.getElementById('keycloakWebhookSecret');
		const saveEl = document.getElementById('save');
		if (!serviceUidEl || !categoryIdEl || !keycloakWebhookSecretEl || !saveEl || typeof socket === 'undefined') {
			return;
		}

		socket.emit('admin.settings.get', { hash: 'external-comments' }, function (err, values) {
			if (err) {
				return;
			}
			values = values || {};
			serviceUidEl.value = values.serviceUid || '';
			categoryIdEl.value = values.categoryId || '';
			keycloakWebhookSecretEl.value = values.keycloakWebhookSecret || '';
		});

		saveEl.addEventListener('click', function (e) {
			e.preventDefault();
			const values = {
				serviceUid: String(serviceUidEl.value || '').trim(),
				categoryId: String(categoryIdEl.value || '').trim(),
				keycloakWebhookSecret: String(keycloakWebhookSecretEl.value || '').trim(),
			};
			socket.emit('admin.settings.set', {
				hash: 'external-comments',
				values: values,
			}, function (err) {
				if (err) {
					if (typeof app !== 'undefined' && app.alertError) {
						app.alertError(err.message || 'Settings save failed');
					}
					return;
				}
				if (typeof app !== 'undefined' && app.alertSuccess) {
					app.alertSuccess('Settings saved');
				}
			});
		});
	}());
</script>
