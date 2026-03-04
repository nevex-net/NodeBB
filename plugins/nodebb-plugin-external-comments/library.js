"use strict";

const db = require.main.require("./src/database");
const meta = require.main.require("./src/meta");
const topics = require.main.require("./src/topics");
const topicsAPI = require.main.require("./src/api/topics");
const privileges = require.main.require("./src/privileges");
const user = require.main.require("./src/user");
const routeHelpers = require.main.require("./src/routes/helpers");
const controllerHelpers = require.main.require("./src/controllers/helpers");
const winston = require.main.require("winston");
const crypto = require("crypto");

const plugin = module.exports;

const SETTINGS_KEY = "external-comments";
const MAPPING_HASH = "plugin:external-comments:external-to-tid";
const REVERSE_HASH = "plugin:external-comments:tid-to-external";
const KEYCLOAK_USER_MAP_HASH = "plugin:external-comments:keycloak-user-to-uid";
const LOCKS_HASH = "locks";
const LOCK_PREFIX = "plugin:external-comments:external:";

plugin.init = async ({ router, middleware }) => {
	routeHelpers.setupAdminPageRoute(
		router,
		"/admin/plugins/external-comments",
		[middleware.admin.checkPrivileges],
		(req, res) => {
			res.render("admin/plugins/external-comments", {});
		},
	);

	router.get(
		"/api/comments/:externalId",
		middleware.authenticateRequest,
		wrap(async (req, res) => {
			const externalId = normalizeExternalId(req.params.externalId);
			const tid = await getTidByExternalId(externalId);
			const slug = tid ? await topics.getTopicField(tid, "slug") : null;

			if (!tid) {
				res.status(404).end();
				return;
			}

			res.json({ exists: true, tid, slug: slug || null });
		}),
	);

	router.post(
		"/api/user/sync",
		[],
		wrap(async (req, res) => {
			const settings = await getSettings();

			const event = normalizeKeycloakEvent(req.body || {});

			const payload = {
				method: req.method,
				path: req.path,
				uid: req.uid || 0,
				ip: req.ip,
				params: req.params || {},
				query: req.query || {},
				body: event,
				headers: sanitizeHeaders(req.headers || {}),
			};
			winston.info(
				`[external-comments] /api/user/sync payload ${JSON.stringify(payload)}`,
			);

			validateKeycloakSignature({
				signature: req.headers["x-keycloak-signature"],
				body: req.body || {},
				secret: settings.keycloakWebhookSecret,
			});
			const syncResult = await handleKeycloakUserSync(event);
			winston.info(
				`[external-comments] /api/user/sync result ${JSON.stringify(syncResult || null)}`,
			);

			await controllerHelpers.formatApiResponse(200, res, {
				handled: !!syncResult && !!syncResult.handled,
				syncResult,
			});
		}),
	);

	router.post(
		"/api/comments/:externalId/comment",
		[
			middleware.authenticateRequest,
			middleware.applyCSRF,
			middleware.ensureLoggedIn,
		],
		wrap(async (req, res) => {
			const externalId = normalizeExternalId(req.params.externalId);
			const content = String((req.body && req.body.content) || "").trim();
			const toPid = parseInt(req.body && req.body.toPid, 10) || 0;
			if (!content) {
				await controllerHelpers.formatApiResponse(
					400,
					res,
					new Error("content-required"),
				);
				return;
			}

			const tid = await getOrCreateTopic(externalId, req);
			const result = await topicsAPI.reply(
				{ uid: req.uid, ip: req.ip },
				{ tid, content, toPid: toPid > 0 ? toPid : undefined },
			);

			await controllerHelpers.formatApiResponse(200, res, result);
		}),
	);
};

plugin.addAdminNavigation = async (header) => {
	header.plugins.push({
		route: "/plugins/external-comments",
		icon: "fa-comments",
		name: "External Comments",
	});

	return header;
};

async function getOrCreateTopic(externalId, req) {
	const existingTid = await getTidByExternalId(externalId);
	if (existingTid) {
		return existingTid;
	}

	const lockId = `${LOCK_PREFIX}${externalId}`;
	await acquireLock(lockId);
	try {
		const lockedTid = await getTidByExternalId(externalId);
		if (lockedTid) {
			return lockedTid;
		}

		const settings = await getSettings();
		if (!settings.serviceUid || settings.serviceUid <= 0) {
			throw new Error("serviceUid-not-configured");
		}
		if (!settings.categoryId || settings.categoryId <= 0) {
			throw new Error("categoryId-not-configured");
		}

		const canCreate = await privileges.categories.can(
			"topics:create",
			settings.categoryId,
			settings.serviceUid,
		);
		if (!canCreate) {
			throw new Error("service-user-no-topic-create-privilege");
		}

		const tid = await topics.create({
			uid: settings.serviceUid,
			cid: settings.categoryId,
			title: `#${externalId}`,
			timestamp: Date.now(),
		});
		if (!tid) {
			throw new Error("failed-to-create-topic");
		}

		await saveMapping(externalId, tid);
		return tid;
	} finally {
		await releaseLock(lockId);
	}
}

async function acquireLock(lockId) {
	const timeoutMs = 10000;
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const count = await db.incrObjectField(LOCKS_HASH, lockId);
		if (count === 1) {
			return;
		}

		await db.decrObjectField(LOCKS_HASH, lockId);
		await delay(50);
	}

	throw new Error("lock-timeout");
}

async function releaseLock(lockId) {
	const count = await db.decrObjectField(LOCKS_HASH, lockId);
	if (count <= 0) {
		await db.deleteObjectField(LOCKS_HASH, lockId);
	}
}

async function getTidByExternalId(externalId) {
	const tid = await db.getObjectField(MAPPING_HASH, externalId);
	const parsedTid = parseInt(tid, 10);
	return Number.isFinite(parsedTid) && parsedTid > 0 ? parsedTid : null;
}

async function saveMapping(externalId, tid) {
	await Promise.all([
		db.setObjectField(MAPPING_HASH, externalId, tid),
		db.setObjectField(REVERSE_HASH, String(tid), externalId),
	]);
}

async function getSettings() {
	const settings = await meta.settings.get(SETTINGS_KEY);
	return {
		serviceUid: parseInt(settings.serviceUid, 10) || 0,
		categoryId: parseInt(settings.categoryId, 10) || 0,
		keycloakWebhookSecret: String(
			settings.keycloakWebhookSecret || "",
		).trim(),
	};
}

function normalizeExternalId(externalId) {
	const value = String(externalId || "").trim();
	if (!value) {
		throw new Error("invalid-externalId");
	}
	if (value.length > 255) {
		throw new Error("externalId-too-long");
	}
	return value;
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function wrap(handler) {
	return async (req, res) => {
		try {
			await handler(req, res);
		} catch (err) {
			await controllerHelpers.formatApiResponse(400, res, err);
		}
	};
}

function validateKeycloakSignature({ signature, body, secret }) {
	const token = String(signature || "").trim();
	if (!token) {
		throw new Error("missing-x-keycloak-signature");
	}
	if (!secret) {
		throw new Error("keycloak-webhook-secret-not-configured");
	}

	const payload = typeof body === "string" ? body : JSON.stringify(body);
	const hex = crypto
		.createHmac("sha256", secret)
		.update(payload, "utf8")
		.digest("hex");
	const base64 = crypto
		.createHmac("sha256", secret)
		.update(payload, "utf8")
		.digest("base64");

	if (!safeCompare(token, hex) && !safeCompare(token, base64)) {
		throw new Error("invalid-x-keycloak-signature");
	}
}

function safeCompare(left, right) {
	const a = Buffer.from(String(left));
	const b = Buffer.from(String(right));
	if (a.length !== b.length) {
		return false;
	}
	return crypto.timingSafeEqual(a, b);
}

function normalizeKeycloakEvent(event) {
	const normalized = { ...event };
	if (typeof normalized.representation === "string") {
		try {
			normalized.representation = JSON.parse(normalized.representation);
		} catch (err) {
			winston.warn(
				`[external-comments] Failed to parse event.representation: ${err.message}`,
			);
		}
	}
	return normalized;
}

async function handleKeycloakUserSync(event) {
	const operationType = String(event.operationType || "").toUpperCase();
	const resourceType = String(event.resourceType || "").toUpperCase();
	const eventType = String(event.type || event.eventType || "").toUpperCase();

	const isCreate = resourceType === "USER" && operationType === "CREATE";
	const isDelete = resourceType === "USER" && operationType === "DELETE";
	const isRegister = eventType === "REGISTER";
	if (!isCreate && !isRegister && !isDelete) {
		return { handled: false, reason: "ignored-event-type" };
	}

	const representation =
		event.representation && typeof event.representation === "object"
			? event.representation
			: {};
	const keycloakUserId = getKeycloakUserIdFromEvent(event, representation);
	if (!keycloakUserId) {
		return { handled: false, reason: "missing-keycloak-user-id" };
	}

	let existingUid = parseInt(
		await db.getObjectField(KEYCLOAK_USER_MAP_HASH, keycloakUserId),
		10,
	);

	if (isDelete) {
		if (!(Number.isFinite(existingUid) && existingUid > 0)) {
			return {
				handled: true,
				action: "delete-no-linked-user",
				keycloakUserId,
			};
		}
		try {
			await user.deleteAccount(existingUid);
		} catch (err) {
			// Account may already be gone; still cleanup mapping.
			if (err && err.message !== "[[error:no-user]]") {
				throw err;
			}
		}
		await unlinkKeycloakUser(keycloakUserId);
		return {
			handled: true,
			action: "deleted-user",
			keycloakUserId,
			uid: existingUid,
		};
	}

	if (Number.isFinite(existingUid) && existingUid > 0) {
		return {
			handled: true,
			action: "already-linked",
			keycloakUserId,
			uid: existingUid,
		};
	}

	const username = String(representation.username || "").trim();
	const email = String(representation.email || "").trim();

	if (username) {
		existingUid = await user.getUidByUsername(username);
		if (existingUid) {
			await linkKeycloakToUser(keycloakUserId, existingUid);
			return {
				handled: true,
				action: "linked-by-username",
				keycloakUserId,
				uid: existingUid,
			};
		}
	}

	if (email) {
		existingUid = await user.getUidByEmail(email);
		if (existingUid) {
			await linkKeycloakToUser(keycloakUserId, existingUid);
			return {
				handled: true,
				action: "linked-by-email",
				keycloakUserId,
				uid: existingUid,
			};
		}
	}

	if (!username) {
		return {
			handled: false,
			reason: "missing-username-for-create",
			keycloakUserId,
		};
	}

	const uid = await user.create({
		username,
		email: email || undefined,
		password: randomPassword(),
	});
	await linkKeycloakToUser(keycloakUserId, uid);
	return { handled: true, action: "created-user", keycloakUserId, uid };
}

async function linkKeycloakToUser(keycloakUserId, uid) {
	await Promise.all([
		db.setObjectField(KEYCLOAK_USER_MAP_HASH, keycloakUserId, uid),
		user.setUserField(
			uid,
			"external-comments:keycloakUserId",
			keycloakUserId,
		),
	]);
}

function randomPassword() {
	return `Kc!${crypto.randomBytes(18).toString("hex")}aA1`;
}

function getKeycloakUserIdFromEvent(event, representation) {
	const resourcePath = String(event.resourcePath || "").trim();
	const match = resourcePath.match(/^users\/([^/]+)$/);
	if (match && match[1]) {
		return match[1];
	}

	const direct = String(
		representation.id ||
			event.userId ||
			(event.authDetails && event.authDetails.userId) ||
			"",
	).trim();
	if (direct) {
		return direct;
	}
	return "";
}

async function unlinkKeycloakUser(keycloakUserId) {
	await db.deleteObjectField(KEYCLOAK_USER_MAP_HASH, keycloakUserId);
}

function sanitizeHeaders(headers) {
	const clone = { ...headers };
	if (clone.cookie) {
		clone.cookie = "[redacted]";
	}
	if (clone.authorization) {
		clone.authorization = "[redacted]";
	}
	return clone;
}
