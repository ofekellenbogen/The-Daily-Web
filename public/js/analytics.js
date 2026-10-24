// Article analytics page (views/staff/analytics.ejs).
//
// Responsibilities:
//   1. Article search - an accessible "combobox": typing searches published articles
//      (GET /api/analytics/articles?q=...) and shows up to 20 suggestions that can be
//      chosen with the mouse or the keyboard (arrows, Enter, Escape).
//   2. Date range - the user picks a range of 1 to 31 days (default: the last 7 days).
//   3. Report - loads the views of the chosen article
//      (GET /api/analytics/articles/:id?start=...&end=...) and draws a Chart.js line chart,
//      with a dashed vertical line for every publication / version update.
//
// Older requests are cancelled with AbortController, so a slow old response can never
// overwrite the result of a newer search or report.
(() => {
  // ===== Page elements =============================================================
  const form = document.getElementById('analytics-filter');
  const articleInput = document.getElementById('analytics-article');
  const suggestions = document.getElementById('analytics-suggestions');
  const searchStatus = document.getElementById('analytics-search-status');
  const startInput = document.getElementById('analytics-start');
  const endInput = document.getElementById('analytics-end');
  const submitButton = document.getElementById('analytics-submit');
  const statusText = document.getElementById('analytics-status');
  const resultSection = document.getElementById('analytics-result');

  // ===== Formatting and constants ==================================================
  const numberFormat = new Intl.NumberFormat('he-IL');
  // All times are shown in UTC, the same time zone the server uses for the report.
  const dateTimeFormat = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'UTC',
    dateStyle: 'short',
    timeStyle: 'short'
  });
  // Short format for the labels under the chart's X axis (day/month hour:minute).
  const axisTimeFormat = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'UTC',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const DAY_MS = 86400000;
  const SIX_HOURS_MS = 21600000;
  const SEARCH_DELAY_MS = 250;
  const MAX_RANGE_DAYS = 31;

  // ===== State =====================================================================
  let chart; // the current Chart.js instance (destroyed before drawing a new one)
  let searchController; // cancels the article search that is still running
  let searchTimer; // debounce timer: search only after the user stops typing
  let searchOpen = false; // true while the suggestion list is allowed to be shown
  let matches = []; // articles returned by the last search
  let activeIndex = -1; // suggestion highlighted with the keyboard (-1 = none)
  let selectedArticleId = ''; // the article the report will be loaded for
  let reportController; // cancels the report request that is still running

  // Default range: the last 7 days, ending today (dates are "YYYY-MM-DD" strings).
  endInput.value = new Date().toISOString().slice(0, 10);
  const defaultStartMs = Date.parse(endInput.value) - 6 * DAY_MS;
  startInput.value = new Date(defaultStartMs).toISOString().slice(0, 10);

  // ===== Server requests ===========================================================
  // fetch() wrapper: returns the JSON body, or throws an Error with the server's Hebrew message.
  async function getJson(url, signal) {
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'לא ניתן לטעון את הנתונים');
    }
    return data;
  }

  // Cancels a running report and hides the old result (used whenever the input changes).
  function resetReport() {
    reportController?.abort();
    form.removeAttribute('aria-busy');
    resultSection.hidden = true;
    statusText.textContent = '';
  }

  // ===== Article search (combobox) =================================================
  function closeSuggestions() {
    searchOpen = false;
    suggestions.hidden = true;
    articleInput.setAttribute('aria-expanded', 'false');
    articleInput.removeAttribute('aria-activedescendant');
    searchStatus.textContent = '';
    activeIndex = -1;
  }

  function chooseArticle(article) {
    resetReport();
    selectedArticleId = article.id;
    articleInput.value = article.title;
    // The input is valid again, because a real article was chosen from the list.
    articleInput.setCustomValidity('');
    submitButton.disabled = false;
    clearTimeout(searchTimer);
    searchController?.abort();
    closeSuggestions();
  }

  // Builds one <li role="option"> in the suggestion list.
  function createOption(article, index) {
    const option = document.createElement('li');
    option.id = `analytics-option-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.textContent = article.title;
    // Prevents the input from losing focus (blur closes the list) before the click happens.
    option.addEventListener('pointerdown', (event) => event.preventDefault());
    option.addEventListener('click', () => chooseArticle(article));
    return option;
  }

  async function loadArticles() {
    // Only the newest search matters: cancel the previous one.
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;

    articleInput.setAttribute('aria-busy', 'true');
    searchStatus.textContent = 'מחפש כתבות...';
    suggestions.hidden = true;
    articleInput.setAttribute('aria-expanded', 'false');
    articleInput.removeAttribute('aria-activedescendant');
    activeIndex = -1;

    try {
      const params = new URLSearchParams({ q: articleInput.value.trim() });
      const data = await getJson(`/api/analytics/articles?${params}`, controller.signal);
      // Ignore the answer if a newer search started or the list was closed meanwhile.
      if (controller.signal.aborted || !searchOpen) return;

      matches = data.articles;
      suggestions.replaceChildren();
      for (const [index, article] of matches.entries()) {
        suggestions.append(createOption(article, index));
      }

      const hasMatches = matches.length > 0;
      suggestions.hidden = !hasMatches;
      articleInput.setAttribute('aria-expanded', String(hasMatches));
      if (!hasMatches) {
        searchStatus.textContent = 'לא נמצאו כתבות.';
      } else if (data.nextPage) {
        // The server returns one page only; tell the user there are more results.
        searchStatus.textContent = '20 התוצאות העדכניות ביותר';
      } else {
        searchStatus.textContent = '';
      }
    } catch (error) {
      if (!controller.signal.aborted && searchOpen) {
        searchStatus.textContent = error.message;
      }
    } finally {
      // Only the newest search may clear the "busy" flag.
      if (searchController === controller) {
        articleInput.removeAttribute('aria-busy');
      }
    }
  }

  // ===== Chart =====================================================================
  // Chart.js plugin: draws a dashed red vertical line with a "v<version>" label
  // at the time of every publication.
  const publicationMarkers = {
    id: 'publicationMarkers',
    afterDatasetsDraw(activeChart, args, options) {
      const { ctx, chartArea, scales } = activeChart;
      ctx.save();
      ctx.strokeStyle = '#b3121f';
      ctx.fillStyle = '#b3121f';
      ctx.font = '12px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';

      for (const [index, event] of options.events.entries()) {
        const x = scales.x.getPixelForValue(Date.parse(event.publishedAt));

        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();

        // Keep the label inside the chart, and stagger it on 3 rows so labels don't overlap.
        const labelX = Math.max(chartArea.left + 12, Math.min(x, chartArea.right - 12));
        const labelY = chartArea.top + 14 + (index % 3) * 16;
        ctx.fillText(`v${event.version}`, labelX, labelY);
      }
      ctx.restore();
    }
  };

  // Fills the list of publications under the chart.
  function renderPublications(publications) {
    const list = document.getElementById('analytics-publications');
    list.replaceChildren();

    for (const event of publications) {
      const item = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = event.version === 1 ? 'פרסום ראשון' : `עדכון גרסה ${event.version}`;
      const time = document.createElement('time');
      time.dateTime = event.publishedAt;
      time.textContent = `${dateTimeFormat.format(new Date(event.publishedAt))} UTC`;
      item.append(label, time);
      list.append(item);
    }

    if (!publications.length) {
      const item = document.createElement('li');
      item.className = 'analytics-publication-empty';
      item.textContent = 'אין פרסומים בטווח שנבחר.';
      list.append(item);
    }
  }

  function render(data) {
    document.getElementById('analytics-title').textContent = data.article.title;
    document.getElementById('analytics-total').textContent = numberFormat.format(data.total);
    document.getElementById('analytics-publication-count').textContent = numberFormat.format(data.publications.length);
    document.getElementById('analytics-interval').textContent = `UTC | צפיות בכל ${data.intervalMinutes} דקות`;
    renderPublications(data.publications);
    resultSection.hidden = false;

    // The X axis is a time in milliseconds; the range ends at the end of the last day.
    const rangeStart = Date.parse(data.start);
    const rangeEnd = Date.parse(data.end) + DAY_MS;
    // 5-minute data (a short range) gets a tick every 6 hours, longer ranges a tick per day.
    const isFiveMinuteData = data.intervalMinutes === 5;
    const points = data.points.map((point) => ({ x: Date.parse(point.time), y: point.views }));

    chart?.destroy();
    chart = new Chart(document.getElementById('analytics-chart'), {
      type: 'line',
      data: {
        datasets: [{
          label: 'צפיות',
          data: points,
          borderColor: '#087f8c',
          backgroundColor: 'rgba(8, 127, 140, 0.09)',
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
          tension: 0
        }]
      },
      plugins: [publicationMarkers],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        // The points are already { x, y } objects, so Chart.js doesn't need to parse them.
        parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        plugins: {
          legend: { display: false },
          publicationMarkers: { events: data.publications },
          tooltip: {
            callbacks: {
              title: (items) => `${dateTimeFormat.format(new Date(items[0].parsed.x))} UTC`
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: rangeStart,
            max: rangeEnd,
            // Replace Chart.js's automatic ticks with evenly spaced ones (about 4 steps).
            afterBuildTicks(scale) {
              const step = isFiveMinuteData
                ? SIX_HOURS_MS
                : Math.ceil((rangeEnd - rangeStart) / DAY_MS / 4) * DAY_MS;
              scale.ticks = [];
              for (let time = rangeStart; time <= rangeEnd; time += step) {
                scale.ticks.push({ value: time });
              }
            },
            grid: { display: false },
            border: { color: '#d7dfdf' },
            title: { display: true, text: 'זמן (UTC)' },
            ticks: {
              stepSize: isFiveMinuteData ? SIX_HOURS_MS : DAY_MS,
              color: '#697477',
              padding: 10,
              maxTicksLimit: 5,
              maxRotation: 0,
              callback: (value) => axisTimeFormat.format(new Date(value))
            }
          },
          y: {
            beginAtZero: true,
            suggestedMax: 1,
            grid: { color: '#e2e8e8' },
            border: { display: false },
            title: { display: true, text: 'צפיות' },
            ticks: { color: '#697477', padding: 8, precision: 0 }
          }
        }
      }
    });
  }

  // ===== Loading the report ========================================================
  async function loadAnalytics(event) {
    event?.preventDefault();
    if (!form.reportValidity() || !selectedArticleId) return;

    // Both dates are included, so a range from a day to the same day is 1 day.
    const days = (Date.parse(endInput.value) - Date.parse(startInput.value)) / DAY_MS + 1;
    if (days < 1 || days > MAX_RANGE_DAYS) {
      statusText.textContent = 'יש לבחור טווח של יום אחד עד 31 ימים.';
      return;
    }

    // Only the newest report matters: cancel the previous one.
    reportController?.abort();
    const controller = new AbortController();
    reportController = controller;

    statusText.textContent = 'טוען נתוני צפייה...';
    resultSection.hidden = true;
    form.setAttribute('aria-busy', 'true');

    try {
      const params = new URLSearchParams({ start: startInput.value, end: endInput.value });
      const url = `/api/analytics/articles/${encodeURIComponent(selectedArticleId)}?${params}`;
      const data = await getJson(url, controller.signal);
      if (controller.signal.aborted) return;
      render(data);
      statusText.textContent = data.total ? '' : 'אין צפיות בטווח שנבחר.';
    } catch (error) {
      // A cancelled request is not an error the user needs to see.
      if (error.name !== 'AbortError') {
        resultSection.hidden = true;
        statusText.textContent = error.message;
      }
    } finally {
      if (reportController === controller) {
        form.removeAttribute('aria-busy');
      }
    }
  }

  // ===== Keyboard navigation in the suggestion list ================================
  // ArrowDown/ArrowUp move the highlight in a circle; the first press starts at the
  // first (ArrowDown) or last (ArrowUp) suggestion.
  function moveHighlight(key) {
    const isDown = key === 'ArrowDown';
    if (activeIndex < 0) {
      activeIndex = isDown ? 0 : matches.length - 1;
    } else {
      const step = isDown ? 1 : -1;
      activeIndex = (activeIndex + step + matches.length) % matches.length;
    }

    for (const [index, option] of [...suggestions.children].entries()) {
      option.setAttribute('aria-selected', String(index === activeIndex));
    }
    const activeOption = suggestions.children[activeIndex];
    // Tells screen readers which option is highlighted while focus stays in the input.
    articleInput.setAttribute('aria-activedescendant', activeOption.id);
    activeOption.scrollIntoView({ block: 'nearest' });
  }

  // ===== Event listeners ===========================================================
  form.addEventListener('submit', loadAnalytics);

  // Changing a date hides the old report until the user loads a new one.
  form.addEventListener('change', resetReport);

  articleInput.addEventListener('focus', () => {
    searchOpen = true;
    loadArticles();
  });

  // Clicking the input again reopens a list that was closed with Escape.
  articleInput.addEventListener('click', () => {
    if (!searchOpen) {
      searchOpen = true;
      loadArticles();
    }
  });

  articleInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchController?.abort();
    resetReport();
    // Typing cancels the previous choice: the user must pick an article from the list again.
    selectedArticleId = '';
    submitButton.disabled = true;
    articleInput.setCustomValidity('יש לבחור כתבה מתוצאות החיפוש');
    closeSuggestions();
    searchOpen = true;
    // Debounce: search only after the user stops typing for a moment.
    searchTimer = setTimeout(loadArticles, SEARCH_DELAY_MS);
  });

  articleInput.addEventListener('blur', () => {
    clearTimeout(searchTimer);
    searchController?.abort();
    articleInput.removeAttribute('aria-busy');
    closeSuggestions();
  });

  articleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      clearTimeout(searchTimer);
      searchController?.abort();
      closeSuggestions();
      return;
    }

    if (event.key === 'Enter' && !suggestions.hidden && activeIndex >= 0) {
      event.preventDefault();
      chooseArticle(matches[activeIndex]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // If the list is closed, the arrow key opens it (by searching) instead of moving.
      if (suggestions.hidden) {
        searchOpen = true;
        clearTimeout(searchTimer);
        loadArticles();
        return;
      }
      moveHighlight(event.key);
    }
  });
})();
