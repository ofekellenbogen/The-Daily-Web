// Entry point: builds the Express app and starts the server.
//
// A request passes through these steps, in order:
//   1. static files (CSS, client JS, images)
//   2. body parsers (JSON / HTML forms)
//   3. deviceId  - anonymous id cookie for guests
//   4. loadUser  - finds the logged-in user from the session cookie
//   5. routes    - route -> controller -> service -> model (MVC)
//   6. notFound / errorHandler - every error becomes a proper response; the server never crashes
require('dotenv').config(); // loads .env into process.env

const path = require('path');
const express = require('express');
const { connectDatabase } = require('./src/config/database');
const deviceId = require('./src/middleware/deviceId');
const { loadUser } = require('./src/middleware/auth');
const { notFound, errorHandler } = require('./src/middleware/errorHandler');

const authRoutes = require('./src/routes/auth.routes');
const publicRoutes = require('./src/routes/public.routes');
const staffRoutes = require('./src/routes/staff.routes');
const analyticsRoutes = require('./src/routes/analytics.routes');
const adminRoutes = require('./src/routes/admin.routes');
const weatherRoutes = require('./src/routes/weather.routes');
const logger = require('./src/utils/logger');

const app = express();

// Views are EJS templates in /views.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by'); // don't advertise that the server runs Express

// 1. Static files from /public, plus Chart.js served straight from node_modules.
app.use(express.static(path.join(__dirname, 'public')));
app.get('/vendor/chart.js', (req, res) => {
  res.sendFile(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'));
});

// 2. Parse request bodies, with size limits so huge requests are rejected.
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// 3-4. Identify the device and the logged-in user.
app.use(deviceId);
app.use(loadUser);

// The current path is used by the header to highlight the active navigation link.
app.use((req, res, next) => {
  res.locals.currentPath = req.path.replace(/\/+$/, '') || '/';
  next();
});

// 5. Routes
app.use(authRoutes);
app.use(publicRoutes);
app.use(staffRoutes);
app.use(analyticsRoutes);
app.use(adminRoutes);
app.use(weatherRoutes);

// 6. Errors (must be last)
app.use(notFound);
app.use(errorHandler);

// Start the server only when run directly (`node app.js`). Tests import `app` without starting it.
if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;

  connectDatabase(process.env.MONGODB_URI)
    .then(() => {
      app.listen(PORT, () => logger.info(`[server] listening on http://localhost:${PORT}`));
    })
    .catch((err) => {
      logger.error('[server] failed to start:', err.message);
      process.exitCode = 1;
    });
}

module.exports = app;
