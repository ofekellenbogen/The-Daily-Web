(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const loadingEl = $('weather-loading');
  const detailsEl = $('weather-details');
  const errorEl = $('weather-error');
  const errorMsgEl = $('weather-error-msg');
  const refreshBtn = $('weather-refresh');
  const retryBtn = $('weather-retry');

  // If the widget is not on the page, do nothing
  if (!loadingEl || !detailsEl || !errorEl) return;

  let isFetching = false;
  let lastRefreshClick = 0;

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDay(dateString) {
    if (!dateString) return '';
    const date = new Date(`${dateString}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('he-IL', { weekday: 'short' });
  }

  function degrees(value) {
    return typeof value === 'number' ? `${value}°` : '--';
  }

  function span(className, text) {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  }

  function renderHourly(items) {
    const list = $('weather-hourly');
    if (!list) return;
    list.replaceChildren(...(items || []).map((hour) => {
      const li = document.createElement('li');
      const icon = span('weather-card__row-icon', hour.icon || '');
      icon.title = hour.description || '';
      li.append(span('weather-card__row-label', hour.time), icon, span('weather-card__row-temp', degrees(hour.temperature)));
      return li;
    }));
  }

  function renderDaily(items) {
    const list = $('weather-daily');
    if (!list) return;
    list.replaceChildren(...(items || []).map((day) => {
      const li = document.createElement('li');
      const icon = span('weather-card__row-icon', day.icon || '');
      icon.title = day.description || '';
      const temps = span('weather-card__row-temps', '');
      temps.append(span('weather-card__row-temp', degrees(day.maxTemp)), span('weather-card__row-min', degrees(day.minTemp)));
      li.append(span('weather-card__row-label', formatDay(day.date)), icon, temps);
      return li;
    }));
  }

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
    setText('weather-feels', weather.feelsLike ?? weather.temperature);
    setText('weather-max', weather.tempMax ?? '--');
    setText('weather-min', weather.tempMin ?? '--');
    setText('weather-precip', typeof weather.precipitation === 'number' ? `${weather.precipitation}%` : '--');
    setText('weather-wind', `${weather.windSpeed ?? 0} קמ"ש`);
    setText('weather-humidity', typeof weather.humidity === 'number' ? `${weather.humidity}%` : '--');
    renderHourly(weather.hourly);
    renderDaily(weather.daily);

    const updatedTimeEl = $('weather-updated-time');
    if (updatedTimeEl) {
      updatedTimeEl.textContent = formatTime(weather.updatedAt);
      updatedTimeEl.dateTime = weather.updatedAt || '';
    }
    const staleBadgeEl = $('weather-stale-badge');
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

  async function loadWeather(forceRefresh = false) {
    if (isFetching) return;
    isFetching = true;
    showLoading();

    try {
      const response = await fetch(forceRefresh ? '/api/weather?refresh=true' : '/api/weather', {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (!data.success || !data.weather) throw new Error(data.message || 'נתוני מזג אוויר חסרים');

      showDetails(data.weather);
    } catch (err) {
      console.warn('[weather] client error fetching weather:', err.message);
      showError('שירות מזג האוויר אינו זמין כעת. נסו שוב מאוחר יותר.');
    } finally {
      isFetching = false;
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const now = Date.now();
      // Throttle refresh clicks (3 seconds)
      if (now - lastRefreshClick < 3000) return;
      lastRefreshClick = now;
      loadWeather(true);
    });
  }

  if (retryBtn) retryBtn.addEventListener('click', () => loadWeather(false));

  loadWeather(false);
})();
