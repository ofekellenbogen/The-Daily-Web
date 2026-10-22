(() => {
  const form = document.getElementById('analytics-filter');
  const articleInput = document.getElementById('analytics-article');
  const suggestions = document.getElementById('analytics-suggestions');
  const searchStatus = document.getElementById('analytics-search-status');
  const startInput = document.getElementById('analytics-start');
  const endInput = document.getElementById('analytics-end');
  const submit = document.getElementById('analytics-submit');
  const status = document.getElementById('analytics-status');
  const result = document.getElementById('analytics-result');
  const number = new Intl.NumberFormat('he-IL');
  const dateTime = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' });
  const axisTime = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const DAY_MS = 86400000;
  let chart;
  let searchController;
  let searchTimer;
  let searchOpen = false;
  let matches = [];
  let activeIndex = -1;
  let selectedArticleId = '';
  let requestController;

  endInput.value = new Date().toISOString().slice(0, 10);
  startInput.value = new Date(Date.parse(endInput.value) - 6 * DAY_MS).toISOString().slice(0, 10);

  async function getJson(url, signal) {
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'לא ניתן לטעון את הנתונים');
    return data;
  }

  function closeSuggestions() {
    searchOpen = false;
    suggestions.hidden = true;
    articleInput.setAttribute('aria-expanded', 'false');
    articleInput.removeAttribute('aria-activedescendant');
    searchStatus.textContent = '';
    activeIndex = -1;
  }

  function chooseArticle(article) {
    requestController?.abort();
    form.removeAttribute('aria-busy');
    result.hidden = true;
    status.textContent = '';
    selectedArticleId = article.id;
    articleInput.value = article.title;
    articleInput.setCustomValidity('');
    submit.disabled = false;
    clearTimeout(searchTimer);
    searchController?.abort();
    closeSuggestions();
  }

  async function loadArticles() {
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
      if (controller.signal.aborted || !searchOpen) return;
      matches = data.articles;
      suggestions.replaceChildren();
      for (const [index, article] of matches.entries()) {
        const option = document.createElement('li');
        option.id = `analytics-option-${index}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.textContent = article.title;
        option.addEventListener('pointerdown', (event) => event.preventDefault());
        option.addEventListener('click', () => chooseArticle(article));
        suggestions.append(option);
      }
      suggestions.hidden = matches.length === 0;
      articleInput.setAttribute('aria-expanded', String(matches.length > 0));
      searchStatus.textContent = !matches.length ? 'לא נמצאו כתבות.' : data.nextPage ? '20 התוצאות העדכניות ביותר' : '';
    } catch (error) {
      if (!controller.signal.aborted && searchOpen) searchStatus.textContent = error.message;
    } finally {
      if (searchController === controller) articleInput.removeAttribute('aria-busy');
    }
  }

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
        const position = scales.x.getPixelForValue(Date.parse(event.publishedAt));
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(position, chartArea.top);
        ctx.lineTo(position, chartArea.bottom);
        ctx.stroke();
        ctx.fillText(`v${event.version}`, Math.max(chartArea.left + 12, Math.min(position, chartArea.right - 12)), chartArea.top + 14 + (index % 3) * 16);
      }
      ctx.restore();
    }
  };

  function render(data) {
    document.getElementById('analytics-title').textContent = data.article.title;
    document.getElementById('analytics-total').textContent = number.format(data.total);
    document.getElementById('analytics-publication-count').textContent = number.format(data.publications.length);
    document.getElementById('analytics-interval').textContent = `UTC | צפיות בכל ${data.intervalMinutes} דקות`;
    const events = document.getElementById('analytics-publications');
    events.replaceChildren();
    for (const event of data.publications) {
      const item = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = event.version === 1 ? 'פרסום ראשון' : `עדכון גרסה ${event.version}`;
      const time = document.createElement('time');
      time.dateTime = event.publishedAt;
      time.textContent = `${dateTime.format(new Date(event.publishedAt))} UTC`;
      item.append(label, time);
      events.append(item);
    }
    if (!data.publications.length) {
      const item = document.createElement('li');
      item.className = 'analytics-publication-empty';
      item.textContent = 'אין פרסומים בטווח שנבחר.';
      events.append(item);
    }
    result.hidden = false;
    chart?.destroy();
    chart = new Chart(document.getElementById('analytics-chart'), {
      type: 'line',
      data: { datasets: [{ label: 'צפיות', data: data.points.map((point) => ({ x: Date.parse(point.time), y: point.views })),
        borderColor: '#087f8c', backgroundColor: 'rgba(8, 127, 140, 0.09)', fill: true, pointRadius: 0, borderWidth: 2, tension: 0 }] },
      plugins: [publicationMarkers],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        plugins: { legend: { display: false }, publicationMarkers: { events: data.publications },
          tooltip: { callbacks: { title: (items) => `${dateTime.format(new Date(items[0].parsed.x))} UTC` } } },
        scales: {
          x: { type: 'linear', min: Date.parse(data.start), max: Date.parse(data.end) + DAY_MS,
            afterBuildTicks(scale) {
              const start = Date.parse(data.start);
              const end = Date.parse(data.end) + DAY_MS;
              const step = data.intervalMinutes === 5 ? 21600000 : Math.ceil((end - start) / DAY_MS / 4) * DAY_MS;
              scale.ticks = [];
              for (let time = start; time <= end; time += step) scale.ticks.push({ value: time });
            },
            grid: { display: false }, border: { color: '#d7dfdf' },
            title: { display: true, text: 'זמן (UTC)' },
            ticks: { stepSize: data.intervalMinutes === 5 ? 21600000 : DAY_MS,
              color: '#697477', padding: 10, maxTicksLimit: 5, maxRotation: 0,
              callback: (value) => axisTime.format(new Date(value)) } },
          y: { beginAtZero: true, suggestedMax: 1, grid: { color: '#e2e8e8' }, border: { display: false },
            title: { display: true, text: 'צפיות' }, ticks: { color: '#697477', padding: 8, precision: 0 } }
        }
      }
    });
  }

  async function loadAnalytics(event) {
    event?.preventDefault();
    if (!form.reportValidity() || !selectedArticleId) return;
    const days = (Date.parse(endInput.value) - Date.parse(startInput.value)) / DAY_MS + 1;
    if (days < 1 || days > 31) {
      status.textContent = 'יש לבחור טווח של יום אחד עד 31 ימים.';
      return;
    }
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    status.textContent = 'טוען נתוני צפייה...';
    result.hidden = true;
    form.setAttribute('aria-busy', 'true');
    try {
      const params = new URLSearchParams({ start: startInput.value, end: endInput.value });
      const data = await getJson(`/api/analytics/articles/${encodeURIComponent(selectedArticleId)}?${params}`, controller.signal);
      if (controller.signal.aborted) return;
      render(data);
      status.textContent = data.total ? '' : 'אין צפיות בטווח שנבחר.';
    } catch (error) {
      if (error.name !== 'AbortError') {
        result.hidden = true;
        status.textContent = error.message;
      }
    } finally {
      if (requestController === controller) form.removeAttribute('aria-busy');
    }
  }

  form.addEventListener('submit', loadAnalytics);
  form.addEventListener('change', () => {
    requestController?.abort();
    form.removeAttribute('aria-busy');
    result.hidden = true;
    status.textContent = '';
  });
  articleInput.addEventListener('focus', () => {
    searchOpen = true;
    loadArticles();
  });
  articleInput.addEventListener('click', () => {
    if (!searchOpen) {
      searchOpen = true;
      loadArticles();
    }
  });
  articleInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchController?.abort();
    requestController?.abort();
    form.removeAttribute('aria-busy');
    selectedArticleId = '';
    submit.disabled = true;
    result.hidden = true;
    status.textContent = '';
    articleInput.setCustomValidity('יש לבחור כתבה מתוצאות החיפוש');
    closeSuggestions();
    searchOpen = true;
    searchTimer = setTimeout(loadArticles, 250);
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
      if (suggestions.hidden) {
        searchOpen = true;
        clearTimeout(searchTimer);
        loadArticles();
        return;
      }
      activeIndex = activeIndex < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
        : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      for (const [index, option] of [...suggestions.children].entries()) {
        option.setAttribute('aria-selected', String(index === activeIndex));
      }
      const activeOption = suggestions.children[activeIndex];
      articleInput.setAttribute('aria-activedescendant', activeOption.id);
      activeOption.scrollIntoView({ block: 'nearest' });
    }
  });
})();