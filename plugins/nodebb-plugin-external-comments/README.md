# nodebb-plugin-external-comments

NodeBB plugin: topic is created by service user, comments are created by authenticated NodeBB user (`req.uid`).

## Settings

- `serviceUid`: uid of service user (for topic creation)
- `categoryId`: category where topics are created

ACP page: `/admin/plugins/external-comments`

## API

- `GET /api/comments/:externalId` -> `{ exists, tid }`
- `POST /api/comments/:externalId/comment` with `{ content, toPid }`
  - requires logged-in user
  - creates topic from `serviceUid` if needed
  - creates reply from `req.uid`
  - response format matches NodeBB Write API envelope (`status` + `response`)

## Standard NodeBB API usage

Use plugin API only to resolve/create thread by `externalId`, then use NodeBB core API by `tid`:

1. `GET /api/comments/:externalId` -> get `{ exists, tid }`
2. Read topic/comments via core read API (e.g. `GET /api/topic/:tid`)
3. Reply via core write API (`POST /api/v3/topics/:tid`)

## Mapping and lock

- mapping: `externalId -> tid` in `plugin:external-comments:external-to-tid`
- lock key: `locks` hash field `plugin:external-comments:external:<externalId>`
