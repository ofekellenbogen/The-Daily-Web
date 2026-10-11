require('dotenv').config();

const path = require('path');
const express = require('express');
const { connectDb } = require('./src/config/db');
const deviceId = require('./src/middleware/deviceId');
const { notFound, errorHandler } = require('./src/middleware/errors');
const publicRoutes = require('./src/modules/public/public.routes');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(express.static(path.join(__dirname, 'public')));
app.use(deviceId);

app.use(publicRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3000;

connectDb(process.env.MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  });
