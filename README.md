# The Daily Web

A news site built with Node.js 20+, Express, EJS, MongoDB/Mongoose and vanilla JavaScript. The server follows MVC: models store data, controllers handle requests, services contain the application logic, and EJS views render HTML. No additional authentication or frontend libraries are needed.

## Install and run

```bash
npm install
cp .env.example .env
```

Set `MONGODB_URI` in `.env` to a running local MongoDB or Atlas database. Set `DEMO_PASSWORD` to a password of 8–256 characters, then run:

```bash
npm run seed:users  # create/update demo accounts without replacing articles
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
| POST | `/api/staff/articles` | Create an owned draft (reporter) |
| PATCH | `/api/staff/articles/:id` | Save content (owner or editor) |
| POST | `/api/staff/articles/:id/submit` | Submit an owned draft/returned article (reporter) |
| POST | `/api/staff/articles/:id/approve` | Publish a pending article (editor) |
| POST | `/api/staff/articles/:id/return` | Return a pending article with `{ "note": "..." }` (editor) |
| DELETE | `/api/staff/articles/:id` | Delete an article and related comments/statistics (editor) |

Create/save requests use JSON fields `title`, `summary`, `body`, `category`, and `imageUrl`. Guests receive `401` for protected API requests and are redirected to login for protected pages. Forbidden operations return `403`, invalid data `400`, missing articles `404`, and invalid workflow transitions `409`. Errors do not stop the server.

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
