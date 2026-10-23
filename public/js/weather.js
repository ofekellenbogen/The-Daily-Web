(function () {
  'use strict';

  const loadingEl = document.getElementById('weather-loading');
  const detailsEl = document.getElementById('weather-details');
  const errorEl = document.getElementById('weather-error');
  const errorMsgEl = document.getElementById('weather-error-msg');
  const tempEl = document.getElementById('weather-temp');
  const iconEl = document.getElementById('weather-icon');
  const descEl = document.getElementById('weather-desc');
  const cityEl = document.getElementById('weather-city');
  const windEl = document.getElementById('weather-wind');
  const updatedTimeEl = document.getElementById('weather-updated-time');
  const staleBadgeEl = document.getElementById('weather-stale-badge');
  const refreshBtn = document.getElementById('weather-refresh');
  const retryBtn = document.getElementById('weather-retry');

  // If widget is not on the page, do nothing
  if (!loadingEl || !detailsEl || !errorEl) return;

  let isFetching = false;
  let lastRefreshClick = 0;

  function formatTime(isoString) {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function showLoading() {
    loadingEl.hidden = false;
    detailsEl.hidden = true;
    errorEl.hidden = true;
    if (refreshBtn) refreshBtn.disabled = true;
  }

  function showDetails(weather) {
    if (tempEl) tempEl.textContent = weather.temperature;
    if (iconEl) iconEl.textContent = weather.icon || '⛅';
    if (descEl) descEl.textContent = weather.description || '';
    if (cityEl) cityEl.textContent = weather.city || 'תל אביב';
    if (windEl) windEl.textContent = `רוח: ${weather.windSpeed ?? 0} קמ"ש`;
    if (updatedTimeEl) {
      updatedTimeEl.textContent = formatTime(weather.updatedAt);
      updatedTimeEl.dateTime = weather.updatedAt || '';
    }
    if (staleBadgeEl) {
      staleBadgeEl.hidden = !weather.stale;
    }

    loadingEl.hidden = true;
    detailsEl.hidden = false;
    errorEl.hidden = true;
    if (refreshBtn) refreshBtn.disabled = false;
  }

  function showError(message) {
    if (errorMsgEl) {
      errorMsgEl.textContent = message || 'מידע מזג האוויר אינו זמין כעת';
    }
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
      const url = forceRefresh ? '/api/weather?refresh=true' : '/api/weather';
      const response = await fetch(url, {
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data.success || !data.weather) {
        throw new Error(data.message || 'נתוני מזג אוויר חסרים');
      }

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
      // Throttle refresh button clicks (3 seconds)
      if (now - lastRefreshClick < 3000) return;
      lastRefreshClick = now;
      loadWeather(true);
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      loadWeather(false);
    });
  }

  // Load weather initially
  loadWeather(false);
})();
