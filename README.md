# The-Daily-Web

A news management and publishing system built with Node.js, Express, MongoDB (Mongoose), EJS and vanilla JavaScript.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- A MongoDB database: either a local MongoDB server or a MongoDB Atlas cluster

## Installation

```bash
git clone https://github.com/ofekellenbogen/The-Daily-Web.git
cd The-Daily-Web
npm install
```

## Configuration

Copy `.env.example` to `.env` in the project root and fill in the values:

```
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/daily-web
```

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB connection string (local or Atlas `mongodb+srv://...`) |
| `PORT` | No | Server port, defaults to `3000` |
| `MONGODB_DB` | No | Database name, defaults to `daily-web` |

`.env` contains secrets and is ignored by Git. Never commit it. Share it with teammates privately.

When using MongoDB Atlas, add your IP address under **Network Access** in Atlas, or the connection will time out.

## Load demo data

```bash
npm run seed:public
```

This creates demo users and 520 articles in different states and categories, plus comments and view statistics. Running it again replaces only the demo data.

## Run

```bash
npm start
```

Open http://localhost:3000.

During development, `npm run dev` restarts the server automatically when files change.

## Tests

```bash
npm test
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `MONGODB_URI is not set` | Create `.env` in the project root (see Configuration) |
| Server hangs or times out connecting to Atlas | Add your IP in Atlas **Network Access** |
| The site shows no articles | Run `npm run seed:public` against the same database that `.env` points to |
| `EADDRINUSE` | Port 3000 is in use: stop the other server or set a different `PORT` in `.env` |