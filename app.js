require('dotenv').config();

const path = require('path');
const express = require('express');
const { connectDb } = require('./src/config/db');
const deviceId = require('./src/middleware/deviceId');
const { notFound, errorHandler } = require('./src/middleware/errors');
const publicRoutes = require('./src/modules/public/public.routes');
const commentRoutes = require('./src/modules/comments/comments.routes');
const authRoutes = require('./src/modules/auth/auth.routes');
const staffRoutes = require('./src/modules/staff/staff.routes');
const analyticsRoutes = require('./src/modules/analytics/analytics.routes');
const weatherRoutes = require('./src/modules/weather/weather.routes');
const { loadUser } = require('./src/middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(express.static(path.join(__dirname, 'public')));
app.get('/vendor/chart.js', (req, res) => {
  res.sendFile(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'));
});
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(deviceId);
app.use(loadUser);
app.use((req, res, next) => {
  res.locals.currentPath = req.path.replace(/\/+$/, '') || '/';
  next();
});

app.use(authRoutes);
app.use(staffRoutes);
app.use(analyticsRoutes);
app.use(weatherRoutes);
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
