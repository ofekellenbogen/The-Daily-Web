// Moving weather ticker at the top of the home page (views/partials/weather.ejs).
//
// Responsibilities:
//   1. Loads the weather from GET /api/weather when the page opens (default: Tel Aviv) and turns
//      it into a row of short items (now, feels-like, high/low, rain, wind, humidity, hourly and
//      daily forecast).
//   2. Asks the reader for their location (browser permission prompt). If allowed, reloads the
//      weather for their area: GET /api/weather?lat=..&lon=.. (rounded to ~1 km); the server
//      answers with the reader's town name.
//   3. The items are added twice to the track; CSS moves the track so the loop never shows a gap
//      (see .weather-ticker__track in public.css).
//   4. The "refresh" button asks the server for fresh data (&refresh=true),
//      limited to one click every 3 seconds.
//   5. On failure an error message with a "retry" button replaces the moving items.
(function () {
  'use strict';

  // ===== Page elements =============================================================
  const byId = (id) => document.getElementById(id);
  const loadingEl = byId('weather-loading');
  const detailsEl = byId('weather-details');
  const errorEl = byId('weather-error');
  const errorMsgEl = byId('weather-error-msg');
  const trackEl = byId('weather-track');
  const refreshBtn = byId('weather-refresh');
  const retryBtn = byId('weather-retry');

  // If the ticker is not on the page, do nothing
  if (!loadingEl || !detailsEl || !errorEl || !trackEl) return;

  const REFRESH_THROTTLE_MS = 3000;
  // Reuse a location the browser found in the last 30 minutes; give up after 10 seconds.
  const GEOLOCATION_OPTIONS = { maximumAge: 30 * 60 * 1000, timeout: 10000 };

  let requestId = 0; // increases on every request; answers to older requests are ignored
  let lastRefreshClick = 0; // time (ms) of the last accepted refresh click
  let readerCoords = null; // { lat, lon } once the reader allows location access

  // ===== Formatting helpers ========================================================
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

  // ===== Building the ticker items =================================================
  // One ticker item: <li> with optional bold part, normal text and optional badge.
  function item({ strong, text, badge }) {
    const li = document.createElement('li');
    li.className = 'weather-ticker__item';
    if (strong) {
      const bold = document.createElement('strong');
      bold.textContent = strong;
      li.append(bold);
    }
    if (text) {
      const span = document.createElement('span');
      span.textContent = text;
      li.append(span);
    }
    if (badge) {
      const mark = document.createElement('span');
      mark.className = 'weather-ticker__badge';
      mark.textContent = badge;
      li.append(mark);
    }
    return li;
  }

  // The list of things to show, in reading order.
  function buildItems(weather) {
    const items = [
      { strong: `${weather.icon || '⛅'} ${degrees(weather.temperature)}`, text: weather.description || '' },
      { text: `מורגש כ-${degrees(weather.feelsLike ?? weather.temperature)}` },
      { text: `↑ ${degrees(weather.tempMax)}  ↓ ${degrees(weather.tempMin)}` },
      { text: `משקעים ${percent(weather.precipitation)}` },
      { text: `רוח ${weather.windSpeed ?? 0} קמ"ש` },
      { text: `לחות ${percent(weather.humidity)}` }
    ];
    // Upcoming hours, e.g. "18:00 🌙 22°"
    for (const hour of weather.hourly || []) {
      items.push({ strong: hour.time, text: `${hour.icon || ''} ${degrees(hour.temperature)}` });
    }
    // Next days, e.g. "יום ה׳ ⛅ 27° / 19°"
    for (const day of weather.daily || []) {
      items.push({ strong: formatDay(day.date), text: `${day.icon || ''} ${degrees(day.maxTemp)} / ${degrees(day.minTemp)}` });
    }
    // "stale" = the server couldn't reach the weather service and sent its last saved data.
    items.push({ text: `עודכן ${formatTime(weather.updatedAt)}`, badge: weather.stale ? 'נתונים שמורים' : '' });
    return items;
  }

  // One copy of the items as a <ul>. The second copy is hidden from screen readers
  // (it exists only for the visual loop), so they read the weather once.
  function group(items, isCopy) {
    const list = document.createElement('ul');
    list.className = 'weather-ticker__group';
    if (isCopy) list.setAttribute('aria-hidden', 'true');
    list.append(...items.map(item));
    return list;
  }

  // ===== Ticker states: loading / details / error ==================================
  function showLoading() {
    loadingEl.hidden = false;
    detailsEl.hidden = true;
    errorEl.hidden = true;
    if (refreshBtn) refreshBtn.disabled = true;
  }

  function showDetails(weather) {
    const cityEl = byId('weather-city');
    if (cityEl) cityEl.textContent = weather.city || '';

    const items = buildItems(weather);
    trackEl.replaceChildren(group(items, false), group(items, true));

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
  // /api/weather, plus ?lat=&lon= when the reader shared their location, plus ?refresh=true.
  function weatherUrl(forceRefresh) {
    const params = new URLSearchParams();
    if (readerCoords) {
      params.set('lat', readerCoords.lat);
      params.set('lon', readerCoords.lon);
    }
    if (forceRefresh) params.set('refresh', 'true');
    const query = params.toString();
    return query ? `/api/weather?${query}` : '/api/weather';
  }

  async function loadWeather(forceRefresh = false) {
    const currentRequest = ++requestId;
    // Show "loading" only when there is nothing on screen yet; otherwise keep the
    // current ticker moving until the new data arrives.
    if (detailsEl.hidden) showLoading();
    if (refreshBtn) refreshBtn.disabled = true;

    try {
      const response = await fetch(weatherUrl(forceRefresh), {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (!data.success || !data.weather) {
        throw new Error(data.message || 'נתוני מזג אוויר חסרים');
      }

      if (currentRequest === requestId) showDetails(data.weather);
    } catch (err) {
      if (currentRequest !== requestId) return; // a newer request is already running
      // The technical error goes to the console; the user sees a friendly Hebrew message.
      console.warn('[weather] client error fetching weather:', err.message);
      // Keep showing the previous weather if there is some; show the error only when there is none.
      if (detailsEl.hidden) showError('שירות מזג האוויר אינו זמין כעת. נסו שוב מאוחר יותר.');
      else if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  // Asks the browser for the reader's location (the browser shows a permission prompt).
  // If allowed, the weather is reloaded for their area. If refused or unavailable,
  // the ticker keeps showing the default location (Tel Aviv, marked "מיקום ברירת מחדל").
  function useReaderLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Rounded to ~1 km (2 decimals): enough to name the town, never the exact position.
        readerCoords = {
          lat: position.coords.latitude.toFixed(2),
          lon: position.coords.longitude.toFixed(2)
        };
        loadWeather(false);
      },
      () => { /* permission denied or no location: keep the default location */ },
      GEOLOCATION_OPTIONS
    );
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

  // Show weather immediately (default location), then switch to the reader's own area if allowed.
  loadWeather(false);
  useReaderLocation();
})();
