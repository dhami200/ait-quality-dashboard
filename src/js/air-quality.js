/**
 * Air Quality Dashboard – JavaScript
 *
 * Provides simulated-but-deterministic AQI data for any city so the
 * dashboard works completely offline / without a paid API key.
 * All six required features are implemented:
 *   1. Location search + GPS auto-detect
 *   2. AQI number with colour-coded indicator
 *   3. Pollutant breakdown (PM2.5, PM10, CO, NO₂, O₃)
 *   4. Neighbourhood map (6 surrounding circles on an SVG canvas)
 *   5. 30-day trend chart (vanilla Canvas 2D)
 *   6. Configurable alert with browser Notifications API
 */

'use strict';

/* ─── Constants ──────────────────────────────────────────────────────────── */
const AQI_CATEGORIES = [
  { max: 50,  label: 'Good',                      cls: 'aqi-good',          desc: 'Air quality is satisfactory; little or no health risk.' },
  { max: 100, label: 'Moderate',                  cls: 'aqi-moderate',      desc: 'Acceptable; some pollutants may be a concern for very sensitive people.' },
  { max: 150, label: 'Unhealthy for Sensitive Groups', cls: 'aqi-sensitive', desc: 'Sensitive groups may experience health effects.' },
  { max: 200, label: 'Unhealthy',                 cls: 'aqi-unhealthy',     desc: 'Everyone may begin to experience health effects.' },
  { max: 300, label: 'Very Unhealthy',            cls: 'aqi-very-unhealthy',desc: 'Health alert: everyone may experience serious effects.' },
  { max: Infinity, label: 'Hazardous',            cls: 'aqi-hazardous',     desc: 'Emergency conditions — the entire population is likely affected.' },
];

const POLLUTANTS = [
  { key: 'pm25',  name: 'PM2.5', unit: 'µg/m³', max: 250, color: '#e53935' },
  { key: 'pm10',  name: 'PM10',  unit: 'µg/m³', max: 400, color: '#fb8c00' },
  { key: 'co',    name: 'CO',    unit: 'ppm',    max: 10,  color: '#8d6e63' },
  { key: 'no2',   name: 'NO₂',   unit: 'µg/m³', max: 200, color: '#6d4c41' },
  { key: 'o3',    name: 'O₃',    unit: 'µg/m³', max: 180, color: '#5c6bc0' },
];

/* Neighbourhood directions: label + SVG (cx,cy) relative to 160×160 canvas */
const NEIGHBOURS = [
  { label: 'North',      cx: 80,  cy: 24  },
  { label: 'North-East', cx: 136, cy: 52  },
  { label: 'South-East', cx: 136, cy: 108 },
  { label: 'South',      cx: 80,  cy: 136 },
  { label: 'South-West', cx: 24,  cy: 108 },
  { label: 'North-West', cx: 24,  cy: 52  },
];

/* ─── State ──────────────────────────────────────────────────────────────── */
let state = {
  city: '',
  aqi: 0,
  pollutants: {},
  trend: [],        // 30-day AQI values
  neighbours: [],   // 6 neighbour AQI values
  alertThreshold: null,
  alertEnabled: false,
};

/* ─── DOM helpers ────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

/* ─── Deterministic pseudo-random seeded by a string ────────────────────── */
function seededRand(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = h >>> 0;
  return function () {
    h ^= h << 13;
    h ^= h >> 17;
    h ^= h << 5;
    h = h >>> 0;
    return h / 4294967296;
  };
}

/* ─── Data generation ────────────────────────────────────────────────────── */
function generateData(cityName) {
  const rand = seededRand(cityName.toLowerCase().trim());

  // Base AQI for the city (ranges 10 – 300)
  const baseAQI = Math.round(10 + rand() * 290);

  // Pollutants derived from AQI with slight noise
  const factor = baseAQI / 150;
  const pollutants = {
    pm25: +(factor * 35 * (0.7 + rand() * 0.6)).toFixed(1),
    pm10: +(factor * 55 * (0.7 + rand() * 0.6)).toFixed(1),
    co:   +(factor * 1.2 * (0.7 + rand() * 0.6)).toFixed(2),
    no2:  +(factor * 30 * (0.7 + rand() * 0.6)).toFixed(1),
    o3:   +(factor * 40 * (0.7 + rand() * 0.6)).toFixed(1),
  };

  // 30-day trend – gradual drift around baseAQI
  const trend = [];
  let v = baseAQI;
  for (let i = 0; i < 30; i++) {
    v += (rand() - 0.48) * 20;
    v = Math.max(5, Math.min(350, v));
    trend.push(Math.round(v));
  }

  // 6 neighbours
  const neighbours = NEIGHBOURS.map((n) => {
    const nAQI = Math.round(baseAQI * (0.6 + rand() * 0.8));
    return { ...n, aqi: Math.min(400, nAQI) };
  });

  return { aqi: baseAQI, pollutants, trend, neighbours };
}

/* ─── AQI helpers ────────────────────────────────────────────────────────── */
function aqiCategory(aqi) {
  return AQI_CATEGORIES.find((c) => aqi <= c.max);
}

function aqiColour(aqi) {
  const colours = ['#00b050', '#ffbf00', '#ff7e00', '#ff0000', '#8f3f97', '#7e0023'];
  const idx = AQI_CATEGORIES.findIndex((c) => aqi <= c.max);
  return colours[Math.max(0, idx)];
}

/* ─── Render functions ───────────────────────────────────────────────────── */
function renderAQI(aqi) {
  const cat = aqiCategory(aqi);
  const circle = $('aqi-circle');
  const numberEl = $('aqi-number');
  const catEl = $('aqi-category');
  const descEl = $('aqi-description');

  numberEl.textContent = aqi;
  catEl.textContent = cat.label;
  catEl.style.color = aqiColour(aqi);
  descEl.textContent = cat.desc;

  // Remove old colour class and apply new one
  AQI_CATEGORIES.forEach((c) => circle.classList.remove(c.cls));
  circle.classList.add(cat.cls);
}

function renderPollutants(pollutants) {
  const grid = $('pollutants-grid');
  grid.innerHTML = '';

  POLLUTANTS.forEach((p) => {
    const val = pollutants[p.key];
    const pct = Math.min(100, (val / p.max) * 100);

    const item = document.createElement('div');
    item.className = 'pollutant-item';
    item.innerHTML = `
      <div class="pollutant-name">${p.name}</div>
      <div class="pollutant-value">${val}<span class="pollutant-unit"> ${p.unit}</span></div>
      <div class="pollutant-bar-wrap">
        <div class="pollutant-bar" style="width:${pct}%;background:${p.color};"></div>
      </div>
    `;
    grid.appendChild(item);
  });
}

function renderNeighbourhoodMap(centreAQI, neighbours) {
  const svg = $('neighborhood-map');
  svg.innerHTML = '';

  const W = 200, H = 200;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // Centre point
  const cx = W / 2, cy = H / 2;

  // Draw connecting lines first (behind circles)
  const lineGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  lineGroup.setAttribute('stroke', 'var(--border)');
  lineGroup.setAttribute('stroke-width', '1.5');
  lineGroup.setAttribute('stroke-dasharray', '4 3');

  neighbours.forEach((n) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', cx);
    line.setAttribute('y1', cy);
    line.setAttribute('x2', n.cx);
    line.setAttribute('y2', n.cy);
    lineGroup.appendChild(line);
  });
  svg.appendChild(lineGroup);

  // Helper – create a coloured circle with tooltip trigger
  function addCircle(x, y, aqi, label, r = 22) {
    const colour = aqiColour(aqi);
    const cat = aqiCategory(aqi);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.style.cursor = 'pointer';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', r);
    circle.setAttribute('fill', colour);
    circle.setAttribute('opacity', '0.88');
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '2');

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y + 1);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('fill', '#fff');
    text.setAttribute('font-size', r > 20 ? '12' : '10');
    text.setAttribute('font-weight', '700');
    text.setAttribute('font-family', 'Segoe UI, Arial, sans-serif');
    text.textContent = aqi;

    g.appendChild(circle);
    g.appendChild(text);

    // Tooltip
    const tooltip = $('map-tooltip');
    g.addEventListener('mouseenter', (e) => {
      tooltip.textContent = `${label}: AQI ${aqi} (${cat.label})`;
      tooltip.classList.add('visible');
    });
    g.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
    g.addEventListener('mousemove', (e) => {
      const rect = svg.closest('.map-wrapper').getBoundingClientRect();
      tooltip.style.left = `${e.clientX - rect.left + 10}px`;
      tooltip.style.top  = `${e.clientY - rect.top  - 28}px`;
    });

    svg.appendChild(g);
  }

  // Draw neighbours then centre (so centre is on top)
  neighbours.forEach((n) => addCircle(n.cx, n.cy, n.aqi, n.label, 20));
  addCircle(cx, cy, centreAQI, 'Your Location', 26);
}

function renderTrendChart(trend) {
  const canvas = $('trend-canvas');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 400;
  const H = 200;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = { top: 20, right: 16, bottom: 36, left: 44 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top  - pad.bottom;

  const maxVal = Math.max(...trend, 100);
  const minVal = Math.max(0, Math.min(...trend) - 20);

  // Background
  ctx.fillStyle = getComputedStyle(document.documentElement)
    .getPropertyValue('--card-bg').trim() || '#fff';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (cH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cW, y);
    ctx.stroke();

    // Y axis label
    const val = Math.round(maxVal - ((maxVal - minVal) / 4) * i);
    ctx.fillStyle = '#888';
    ctx.font = '11px Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(val, pad.left - 6, y + 4);
  }

  // Gradient fill under the line
  const toX = (i) => pad.left + (i / (trend.length - 1)) * cW;
  const toY = (v) => pad.top  + cH - ((v - minVal) / (maxVal - minVal)) * cH;

  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
  grad.addColorStop(0,   'rgba(26,111,196,0.35)');
  grad.addColorStop(1,   'rgba(26,111,196,0.02)');

  ctx.beginPath();
  ctx.moveTo(toX(0), toY(trend[0]));
  trend.forEach((v, i) => { if (i > 0) ctx.lineTo(toX(i), toY(v)); });
  ctx.lineTo(toX(trend.length - 1), pad.top + cH);
  ctx.lineTo(toX(0), pad.top + cH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(trend[0]));
  trend.forEach((v, i) => { if (i > 0) ctx.lineTo(toX(i), toY(v)); });
  ctx.strokeStyle = '#1a6fc4';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Dots + X-axis labels every ~5 days
  trend.forEach((v, i) => {
    const x = toX(i), y = toY(v);
    // Small dot
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = aqiColour(v);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // X label every 5 days
    if (i % 5 === 0 || i === trend.length - 1) {
      ctx.fillStyle = '#888';
      ctx.font = '10px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'center';
      const dayLabel = i === 0 ? 'Day 1' : i === trend.length - 1 ? 'Today' : `Day ${i + 1}`;
      ctx.fillText(dayLabel, x, H - 8);
    }
  });

  // Y axis title
  ctx.save();
  ctx.translate(12, pad.top + cH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#888';
  ctx.font = '11px Segoe UI, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('AQI', 0, 0);
  ctx.restore();
}

/* ─── Legend builder ─────────────────────────────────────────────────────── */
function buildLegend() {
  const legend = $('map-legend');
  if (!legend) return;
  legend.innerHTML = AQI_CATEGORIES.slice(0, 5).map((c, i) => {
    const colours = ['#00b050', '#ffbf00', '#ff7e00', '#ff0000', '#8f3f97'];
    return `<span class="legend-item">
      <span class="legend-dot" style="background:${colours[i]}"></span>${c.label}
    </span>`;
  }).join('');
}

/* ─── Alert ──────────────────────────────────────────────────────────────── */
function setupAlert() {
  const btn   = $('set-alert-btn');
  const input = $('alert-threshold');
  const clear = $('clear-alert-btn');
  const status = $('alert-status');

  btn.addEventListener('click', async () => {
    const val = parseInt(input.value, 10);
    if (isNaN(val) || val < 1 || val > 500) {
      status.textContent = '⚠️ Please enter a threshold between 1 and 500.';
      status.className = '';
      return;
    }
    state.alertThreshold = val;
    state.alertEnabled   = true;

    // Request notification permission
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission === 'granted') {
      status.textContent = `🔔 Alert active: notify when AQI > ${val}`;
      status.className = 'active';
    } else {
      status.textContent = `🔔 Alert set at AQI > ${val} (enable browser notifications to receive them)`;
      status.className = 'active';
    }

    // Check immediately if current data is already past threshold
    checkAlert(state.aqi);
  });

  clear.addEventListener('click', () => {
    state.alertThreshold = null;
    state.alertEnabled   = false;
    input.value = '';
    status.textContent = '';
    status.className = '';
  });
}

function checkAlert(aqi) {
  if (!state.alertEnabled || state.alertThreshold === null) return;
  if (aqi > state.alertThreshold) {
    const cat = aqiCategory(aqi);
    const msg = `⚠️ AQI in ${state.city} is now ${aqi} (${cat.label}) — above your threshold of ${state.alertThreshold}.`;
    $('alert-status').textContent = msg;
    $('alert-status').className = 'triggered';

    if (Notification.permission === 'granted') {
      new Notification('Air Quality Alert 🌬️', {
        body: msg,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text y="52" font-size="52">🌬️</text></svg>',
      });
    }
  }
}

/* ─── Loading overlay ────────────────────────────────────────────────────── */
function showLoading(on) {
  $('loading-overlay').classList.toggle('active', on);
}

/* ─── Main update function ───────────────────────────────────────────────── */
function updateDashboard(cityName) {
  showLoading(true);

  // Simulate a short async fetch delay so the UI feels natural
  setTimeout(() => {
    state.city = cityName;
    const data = generateData(cityName);
    state.aqi        = data.aqi;
    state.pollutants = data.pollutants;
    state.trend      = data.trend;
    state.neighbours = data.neighbours;

    $('location-display').textContent = `📍 Showing data for: ${cityName}`;

    renderAQI(state.aqi);
    renderPollutants(state.pollutants);
    renderNeighbourhoodMap(state.aqi, state.neighbours);
    renderTrendChart(state.trend);
    checkAlert(state.aqi);

    showLoading(false);
  }, 600);
}

/* ─── GPS location ───────────────────────────────────────────────────────── */
function useMyLocation() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }
  showLoading(true);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // Reverse-geocode via a public API; fall back gracefully if blocked
      const { latitude, longitude } = pos.coords;
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`;
      fetch(url)
        .then((r) => r.json())
        .then((data) => {
          const city =
            data.address?.city ||
            data.address?.town ||
            data.address?.village ||
            data.address?.county ||
            `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
          $('city-input').value = city;
          showLoading(false);
          updateDashboard(city);
        })
        .catch(() => {
          // If reverse geocoding fails, use coordinates as city key
          const label = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
          $('city-input').value = label;
          showLoading(false);
          updateDashboard(label);
        });
    },
    (err) => {
      showLoading(false);
      alert('Could not get your location. Please type your city name.');
    }
  );
}

/* ─── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Theme toggle
  const themeBtn = $('theme-toggle-aq');
  themeBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    themeBtn.textContent = isDark ? '🌙' : '☀️';
    // Re-render chart for new theme colours
    if (state.trend.length) renderTrendChart(state.trend);
  });

  // Search
  $('search-btn').addEventListener('click', () => {
    const city = $('city-input').value.trim();
    if (!city) { $('city-input').focus(); return; }
    updateDashboard(city);
  });

  $('city-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const city = $('city-input').value.trim();
      if (city) updateDashboard(city);
    }
  });

  // GPS
  $('gps-btn').addEventListener('click', useMyLocation);

  // Alert
  setupAlert();

  // Build static legend
  buildLegend();

  // Re-draw chart on window resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.trend.length) renderTrendChart(state.trend);
    }, 200);
  });

  // Load default city
  updateDashboard('New Delhi');
  $('city-input').value = 'New Delhi';
});
