# The-Daily-Web

```bash
git clone https://github.com/ofekellenbogen/The-Daily-Web.git
cd The-Daily-Web
npm install
cp .env.example .env
npm start
```

Before running `npm start`, set these fields in `.env` (ask a teammate for the values):

| Field | Value |
| --- | --- |
| `MONGODB_USERNAME` | MongoDB Atlas database user |
| `MONGODB_PASSWORD` | Password of that database user |
| `MONGODB_URI` | The team's shared MongoDB Atlas connection string |

Open http://localhost:3000