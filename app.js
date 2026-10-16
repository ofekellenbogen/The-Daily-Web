require('dotenv').config();

const path = require('path');
const express = require('express');
const { connectDb } = require('./src/config/db');
const deviceId = require('./src/middleware/deviceId');
const { notFound, errorHandler } = require('./src/middleware/errors');
const publicRoutes = require('./src/modules/public/public.routes');
const commentRoutes = require('./src/modules/comments/comments.routes');
const { loadUser } = require('./src/middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10kb' }));
app.use(deviceId);
app.use(loadUser);

app.use(publicRoutes);
app.use(commentRoutes);

app.use(notFound);
app.use(errorHandler);

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;

  connectDb(process.env.MONGODB_URI)
    .then(() => {
      app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
    })
    .catch((err) => {
      console.error('[server] failed to start:', err.message);
      process.exitCode = 1;
    });
}

module.exports = app;
