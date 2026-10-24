// Weather widget on the home page (views/public/home.ejs).
//
// Responsibilities:
//   1. Loads the current weather from GET /api/weather when the page opens and shows
//      the main card, an hourly list and a daily forecast.
//   2. The "refresh" button asks the server for fresh data (GET /api/weather?refresh=true),
//      limited to one click every 3 seconds.
//   3. On failure an error box with a "retry" button is shown instead of the card.
(function () {
  'use strict';

  // ===== Page elements =============================================================
  const byId = (id) => document.getElementById(id);
  const loadingEl = byId('weather-loading');
  const detailsEl = byId('weather-details');
  const errorEl = byId('weather-error');
  const errorMsgEl = byId('weather-error-msg');
  const refreshBtn = byId('weather-refresh');
  const retryBtn = byId('weather-retry');

  // If the widget is not on the page, do nothing
  if (!loadingEl || !detailsEl || !errorEl) return;

  const REFRESH_THROTTLE_MS = 3000;

  let isFetching = false; // prevents two requests at the same time
  let lastRefreshClick = 0; // time (ms) of the last accepted refresh click

  // ===== Formatting helpers ========================================================
  // Sets the text of an element, if it exists on the page.
  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  // "2026-10-24T12:00:00Z" -> "15:00" (local time). Invalid input gives ''.
  function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  // "2026-10-25" -> short Hebrew weekday name.
  function formatDay(dateString) {
    if (!dateString) return '';
    // Noon avoids the date moving to the previous/next day because of the time zone.
    const date = new Date(`${dateString}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('he-IL', { weekday: 'short' });
  }

  function degrees(value) {
    return typeof value === 'number' ? `${value}°` : '--';
  }

  function percent(value) {
    return typeof value === 'number' ? `${value}%` : '--';
  }

  function span(className, text) {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  }

  // Weather icon (emoji) with the description as a tooltip.
  function iconSpan(item) {
    const icon = span('weather-card__row-icon', item.icon || '');
    icon.title = item.description || '';
    return icon;
  }

  // ===== Rendering =================================================================
  function renderHourly(items) {
    const list = byId('weather-hourly');
    if (!list) return;

    const rows = (items || []).map((hour) => {
      const li = document.createElement('li');
      li.append(
        span('weather-card__row-label', hour.time),
        iconSpan(hour),
        span('weather-card__row-temp', degrees(hour.temperature))
      );
      return li;
    });
    list.replaceChildren(...rows);
  }

  function renderDaily(items) {
    const list = byId('weather-daily');
    if (!list) return;

    const rows = (items || []).map((day) => {
      const li = document.createElement('li');
      const icon = iconSpan(day);
      const temps = span('weather-card__row-temps', '');
      temps.append(
        span('weather-card__row-temp', degrees(day.maxTemp)),
        span('weather-card__row-min', degrees(day.minTemp))
      );
      li.append(span('weather-card__row-label', formatDay(day.date)), icon, temps);
      return li;
    });
    list.replaceChildren(...rows);
  }

  // ===== Widget states: loading / details / error ==================================
  function showLoading() {
    loadingEl.hidden = false;
    detailsEl.hidden = true;
    errorEl.hidden = true;
    if (refreshBtn) refreshBtn.disabled = true;
  }

  function showDetails(weather) {
    setText('weather-city', weather.city || 'רעננה, ישראל');
    setText('weather-temp', weather.temperature);
    setText('weather-icon', weather.icon || '⛅');
    setText('weather-desc', weather.description || '');
    // "??" keeps a real 0 value and falls back only when the value is missing.
    setText('weather-feels', weather.feelsLike ?? weather.temperature);
    setText('weather-max', weather.tempMax ?? '--');
    setText('weather-min', weather.tempMin ?? '--');
    setText('weather-precip', percent(weather.precipitation));
    setText('weather-wind', `${weather.windSpeed ?? 0} קמ"ש`);
    setText('weather-humidity', percent(weather.humidity));
    renderHourly(weather.hourly);
    renderDaily(weather.daily);

    const updatedTimeEl = byId('weather-updated-time');
    if (updatedTimeEl) {
      updatedTimeEl.textContent = formatTime(weather.updatedAt);
      updatedTimeEl.dateTime = weather.updatedAt || '';
    }
    // "stale" = the server couldn't reach the weather service and sent its last saved data.
    const staleBadgeEl = byId('weather-stale-badge');
    if (staleBadgeEl) staleBadgeEl.hidden = !weather.stale;

    loadingEl.hidden = true;
    detailsEl.hidden = false;
    errorEl.hidden = true;
    if (refreshBtn) refreshBtn.disabled = false;
  }

  function showError(message) {
    if (errorMsgEl) errorMsgEl.textContent = message || 'מידע מזג האוויר אינו זמין כעת';
    loadingEl.hidden = true;
    detailsEl.hidden = true;
    errorEl.hidden = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }

  // ===== Loading the weather =======================================================
  async function loadWeather(forceRefresh = false) {
    if (isFetching) return;
    isFetching = true;
    showLoading();

    try {
      const url = forceRefresh ? '/api/weather?refresh=true' : '/api/weather';
      const response = await fetch(url, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (!data.success || !data.weather) {
        throw new Error(data.message || 'נתוני מזג אוויר חסרים');
      }

      showDetails(data.weather);
    } catch (err) {
      // The technical error goes to the console; the user sees a friendly Hebrew message.
      console.warn('[weather] client error fetching weather:', err.message);
      showError('שירות מזג האוויר אינו זמין כעת. נסו שוב מאוחר יותר.');
    } finally {
      isFetching = false;
    }
  }

  // ===== Buttons ===================================================================
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const now = Date.now();
      // Throttle refresh clicks (3 seconds)
      if (now - lastRefreshClick < REFRESH_THROTTLE_MS) return;
      lastRefreshClick = now;
      loadWeather(true);
    });
  }

  if (retryBtn) retryBtn.addEventListener('click', () => loadWeather(false));

  loadWeather(false);
})();
