# The Daily Web

News site using Express, EJS, MongoDB/Mongoose and vanilla JavaScript.

## Setup

```bash
npm install
cp .env.example .env
npm run seed:users
npm start
```

Set `MONGODB_URI` and an 8–256 character `DEMO_PASSWORD` in `.env` before seeding. `seed:users` creates/updates four reporter accounts (`dana.levi`, `yossi.cohen`, `maya.mizrahi`, `amir.peretz`) and `editor`, using that password. `npm run seed:public` also replaces demo content and resets demo passwords.

## Structure and authentication foundation

- `src/models/`: users, articles, comments, statistics and persistent sessions.
- `src/modules/auth/auth.service.js`: credential verification and MongoDB session creation, lookup and deletion.
- `src/middleware/auth.js`: load the current user, require login, check roles and reject cross-origin requests.
- `src/utils/`: salted scrypt password hashes, cookie reading and ID validation.
- `src/modules/public/`, `comments/`, `analytics/`: existing public news functionality.
- `views/`, `public/`: EJS pages, CSS and vanilla JavaScript.
- `scripts/seed/`: demonstration accounts and content.
- `tests/`: Node tests; run `npm test`.

Session cookies contain random tokens; MongoDB stores only their hashes and seven-day expirations. Sessions survive server restarts. The current user and role are loaded from MongoDB on each authenticated request. Production cookies use HTTPS (`NODE_ENV=production`). No dependencies were added.

This branch supplies the security foundation. The login page and staff workspaces are added by subsequent branches.
