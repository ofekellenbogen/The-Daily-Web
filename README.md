# The Daily Web

News site using Express, EJS, MongoDB/Mongoose and vanilla JavaScript.

## Shared database setup

For the team's MongoDB Atlas database, ask a teammate for `MONGODB_USERNAME`, `MONGODB_PASSWORD`, and the full `MONGODB_URI`, then fill in `.env`. The application connects using the full `MONGODB_URI`.

Existing shared database accounts do not require running a seed command. Only create/reset demo accounts when needed: set `DEMO_PASSWORD` and run `npm run seed:users`. This resets those demo accounts' passwords.

## Setup

```bash
npm install
cp .env.example .env
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

## Login page

Open `/login` and use a seeded username and `DEMO_PASSWORD`. `POST /login` verifies credentials and redirects reporters to `/reporter` and editors to `/editor`; those destinations are implemented in the following workspace branches. `POST /logout` deletes the session. The semantic Hebrew/RTL form shows validation errors and works without JavaScript. The shared header displays login/logout links.

## Reporter workspace

`/reporter` lists the current reporter's articles. `/staff/articles/new` creates a draft; `/staff/articles/:id` edits an owned article. JSON endpoints under `/api/staff/articles` support POST creation, PATCH saving and POST `/:id/submit`. Content fields are `title`, `summary`, `body`, `category`, `imageUrl`; forged author, role or publication fields are rejected. Pending articles cannot be edited by their reporter. Saving is manual. Published snapshots remain unchanged while editing. All staff routes require a reporter, and ownership is checked on the server. Editor review is added in the following branch.

## Reporter task coverage (issue #8)

The workspace shows all four workflow states and correction notes, lists only the signed-in reporter's articles, and supports draft creation, editing, submission, corrections/resubmission and editing a published article. The last approved snapshot stays public during draft edits and review. The server rejects another reporter's article, forged privileged fields, incomplete submissions and edits to pending articles.

Lists fetch 20 article summaries at a time through `GET /api/staff/articles?page=1` and the load-more button; full article bodies are loaded only for editing. Existing drafts save through Ajax without reloading. Creation and submission remain explicit actions. Automatic draft saving belongs to issue #10 and is not implemented here.

`npm test` covers ownership, all states, pagination, validation, corrections/resubmission, published snapshot preservation and Hebrew body size limits, with mocked MongoDB operations.
