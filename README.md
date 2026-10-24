# The Daily Web

A news site built with Node.js 20+, Express, EJS, MongoDB/Mongoose and vanilla JavaScript. The server follows MVC: models store data, controllers handle requests, services contain the application logic, and EJS views render HTML. No additional authentication or frontend libraries are needed.

## Automatic saving (issue #10)

The editing page saves on input/change without a Save click, using serialized PUT requests to
`/api/staff/drafts/:id`. A stable draft ID makes creation and retries idempotent. MongoDB is the
source for resuming a saved draft after refresh, server restart or on another computer.
The approved snapshot is never updated by autosave. Pending articles remain locked to reporters.
An account-scoped browser backup protects unsent text on the same computer; network failures show
an error and retry automatically. Closing while a request is pending triggers a browser warning.
Wait for “כל השינויים נשמרו” before switching computers: offline text cannot reach another device.
Submission waits for saving to finish and remains an explicit action.

Manual check: start a new article and type without clicking Save; wait for the saved indicator,
refresh, reopen from the workspace and sign in on another computer. Repeat on a published article,
checking that the public page retains its approved content. Disconnect networking, type, reconnect
and confirm the pending text is saved. `npm test` covers draft retries, permissions, review locks,
server restart and approved snapshot isolation with mocked persistence.
Run `node scripts/verify/features.js autosave` to repeat the live HTTP/MongoDB checks in an isolated
temporary database, removed afterward. Live verification passed, including reconnecting to persisted
draft/session data. CRUD and the article workspace redesign (#11) are separate pull requests.

## Shared database setup

For the team's MongoDB Atlas database, ask a teammate for `MONGODB_USERNAME`, `MONGODB_PASSWORD`, and the full `MONGODB_URI`, then fill in `.env`. The application connects using the full `MONGODB_URI`.

User accounts already exist in the shared database. Sign in with an existing account; editors can create and manage users through **ניהול משתמשים** (`/editor/users`). There is no user seed command or automatic account creation at startup.

## Install and run

```bash
npm install
cp .env.example .env
```

Set `MONGODB_URI` in `.env` to the MongoDB database containing your existing accounts, then start the server.

```bash
npm start
```

Open http://localhost:3000. `PORT` defaults to `3000`; `MONGODB_DB` defaults to `daily-web`. Use `npm run dev` to restart automatically after code changes.

For the demo feed (520 articles, comments and view statistics), run `npm run seed:public`. It uses existing reporter accounts named `dana.levi`, `yossi.cohen`, `maya.mizrahi`, or `amir.peretz`, and an existing editor. At least one of those reporters and one editor must exist. It replaces those reporters' articles and related demo data without creating or changing users or passwords. Keep `.env` out of Git.

## Login and permissions

Open `/login` and use your existing account's password. Editors can manage accounts and reset passwords through `/editor/users`.

| Role | Usernames | Access |
| --- | --- | --- |
| Guest | No login | Public feed, published articles and comments |
| Reporter | `dana.levi`, `yossi.cohen`, `maya.mizrahi`, `amir.peretz` | `/reporter`: create articles, edit their own articles and submit them for review |
| Editor | Any existing account with the editor role | `/editor`: view/edit all articles, approve publication, return with a note and delete |

Reporters cannot access another reporter's article or publish/delete content. While an article is pending review, its reporter cannot edit it. These rules are enforced on the server for both pages and API requests. Browser-supplied roles, author IDs and publication fields are rejected.

The workspace provides an article list and an editing form. Draft changes save automatically; submission
for review is explicit. Editing published content keeps the approved snapshot public until approval.
Reporter and editor workspaces share the home page's search controls: title searches update after a short typing pause, and status changes apply immediately without reloading. Search and status filters remain active when loading more articles.

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
| POST | `/api/staff/articles/:id/approve` | Publish a draft, pending or returned article (editor) |
| POST | `/api/staff/articles/:id/return` | Return a pending article with `{ "note": "..." }` (editor) |
| DELETE | `/api/staff/articles/:id` | Delete an article and related comments/statistics (editor) |

Create/save requests use JSON fields `title`, `summary`, `body`, `category`, and `imageUrl`. Guests receive `401` for protected API requests and are redirected to login for protected pages. Forbidden operations return `403`, invalid data `400`, missing articles `404`, and invalid workflow transitions `409`. Errors do not stop the server.

## CRUD management

Editors can open **ניהול משתמשים** (`/editor/users`) to create, list/search, edit and delete users.
Lists are paginated (20 per page), with search by username/name. The old `/editor/data` URL redirects
to user management. Editors delete comments directly beside each comment on its article page;
there is no additional comment/statistics management page. Existing REST APIs remain available.
The existing article workspace supplies article
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
scripts/seed/               Demo public content using existing accounts
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

Lists fetch 20 article summaries at a time through `GET /api/staff/articles?page=1`; full bodies load
only for editing. New and existing drafts save automatically through Ajax under issue #10.

`npm test` covers ownership, all states, pagination, validation, corrections/resubmission, published snapshot preservation and Hebrew body size limits, with mocked MongoDB operations.

## Editor task coverage (issue #12)

`/editor` lists articles from every reporter and filters by all four workflow states. Filtering and loading the next 20 summaries use Ajax without reloading the page. The same filters work on the server and are validated there. Article list queries omit full bodies and use indexes for author, update time and workflow status.

Editors can read and edit all articles and publish complete drafts, pending articles and returned articles directly, without reporter submission. Editing a published article creates a draft that the editor can publish as the next version. Editors can return pending articles with a required correction note and delete articles with their related comments and view data. Other state transitions and reporter attempts to use editor operations are rejected on the server. The editing page labels the submitted/working content and shows the current approved title, summary, body, category, image and version separately. The public article page continues to show the approved snapshot through editing, submission and return, and switches only after approval. Creation, submission, approval, returns and deletion produce operational logs.

Tests cover status filters, pagination, transitions, approval, corrections and the published-update
cycle. Autosave (#10) is included on this branch; CRUD management and weather remain separate tasks.
