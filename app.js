import { createAdapter, scannerCatalog } from './adapters.js';

const BUILD_VERSION = '2026.10.14.2';
const $ = (selector) => document.querySelector(selector);
const video = $('#video');
const reader = $('#reader');
const history = [];
const newStats = () => ({ errors: 0, decodeSamples: [], intervals: [], unique: new Set(), lastScanAt: null, accepted: 0 });
const metrics = new Map(scannerCatalog.map((scanner) => [scanner.id, newStats()]));
let stats = metrics.get('html5');
let activeId = 'html5';
let activeAdapter = null;
let switchToken = 0;
let toastTimer = 0;
let successTimer = 0;
let selectedZoom = 1;
let torchEnabled = false;
const diagnosticEvents = [];

function logDiagnostic(event, details = {}) {
  diagnosticEvents.unshift({ at: new Date().toISOString(), event, ...details });
  diagnosticEvents.length = Math.min(diagnosticEvents.length, 25);
  updateDiagnostics();
}

function updateDiagnostics() {
  const preview = activeId === 'html5' ? (reader.querySelector('video') || video) : video;
  let track = null;
  let capabilities = {};
  try { track = activeAdapter?.getTrack?.() || preview.srcObject?.getVideoTracks?.()[0] || null; } catch { /* Browser may hide track capabilities. */ }
  try { capabilities = track?.getCapabilities?.() || {}; } catch { /* Capability API is optional. */ }
  let settings = {};
  try {
    const actual = track?.getSettings?.() || {};
    settings = { width: actual.width ?? null, height: actual.height ?? null, facingMode: actual.facingMode ?? null, frameRate: actual.frameRate ?? null, torch: actual.torch ?? null, zoom: actual.zoom ?? null };
  } catch { /* Settings API is optional. */ }
  const stream = preview.srcObject;
  const snapshot = {
    app: BUILD_VERSION,
    capturedAt: new Date().toISOString(),
    page: { url: location.href, secureContext: window.isSecureContext, visibility: document.visibilityState, serviceWorker: 'serviceWorker' in navigator },
    browser: { userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language },
    scanner: { id: activeId, name: scannerCatalog.find((item) => item.id === activeId)?.name, status: $('#cameraStatus').textContent, errorCount: stats.errors },
    camera: {
      getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia), barcodeDetector: 'BarcodeDetector' in window,
      streamActive: Boolean(stream?.active), trackState: track?.readyState ?? null, trackEnabled: track?.enabled ?? null,
      videoReadyState: preview.readyState, videoWidth: preview.videoWidth, videoHeight: preview.videoHeight, videoPaused: preview.paused,
      settings, support: { torch: Boolean(capabilities.torch), zoom: capabilities.zoom ? { min: capabilities.zoom.min, max: capabilities.zoom.max } : false, focusModes: capabilities.focusMode || [] },
    },
    recentEvents: diagnosticEvents,
  };
  const output = $('#diagnosticsOutput');
  if (output) output.textContent = JSON.stringify(snapshot, null, 2);
  return snapshot;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove('show'), 2700);
}

function timeLabel(timestamp) {
  return new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(timestamp));
}

function setCameraStatus(message, state = 'live') {
  $('#cameraStatus').textContent = message;
  $('#liveDot').className = `live-dot${state === 'off' ? ' off' : state === 'error' ? ' error' : ''}`;
  $('#cameraStage').classList.toggle('paused', state !== 'live');
}

function updateMetrics() {
  $('#scanCount').textContent = String(stats.accepted);
  $('#uniqueCount').textContent = String(stats.unique.size);
  $('#intervalValue').textContent = stats.intervals.length ? `${(stats.intervals.reduce((a, b) => a + b, 0) / stats.intervals.length / 1000).toFixed(1)}s` : '—';
  $('#decodeValue').textContent = stats.decodeSamples.length ? `${(stats.decodeSamples.reduce((a, b) => a + b, 0) / stats.decodeSamples.length).toFixed(1)} ms` : 'n.v.t.';
  $('#errorCount').textContent = String(stats.errors);
  $('#measurementNote').textContent = stats.decodeSamples.length
    ? 'Decodeertijd is het gemiddelde van gemeten verwerkte frames. Scaninterval is gemeten tussen geaccepteerde scans.'
    : 'Scaninterval is gemeten. Deze adapter geeft geen betrouwbare verwerkingstijd per frame door.';
}

function renderHistory() {
  const list = $('#historyList');
  $('#historyCount').textContent = String(history.length);
  list.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<span>⌗</span><p>Nog geen codes gescand</p><small>Je resultaten verschijnen hier, nieuwste bovenaan.</small>';
    list.append(empty);
    return;
  }
  history.slice(0, 60).forEach((scan) => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const icon = document.createElement('span'); icon.className = 'history-icon'; icon.textContent = '⌗';
    const content = document.createElement('div');
    const code = document.createElement('div'); code.className = 'history-code'; code.textContent = scan.value;
    const lib = document.createElement('div'); lib.className = 'history-lib'; lib.textContent = scan.library;
    content.append(code, lib);
    const time = document.createElement('time'); time.className = 'history-time'; time.textContent = timeLabel(scan.at); time.dateTime = new Date(scan.at).toISOString();
    row.append(icon, content, time); list.append(row);
  });
}

function acceptScan(rawValue, decodeMs = null, scannerId = activeId) {
  const value = String(rawValue ?? '').trim();
  if (!value) return;
  const scannerStats = metrics.get(scannerId);
  const cooldown = Number($('#cooldown').value) * 1000;
  const now = Date.now();
  const existing = history.find((scan) => scan.value === value && scan.scannerId === scannerId);
  if (existing && now - existing.at < cooldown) return;
  if (scannerStats.lastScanAt !== null) scannerStats.intervals.push(now - scannerStats.lastScanAt);
  scannerStats.lastScanAt = now;
  scannerStats.accepted += 1;
  scannerStats.unique.add(value);
  const library = scannerCatalog.find((scanner) => scanner.id === scannerId)?.name || scannerId;
  const frameAverageMs = scannerStats.decodeSamples.length ? scannerStats.decodeSamples.reduce((a, b) => a + b, 0) / scannerStats.decodeSamples.length : null;
  const record = { value, at: now, library, scannerId, decodeMs: frameAverageMs };
  history.unshift(record);
  $('#lastValue').textContent = value;
  $('#lastTime').textContent = timeLabel(now);
  $('#lastSource').textContent = `Herkend door ${library}`;
  const success = $('#scanSuccess');
  success.classList.add('show');
  clearTimeout(successTimer);
  successTimer = window.setTimeout(() => success.classList.remove('show'), 850);
  renderHistory();
  if (scannerId === activeId) updateMetrics();
}

function reportError(error, token = switchToken) {
  if (token !== switchToken) return;
  const message = error?.message || String(error || 'Onbekende scannerfout');
  if (/notfoundexception|checksumexception|formatexception/i.test(message)) return;
  stats.errors += 1;
  logDiagnostic('scanner-error', { name: error?.name || 'Error', message });
  updateMetrics();
  setCameraStatus('Scannerfout', 'error');
  $('#lastSource').textContent = message;
  toast(message);
}

async function updateCapabilities(adapter) {
  $('#videoPlaceholder').hidden = true;
  const track = adapter?.getTrack?.();
  let settings = {};
  let capabilities = {};
  try { settings = track?.getSettings?.() || {}; } catch { /* Optional MediaStreamTrack API. */ }
  try { capabilities = track?.getCapabilities?.() || {}; } catch { /* Optional MediaStreamTrack API. */ }
  const width = settings.width;
  const height = settings.height;
  $('#resolutionValue').textContent = width && height ? `${width} × ${height}` : 'Niet beschikbaar';
  $('#resolutionValue').classList.toggle('unsupported', !width || width < 1280 || height < 720);
  const focusSupported = capabilities.focusMode?.includes('continuous');
  $('#focusValue').textContent = focusSupported ? 'Continu' : 'Niet ondersteund';
  $('#focusValue').classList.toggle('unsupported', !focusSupported);
  let hasTorch = Boolean(capabilities.torch);
  if (!hasTorch) {
    try { hasTorch = Boolean(await adapter?.hasTorch?.()); } catch { hasTorch = false; }
  }
  const hasZoom = Boolean(capabilities.zoom);
  $('#torchButton').disabled = !hasTorch;
  $('#zoomButton').disabled = !hasZoom;
  $('#capabilityValue').textContent = hasTorch || hasZoom ? `${hasTorch ? 'Zaklamp' : ''}${hasTorch && hasZoom ? ' · ' : ''}${hasZoom ? `Zoom ${capabilities.zoom.min}–${capabilities.zoom.max}×` : ''}` : 'Niet ondersteund';
  $('#capabilityValue').classList.toggle('unsupported', !hasTorch && !hasZoom);
  if (focusSupported) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  logDiagnostic('camera-ready', { width: width ?? null, height: height ?? null, torch: hasTorch, zoom: hasZoom });
}

async function stopActive() {
  const old = activeAdapter;
  activeAdapter = null;
  if (old) {
    try { await old.destroy(); } catch (error) { console.warn('Scanner cleanup:', error); }
  }
  for (const track of video.srcObject?.getTracks?.() || []) track.stop();
  video.srcObject = null;
  $('#videoPlaceholder').hidden = false;
  const readerVideo = reader.querySelector('video');
  for (const track of readerVideo?.srcObject?.getTracks?.() || []) track.stop();
  readerVideo?.pause();
  $('#torchButton').disabled = true;
  $('#zoomButton').disabled = true;
  torchEnabled = false;
  $('#torchButton').classList.remove('selected');
  $('#torchButton small').textContent = 'Zaklamp';
  updateDiagnostics();
}

async function selectScanner(id, { restart = false } = {}) {
  if (id === activeId && activeAdapter && !restart) return;
  const token = ++switchToken;
  activeId = id;
  stats = metrics.get(id);
  updateMetrics();
  const item = scannerCatalog.find((scanner) => scanner.id === id);
  $('#activeScanner').textContent = item?.name || id;
  $('#scannerNav').querySelectorAll('.scanner-link').forEach((link) => {
    const active = link.dataset.id === id;
    link.classList.toggle('active', active);
    link.setAttribute('aria-current', active ? 'page' : 'false');
  });
  $('#reader').style.display = id === 'html5' ? 'block' : 'none';
  video.style.display = id === 'html5' ? 'none' : 'block';
  $('#fpsChip').textContent = `${$('#scanRate').value} FPS`;
  setCameraStatus('Camera wordt gestart', 'off');
  $('#lastSource').textContent = item?.status || 'Scanner wordt geladen';
  logDiagnostic('scanner-selected', { id });
  await stopActive();
  if (token !== switchToken) return;
  const adapter = await createAdapter(id, {
    video, reader, fps: Number($('#scanRate').value),
    onScan: (value, decodeMs) => { if (token === switchToken) acceptScan(value, decodeMs, id); },
    onError: (error) => reportError(error, token),
    onMeasurement: (elapsed) => { if (token === switchToken) { metrics.get(id).decodeSamples.push(elapsed); if (id === activeId) updateMetrics(); } },
  });
  activeAdapter = adapter;
  try {
    await adapter.start();
    if (token !== switchToken) { await adapter.destroy(); return; }
    setCameraStatus('Camera actief');
    $('#videoPlaceholder').hidden = true;
    await updateCapabilities(adapter);
    updateDiagnostics();
    $('#lastSource').textContent = item?.status || 'Gereed';
  } catch (error) {
    if (token !== switchToken) { await adapter.destroy(); return; }
    await adapter.destroy().catch(() => {});
    activeAdapter = null;
    setCameraStatus('Camera niet actief', 'error');
    $('#videoPlaceholder').hidden = false;
    $('#resolutionValue').textContent = 'Niet beschikbaar';
    $('#focusValue').textContent = 'Niet ondersteund';
    $('#capabilityValue').textContent = 'Niet ondersteund';
    reportError(error, token);
    updateDiagnostics();
  }
}

function buildNav() {
  scannerCatalog.forEach((scanner, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `scanner-link${scanner.id === activeId ? ' active' : ''}`; button.dataset.id = scanner.id;
    const number = document.createElement('span'); number.className = 'scanner-number'; number.textContent = String(index + 1).padStart(2, '0');
    const text = document.createElement('span');
    const name = document.createElement('span'); name.className = 'scanner-name'; name.textContent = scanner.name;
    const subtitle = document.createElement('span'); subtitle.className = 'scanner-note'; subtitle.textContent = scanner.subtitle;
    text.append(name, subtitle); button.append(number, text);
    button.addEventListener('click', () => { closeMenu(); selectScanner(scanner.id); });
    $('#scannerNav').append(button);
  });
}

function openMenu() {
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
  $('#menuButton').setAttribute('aria-expanded', 'true'); $('#scrim').hidden = false;
}
function closeMenu() {
  $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
  $('#menuButton').setAttribute('aria-expanded', 'false'); $('#scrim').hidden = true;
}

function exportCsv() {
  const rows = [['tijdstip', 'scanner', 'qr_code', 'gemiddelde_frame_ms'], ...history.map((scan) => [new Date(scan.at).toISOString(), scan.library, scan.value, scan.decodeMs ?? ''])];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `qr-benchmark-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
  URL.revokeObjectURL(url);
  toast(`${history.length} scans geëxporteerd`);
}

$('#menuButton').addEventListener('click', openMenu);
$('#closeMenu').addEventListener('click', closeMenu);
$('#scrim').addEventListener('click', closeMenu);
$('#restartButton').addEventListener('click', () => selectScanner(activeId, { restart: true }));
$('#exportButton').addEventListener('click', exportCsv);
$('#clearButton').addEventListener('click', () => {
  history.length = 0;
  scannerCatalog.forEach((scanner) => metrics.set(scanner.id, newStats()));
  stats = metrics.get(activeId);
  $('#lastValue').textContent = 'Richt de camera op een QR-code'; $('#lastTime').textContent = '—'; $('#lastSource').textContent = 'Wachten op herkenning';
  renderHistory(); updateMetrics(); toast('Scanhistoriek gewist');
});
$('#scanRate').addEventListener('change', () => {
  $('#fpsChip').textContent = `${$('#scanRate').value} FPS`;
  if (activeAdapter) selectScanner(activeId, { restart: true });
});
$('#torchButton').addEventListener('click', async () => {
  if (!activeAdapter) return;
  try {
    torchEnabled = !torchEnabled;
    await activeAdapter.setTorch(torchEnabled);
    $('#torchButton').classList.toggle('selected', torchEnabled);
  } catch (error) { toast(`Zaklamp niet beschikbaar: ${error.message}`); }
});
$('#zoomButton').addEventListener('click', async () => {
  const track = activeAdapter?.getTrack?.();
  const range = track?.getCapabilities?.().zoom;
  if (!track || !range) return;
  selectedZoom = selectedZoom >= range.max ? range.min : Math.min(range.max, selectedZoom + Math.max(range.step || 0.1, (range.max - range.min) / 4));
  try { await track.applyConstraints({ advanced: [{ zoom: selectedZoom }] }); $('#zoomButton small').textContent = `${selectedZoom.toFixed(1)}×`; }
  catch (error) { toast(`Zoom niet beschikbaar: ${error.message}`); }
});
$('#diagnosticsPanel').addEventListener('toggle', () => updateDiagnostics());
$('#copyDiagnostics').addEventListener('click', async () => {
  const report = JSON.stringify(updateDiagnostics(), null, 2);
  try {
    await navigator.clipboard.writeText(report);
    toast('Diagnose gekopieerd. QR-inhoud staat er niet in.');
  } catch {
    const field = document.createElement('textarea');
    field.value = report; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0';
    document.body.append(field); field.select();
    const copied = document.execCommand('copy'); field.remove();
    toast(copied ? 'Diagnose gekopieerd. QR-inhoud staat er niet in.' : 'Kopiëren niet gelukt; selecteer de diagnosetekst handmatig.');
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    ++switchToken;
    await stopActive();
    setCameraStatus('Gepauzeerd op achtergrond', 'off');
    logDiagnostic('page-hidden');
  } else {
    selectScanner(activeId, { restart: true });
  }
});
window.addEventListener('pagehide', () => { ++switchToken; stopActive(); });
window.addEventListener('pageshow', (event) => { if (event.persisted && !document.hidden) selectScanner(activeId, { restart: true }); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });

buildNav();
renderHistory();
updateMetrics();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
updateDiagnostics();
window.setInterval(() => { if ($('#diagnosticsPanel')?.open) updateDiagnostics(); }, 1200);
selectScanner(activeId);
