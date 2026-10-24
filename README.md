# The Daily Web

A news publishing system: readers browse and comment on articles, reporters write them,
editors review, publish and analyze them.

Built only with technologies from the course: **Node.js, Express, MongoDB/Mongoose, EJS,
HTML5, CSS (Flexbox/Grid) and vanilla JavaScript (Ajax with `fetch`)**. The only extra
packages are `dotenv` (reads `.env`) and `chart.js` (the analytics graph, allowed by the spec).

---

## 1. Installation and running

Requirements: Node.js 20 or newer, and a MongoDB database (the team uses MongoDB Atlas).

```bash
npm install                 # install dependencies
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

Open `.env` and set `MONGODB_URI` (ask a teammate for the team's Atlas connection string).

```bash
npm start                   # start the server
npm run dev                 # or: start and restart automatically on code changes
npm test                    # run the automated tests (no database needed)
```

Open <http://localhost:3000>.

| Variable      | Required | Default     | Meaning                                         |
| ------------- | -------- | ----------- | ----------------------------------------------- |
| `MONGODB_URI` | yes      |             | MongoDB connection string                       |
| `MONGODB_DB`  | no       | `daily-web` | Database name                                   |
| `PORT`        | no       | `3000`      | HTTP port                                       |
| `NODE_ENV`    | no       |             | `production` makes cookies HTTPS-only           |

### Accounts

User accounts already exist in the shared database. Log in at
`/login`. Editors can create users and reset passwords at **ניהול משתמשים** (`/editor/users`).

| Role     | Example usernames                                         | Lands on    |
| -------- | --------------------------------------------------------- | ----------- |
| Guest    | (no login)                                                | `/`         |
| Reporter | `dana.levi`, `yossi.cohen`, `maya.mizrahi`, `amir.peretz` | `/reporter` |
| Editor   | any account with the `editor` role                        | `/editor`   |

**Using your own empty database?** There is no sign-up page, so create the first editor from the
project folder (change the three values; the password needs 8+ characters), then log in and create
the other users from **ניהול משתמשים**:

```bash
node -e "require('dotenv').config(); const m=require('mongoose'); const U=require('./src/models/User'); const {hashPassword}=require('./src/utils/password'); (async()=>{ await m.connect(process.env.MONGODB_URI,{dbName:process.env.MONGODB_DB||'daily-web'}); await U.create({username:'editor',displayName:'Editor',role:'editor',passwordHash:await hashPassword('change-me-123')}); await m.disconnect(); })()"
```

---

## 2. Project structure

The server follows **MVC**. A request always flows the same way:

```text
browser ──► route ──► middleware (login / role check) ──► controller ──► service ──► model ──► MongoDB
                                                              │
                                                              └──► EJS view (HTML)  or  JSON (Ajax)
```

* **Routes** list the URLs and which permissions each needs.
* **Controllers** are thin: read the request, call a service, send HTML or JSON.
* **Services** contain all the business rules (validation, permissions, workflow).
* **Models** define the MongoDB collections (Mongoose schemas).
* **Views** are EJS templates rendered on the server.

```text
app.js                          Express setup: middleware order, routes, start the server
package.json                    Dependencies and npm scripts (start, dev, test)
.env.example                    Template for the environment variables (copy to .env)

src/
  config/database.js            Connects to MongoDB
  models/                       Mongoose schemas (the "M" in MVC)
    User.js                       reporters and editors (password stored as a hash)
    Article.js                    workingCopy + publishedVersion + workflow status
    Comment.js                    reader comments
    ViewStats.js                  view counts per article per day, in 5-minute buckets
    ArticleSeen.js                which device already opened which article ("seen" filter)
    Session.js                    login sessions (kept in MongoDB, survive restarts)
    CommentRateLimit.js           recent comment times per device (spam limit)
  routes/                       URL -> middleware -> controller
    public.routes.js              home, article page, comments (guests)
    auth.routes.js                login / logout
    staff.routes.js               reporter and editor workspace + article API
    analytics.routes.js           Impact Analytics (editors)
    admin.routes.js               user / comment / stats management (editors)
    weather.routes.js             weather ticker API
  controllers/                  Request handlers (the "C" in MVC), one per area
  services/                     Business logic
    feed.service.js               home feed: search, filters, sorting, infinite scroll
    article.service.js            loads a published article for the public page
    articleImage.service.js       placeholder image and generated SVG illustrations
    comment.service.js            list / create comments
    commentRateLimit.service.js   max 3 comments per minute per device
    viewTracking.service.js       counts views, "seen" marks, popularity totals
    staff.service.js              article workflow: create, autosave, submit, approve, return, delete
    analytics.service.js          data for the views-over-time graph
    admin.service.js              CRUD for users, comments and view statistics
    auth.service.js               login check, sessions
    weather.service.js            Open-Meteo client with a 5-minute cache per area
    location.service.js           reader's location and town name (default: Tel Aviv)
  middleware/
    auth.js                       loadUser, requireAuth, requireRole, sameOrigin (CSRF)
    deviceId.js                   anonymous device cookie for guests
    errorHandler.js               404 + central error handler (server never crashes)
  utils/
    HttpError.js                  error with an HTTP status and a Hebrew message
    validation.js                 ObjectId / page checks, safe regex search
    password.js                   scrypt password hashing
    cookies.js                    reads a cookie from the request
    logger.js                     logs to the console and to logs/app.log

views/                          EJS templates (the "V" in MVC), Hebrew, right-to-left
  public/home.ejs                 home page: weather ticker + news feed
  public/article.ejs              full article (rendered on the server for SEO) + comments
  auth/login.ejs                  login form
  staff/workspace.ejs             reporter / editor article list
  staff/article-editor.ejs        create / edit an article
  staff/analytics.ejs             Impact Analytics page
  staff/users.ejs                 user management
  partials/                       shared header, footer, <head>, comments, weather ticker
  error.ejs                       error page

public/                         Static files sent to the browser as-is
  css/                            base.css (shared), public.css (site), staff.css (staff area)
  js/feed.js                      home: search, filters, sort, infinite scroll (Ajax)
  js/comments.js                  add / load comments without reloading
  js/workspace.js                 staff article list: search, status filter, load more
  js/article-editor.js            autosave, workflow buttons, image preview
  js/analytics.js                 article picker and Chart.js graph
  js/users.js                     user management table and form
  js/weather.js                   moving weather ticker
  images/                         placeholder article image

tests/                          Automated tests (Node's built-in test runner, MongoDB is mocked)
plan/                           Assignment PDF and the team's work split (workplan.md)
logs/                           app.log, created when the server runs (ignored by Git)
```

---

## 3. Features

Summary: readers (guests) browse a searchable, infinitely scrolling news feed, read articles and
comment; reporters write articles that autosave and go through an editor's approval; editors
review, publish, edit and delete articles, manage users, comments and statistics, and follow the
**Impact Analytics** graph; a weather ticker shows local weather. The details follow.

### Home page – news feed (`/`)
* Only **published** articles are shown (the query reads `publishedVersion` only).
* **Infinite scroll**: 20 more articles load automatically near the bottom of the page
  (`IntersectionObserver` + `GET /api/articles`).
* **Search** by title, **filter** by category and seen/unseen, **sort** by publish date or popularity.
  Everything updates with Ajax, without reloading the page.
* Each card shows title, image, summary, category, reporter and publish date.
* Pagination uses a **cursor** (the last article shown), which stays fast with thousands of
  articles. Popularity sorting saves the ordered list for 10 minutes, so pages don't shuffle
  while view counts change.

### Article page (`/articles/:id`)
* Title, reporter, category, publish date, main image and the full text.
* The full article is in the **first HTML response** (EJS), so search engines can read it without JavaScript.
* Comments: the list plus a form. A new comment appears immediately (Ajax), without reloading the list.
  Guests can type any name (left empty it becomes "אורח"); a logged-in reporter or editor always
  comments under their own display name (the field is read-only and the server enforces it).
* **Every visit is counted** as a view for the statistics.

### Comment limit (spam protection)
* A guest can post at most **3 comments per minute per device** (a random id in an HttpOnly cookie).
* The check runs on the server as one atomic MongoDB update, so parallel requests can't bypass
  it, and it survives a server restart. Exceeding it returns **429** with a Hebrew message.

### Login and permissions
* Three roles: **guest**, **reporter**, **editor**. Reporters and editors log in with username + password.
* Passwords are stored as **salted scrypt hashes** (Node's `crypto`); they can't be reversed.
* Login creates a random token in an **HttpOnly cookie**; only its SHA-256 hash is stored in the
  `sessions` collection. Sessions are in MongoDB, so **after a server restart users stay logged in**.
* The role is always read from the database, never from the browser.
* **Every permission is checked on the server** (`middleware/auth.js` + `staff.service.js`).
  Guests get 401 (API) or a redirect to `/login`; forbidden actions get 403.
* Cross-site requests are rejected (`sameOrigin`), and cookies use `SameSite=Lax`.

### Reporter area (`/reporter`)
* Shows only the reporter's own articles and their state: בהכנה, ממתינה לאישור עורך, פורסמה, הוחזרה לתיקונים.
* Create an article, edit own drafts, submit for review, see the editor's note, fix and resubmit,
  and edit an already published article.

### Workflow (article states)

```text
new ──► draft ──submit──► pending ──approve──► published
          ▲                  │                    │
          │           return + note               │ (edit)
          │                  ▼                    │
          │              returned ──submit──► pending
          └────────────────────────────────────────┘
```

* A reporter may only move **their own** article from draft/returned to pending.
* An editor may approve (publish) or return a pending article with a required note. Only a
  **pending** article can be published; an editor who edits a draft (for example an update to a
  published article) first sends it to pending with the same "send for approval" button.
* Any other transition returns **409**. A reporter can't edit while the article is pending.

### Continuous saving (autosave)
* The editor form saves automatically on every change (`PUT /api/staff/articles/:id`), no Save click needed.
* A new article's id is generated in the browser, so retries never create duplicates.
* Until the server confirms, the text is also kept in `localStorage`; it is resent when the
  network returns. The browser warns before closing with unsaved changes.
* Reopening the article (after refresh, browser restart or on another computer) loads the
  latest version from MongoDB.

### Editing a published article
* Every article stores `workingCopy` (being edited) and `publishedVersion` (what readers see).
* Edits only change `workingCopy`, so **readers keep seeing the approved version**, even while
  the edit is pending review. Only approval copies the new content into `publishedVersion`
  (as version 2, 3, …).
* While an update is in progress, the workspace list and the editor page mark the article as
  still live ("מפורסמת באתר"), so it's clear readers still see the approved version.

### Editor area (`/editor`)
* All articles from all reporters, filtered by state and searched by title (Ajax).
* Read and edit any article, approve and publish, return with a note, delete
  (also deletes its comments and statistics).
* For an update to a published article, the editor page shows **the current published version**
  next to **the new content**.

### Impact Analytics (`/editor/analytics`)
* Pick a published article and a date range (1–31 days); a **Chart.js** line graph shows views over time.
* Vertical markers show each moment an editor **published an update** (v1, v2, …), so you can compare
  views before and after.
* **Storage design for thousands of readers:** instead of one document per view, there is one
  `ViewStats` document per article per day with 288 five-minute counters. Each view is a single
  atomic `$inc`, so simultaneous views are never lost and the collection stays small.

### CRUD for all models
| Model            | Create / Read (list + search) / Update / Delete                                         |
| ---------------- | --------------------------------------------------------------------------------------- |
| Articles         | `/api/staff/articles` (+ editor UI). Search by title.                                   |
| Users            | `/api/admin/users` + **ניהול משתמשים** page. Search by username/name.                   |
| Comments         | `/api/admin/comments`, public create; editors delete from the article page.             |
| View statistics  | `/api/admin/stats`. Search by article id.                                               |

### Weather ticker
* A **moving ticker** at the top of the home page (between the site header and "החדשות האחרונות"),
  using **Open-Meteo** (free, no API key or credit card). It shows current conditions, the next hours and
  the next days; it pauses on hover and stays still for users who prefer reduced motion.
* **Location:** the browser asks the reader for permission to use their location.
  * **Found:** the ticker shows the reader's own town, e.g. "באר-שבע, ישראל". The browser sends
    coordinates rounded to ~1 km (never the exact position); the town name comes from OpenStreetMap's
    free **Nominatim** reverse-geocoding service (each ~1 km cell is looked up once and remembered;
    requests are spaced 1 second apart as its rules require).
  * **Not found** (permission refused or not supported): Tel Aviv is shown, marked
    "תל אביב-יפו (מיקום ברירת מחדל)". This is also shown for the moment before the reader answers.
* The **server** calls Open-Meteo at most once every 5 minutes **per ~10 km area** and shares that
  cached result with every reader in the area, so thousands of readers cause only a few external
  requests. The page reloads the weather by itself every 5 minutes (the browser doesn't cache the
  answer), so what is on screen is never more than 15 minutes old. If the service fails, the last
  data is still shown while it is under 15 minutes old (the server serves it up to 10 minutes,
  + 5 until the next reload); after that a friendly message is shown - the rest of the site keeps working.

### Errors, validation, performance and logs
* All input is validated on the server (and the browser). Invalid data returns **400**, unknown
  ids **404**, forbidden **403**, wrong workflow step **409**. One central error handler means
  bad requests never crash the server.
* Indexes on every list/sort/filter field and cursor pagination keep the site fast with thousands of articles.
* Errors and important events (logins, create / submit / approve / return / delete, admin changes)
  are written to the console and to **`logs/app.log`** (ignored by Git).
  Both outputs use UTC timestamps, `INFO` / `WARN` / `ERROR`, descriptive messages and
  named context fields (such as `articleId`, `actorId`, `status` and `revision`).
  Login rejections and location-name fallback use `WARN`; unexpected failures include
  error details. Ordinary autosaves stay quiet unless they reopen a published article.
  Log context excludes passwords, session tokens and request bodies. For example:

  ```text
  2026-10-24T14:00:00.000Z INFO [articles] Article submitted for editor review | articleId="123" actorId="456" status="pending" revision="2"
  ```

### Responsive, semantic UI
* HTML5 semantic tags (`header`, `nav`, `main`, `article`, `section`, `aside`, `footer`, `time`),
  Hebrew right-to-left layout, and Flexbox/Grid with media queries for desktop, tablet and mobile.

---

## 4. Main routes

| Method | Route | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/` | all | Home page |
| GET | `/api/articles` | all | Feed page (`q`, `category`, `seen`, `sort`, `cursor`) |
| GET | `/articles/:id` | all | Article page |
| GET / POST | `/api/articles/:id/comments` | all | List / add comments |
| GET | `/api/weather` | all | Weather data (optional `lat`, `lon` of the reader) |
| GET / POST | `/login` | all | Login form / log in |
| POST | `/logout` | logged in | Log out |
| GET | `/reporter`, `/editor` | reporter / editor | Workspaces |
| GET | `/staff/articles/new`, `/staff/articles/:id` | staff | Editor page |
| GET / POST | `/api/staff/articles` | staff | List (`status`, `q`, `page`) / create |
| GET / PUT / PATCH | `/api/staff/articles/:id` | owner or editor | Read / autosave / update |
| DELETE | `/api/staff/articles/:id` | editor | Delete |
| POST | `/api/staff/articles/:id/submit` | reporter (owner) / editor | Send for review |
| POST | `/api/staff/articles/:id/approve` | editor | Publish |
| POST | `/api/staff/articles/:id/return` | editor | Return with `{ note }` |
| GET | `/editor/analytics`, `/api/analytics/articles[/:id]` | editor | Impact Analytics |
| GET | `/editor/users` | editor | User management page |
| GET / POST | `/api/admin/:resource` | editor | List / create (`users`, `comments`, `stats`) |
| GET / PATCH / DELETE | `/api/admin/:resource/:id` | editor | Read / update / delete |

---

## 5. Tests

`npm test` runs the tests in `tests/` with Node's built-in runner. MongoDB calls are mocked, so no
database is needed and your data is never changed. They cover login and sessions (including a
"server restart"), permissions and ownership, the full workflow, autosave, the published-version
snapshot, feed search/filter/sort/pagination, comments and the rate limit, analytics, admin CRUD,
the weather cache, and the browser scripts.

To check a real restart manually: log in, stop the server, start it again and refresh the
page - you are still logged in.

---

## 6. Team

The work split is in [plan/workplan.md](plan/workplan.md); every feature was developed in its own
branch and merged into `dev` through a pull request.
