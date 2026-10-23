# The Daily Web

A news site built with Node.js 20+, Express, EJS, MongoDB/Mongoose and vanilla JavaScript. The server follows MVC: models store data, controllers handle requests, services contain the application logic, and EJS views render HTML. No additional authentication or frontend libraries are needed.

## Shared database setup

For the team's MongoDB Atlas database, ask a teammate for `MONGODB_USERNAME`, `MONGODB_PASSWORD`, and the full `MONGODB_URI`, then fill in `.env`. The application connects using the full `MONGODB_URI`.

Existing shared database accounts do not require running a seed command. Only create/reset demo accounts when needed: set `DEMO_PASSWORD` and run `npm run seed:users`. This resets those demo accounts' passwords.

## Install and run

```bash
npm install
cp .env.example .env
```

Set `MONGODB_URI` in `.env` to a running local MongoDB or Atlas database, then start the server. If you need to create/reset demo accounts, first set `DEMO_PASSWORD` to 8–256 characters and run `npm run seed:users`.

```bash
npm start
```

Open http://localhost:3000. `PORT` defaults to `3000`; `MONGODB_DB` defaults to `daily-web`. Use `npm run dev` to restart automatically after code changes.

For the existing demo feed (520 articles, comments and view statistics), run `npm run seed:public`. It also seeds the users. Each seed command resets the demo accounts' passwords to the current `DEMO_PASSWORD`; `seed:public` also replaces their articles and related demo data. Keep `.env` out of Git.

## Login and permissions

Open `/login`. All demo accounts use the password you set in `DEMO_PASSWORD`:

| Role | Usernames | Access |
| --- | --- | --- |
| Guest | No login | Public feed, published articles and comments |
| Reporter | `dana.levi`, `yossi.cohen`, `maya.mizrahi`, `amir.peretz` | `/reporter`: create articles, edit their own articles and submit them for review |
| Editor | `editor` | `/editor`: view/edit all articles, approve publication, return with a note and delete |

Reporters cannot access another reporter's article or publish/delete content. While an article is pending review, its reporter cannot edit it. These rules are enforced on the server for both pages and API requests. Browser-supplied roles, author IDs and publication fields are rejected.

The workspace provides a basic article list and editing form. Save a draft, then submit it for review. The editor can save changes and approve or return a pending article. Editing published content keeps the last approved snapshot public until the next approval. Article saving is manual; automatic draft saving is not implemented yet.

Passwords are stored as salted, one-way `scrypt` hashes using Node's built-in `crypto` module. Login creates a random session token in an HttpOnly, SameSite=Lax cookie; only its SHA-256 hash and expiry are stored in MongoDB. Sessions last seven days and survive a server restart without a server-side secret or in-memory session store. Each request loads the user's current role from MongoDB. Logout deletes the session. Production uses Secure cookies, so set `NODE_ENV=production` when serving over HTTPS.

## Main routes

| Method | Route | Purpose |
| --- | --- | --- |
| GET / POST | `/login` | Login form / authenticate |
| POST | `/logout` | End the current session |
| GET | `/reporter`, `/editor` | Role-specific workspaces |
| GET | `/staff/articles/new`, `/staff/articles/:id` | Create / edit form |
| GET | `/api/staff/articles` | Article summaries, optional `status` and `page` (20 per page) |
| POST | `/api/staff/articles` | Create an owned draft (reporter) |
| PATCH | `/api/staff/articles/:id` | Save content (owner or editor) |
| POST | `/api/staff/articles/:id/submit` | Submit an owned draft/returned article (reporter) |
| POST | `/api/staff/articles/:id/approve` | Publish a pending article (editor) |
| POST | `/api/staff/articles/:id/return` | Return a pending article with `{ "note": "..." }` (editor) |
| DELETE | `/api/staff/articles/:id` | Delete an article and related comments/statistics (editor) |

Create/save requests use JSON fields `title`, `summary`, `body`, `category`, and `imageUrl`. Guests receive `401` for protected API requests and are redirected to login for protected pages. Forbidden operations return `403`, invalid data `400`, missing articles `404`, and invalid workflow transitions `409`. Errors do not stop the server.

## CRUD management

Editors can open **ניהול נתונים** (`/editor/data`) to create, list/search, edit and delete users,
comments and daily view statistics. Lists are paginated (20 per page). Search users by username/name,
comments by text/name, or statistics by article ID. The existing article workspace supplies article
CRUD, now with title search for owned drafts as well as the existing public title search.

REST endpoints: GET/POST `/api/admin/users|comments|stats`, GET/PATCH/DELETE
`/api/admin/:resource/:id`. Article read: GET `/api/staff/articles/:id` with ownership enforcement.
All admin endpoints require an authenticated editor and reject cross-origin requests.
Passwords are hashed and never returned. Changing a password invalidates that user's sessions.
Self-deletion/demotion is blocked. Users with articles cannot be deleted until those articles are
handled, avoiding orphaned ownership. Comments must reference an existing article.

View statistics creation accepts `{ articleId, dayUtc: 'YYYY-MM-DD', slot, count }`; update accepts
`{ slot, count }`. Slots are UTC five-minute buckets, 0–287. The UI uses date/time fields. Updating a
bucket adjusts the daily total atomically, including when visits arrive concurrently. Duplicate
username or article/day combinations return 409; malformed IDs, dates and input return 400.
Operational mutations are logged. The moderation endpoints do not expose device identifiers.

`npm test` exercises authenticated HTTP CRUD, role/origin restrictions, hashing, reference checks,
invalid input and bucket-total correction. Database calls are mocked in the unit suite.
Run `node scripts/verify/features.js crud` for live HTTP/MongoDB verification in an isolated temporary
database that is removed afterward; this also passed during implementation. This branch is independent
of `feature/issue-10-autosave`; merge both for both features.

## Project structure

```text
app.js                      Express setup and server startup
src/config/db.js            MongoDB connection
src/models/                 Users, sessions, articles, comments and view data
src/middleware/             Authentication, role checks, device IDs and errors
src/modules/auth/           Login, logout and persistent sessions
src/modules/staff/          Reporter/editor pages and protected article operations
src/modules/public/         Public feed and approved article pages
src/modules/comments/       Comments and rate limiting
src/modules/analytics/      View tracking
src/utils/                  Password hashing, cookies and ObjectId validation
views/                      Semantic Hebrew/RTL EJS pages and shared layout
public/css/, public/js/     Responsive styles and vanilla JavaScript/Ajax
scripts/seed/               Demo users and public content
tests/                      Node's built-in test runner
plan/                       Assignment PDF and team work plan
```

The public site includes feed search/filter/sort, infinite scrolling, server-rendered articles, comments, guest comment limits and view tracking. Public routes read only `publishedVersion`, never the working draft.

## Verification

```bash
npm test
```

Authentication/permissions tests exercise real HTTP routes with mocked MongoDB operations: wrong credentials, guest access, ownership, forged fields, editor actions, workflow validation, session expiry/logout and a new server instance reusing the persisted session. They do not require a database or change your `.env` database.

To check an actual restart locally: sign in, stop `npm start`, start it again and refresh `/reporter` or `/editor` in the same browser. The MongoDB session and cookie remain valid until logout or expiry.

## Reporter task coverage (issue #8)

The workspace shows all four workflow states and correction notes, lists only the signed-in reporter's articles, and supports draft creation, editing, submission, corrections/resubmission and editing a published article. The last approved snapshot stays public during draft edits and review. The server rejects another reporter's article, forged privileged fields, incomplete submissions and edits to pending articles.

Lists fetch 20 article summaries at a time through `GET /api/staff/articles?page=1` and the load-more button; full article bodies are loaded only for editing. Existing drafts save through Ajax without reloading. Creation and submission remain explicit actions. Automatic draft saving belongs to issue #10 and is not implemented here.

`npm test` covers ownership, all states, pagination, validation, corrections/resubmission, published snapshot preservation and Hebrew body size limits, with mocked MongoDB operations.

## Editor task coverage (issue #12)

`/editor` lists articles from every reporter and filters by all four workflow states. Filtering and loading the next 20 summaries use Ajax without reloading the page. The same filters work on the server and are validated there. Article list queries omit full bodies and use indexes for author, update time and workflow status.

Editors can read and edit submitted content, approve complete pending articles, return them with a required correction note, and delete an article with its related comments and view data. Other state transitions and reporter attempts to use editor operations are rejected on the server. The editing page labels the submitted/working content and shows the current approved title, summary, body, category, image and version separately. The public article page continues to show the approved snapshot through editing, submission and return, and switches only after approval. Creation, submission, approval, returns and deletion produce operational logs.

Tests cover every status filter, pagination, invalid transitions, empty-content approval, correction-note validation, the full published-update cycle through the public HTML route, and deletion. Database operations are mocked; a live MongoDB/browser demonstration is still needed before the defense. Autosave (#10), analytics (#13), user management CRUD and weather (#15) are separate tasks.
