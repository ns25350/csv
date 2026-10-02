import { uid, normalizeExtraction, validateReview, applyReview, markEdited, makeCSV, validateSettings, restoreSession } from './core.js';
import { generate, extractionParts, reviewParts, extractionSchema, reviewSchema } from './api.js';
const $ = id => document.getElementById(id);
const state = { photos: [], rows: [], selected: null, filter: 'all', page: 0, busy: false, controller: null, viewer: null,
  tokens: 0, settings: { projectId: '', apiKey: '', provider: 'vertex', extractModel: 'gemini-2.5-flash', reviewModel: 'gemini-2.5-pro', protectCSV: true } };
const el = (tag, className = '', text = '') => { const n = document.createElement(tag); n.className = className; n.textContent = text; return n; };
const btn = (text, className, action) => { const n = el('button', className, text); n.type = 'button'; n.disabled = state.busy; n.addEventListener('click', action); return n; };
const badge = status => el('span', `badge ${status === '要確認' ? 'warn' : status === 'AI確認済み' ? 'ai' : status === '手動確認済み' ? 'manual' : 'extracted'}`, status);
const photoRows = photo => state.rows.filter(r => r.photoId === photo.id);
const filtered = () => state.rows.filter(r => (state.filter === 'all' || (state.filter === 'review' ? r.status === '要確認' : ['AI確認済み', '手動確認済み'].includes(r.status))) && (r.english + ' ' + r.japanese + ' ' + r.photoName).toLowerCase().includes($('search').value.toLowerCase()));
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = !message; }
function setProgress(message, value) { $('progress-section').hidden = false; $('progress-message').textContent = message; $('progress').value = value; }
function addUsage(usage) { state.tokens += Number(usage.totalTokenCount) || 0; $('token-count').textContent = state.tokens ? `累計 ${state.tokens.toLocaleString()} tokens` : ''; }
function configured() { try { validateSettings(state.settings); return true; } catch { return false; } }
function settingsFromForm() { return { projectId: $('project-id').value.trim(), provider: $('provider').value, apiKey: $('api-key').value.trim(),
  extractModel: $('extract-model').value.trim(), reviewModel: $('review-model').value.trim(), protectCSV: $('protect-csv').checked }; }
function providerHelp() { $('provider-help').textContent = $('provider').value === 'vertex'
  ? 'Vertex AI APIを有効化し、Express modeキーまたはサービスアカウントに紐付いたGoogle Cloudキーを使います。APIキー専用エンドポイントのため、入力IDは作業記録に使い、通信先のプロジェクトはキーが決めます。'
  : 'Google AI Studioで発行したキー、またはGemini APIを有効化したプロジェクトの対応キーを使います。プロジェクトの課金・割り当てはキーに紐付きます。'; }
function openSettings() {
  for (const [id, key] of [['project-id', 'projectId'], ['api-key', 'apiKey'], ['provider', 'provider'], ['extract-model', 'extractModel'], ['review-model', 'reviewModel']]) $(id).value = state.settings[key];
  $('protect-csv').checked = state.settings.protectCSV; $('api-key').type = 'password'; $('show-key').textContent = '表示';
  $('settings-error').hidden = true; providerHelp(); $('settings-dialog').showModal();
}
function updateControls() {
  const ready = configured();
  $('connection-dot').classList.toggle('connected', ready);
  $('config-status').textContent = ready ? `${state.settings.extractModel} / ${state.settings.reviewModel}` : 'API未設定';
  const pending = state.photos.filter(p => p.stage !== 'done');
  $('run').disabled = state.busy || !state.photos.length || !pending.length;
  $('ready-count').textContent = state.photos.length ? `${pending.length}枚が処理待ち` : '写真を追加してください';
  $('stop').hidden = !state.controller; $('run').classList.toggle('busy', state.busy);
  const invalid = state.rows.some(r => !r.english.trim() || !Number.isInteger(r.blockNumber) || r.blockNumber < 1);
  for (const id of ['export', 'save-session', 'clear', 'review']) $(id).disabled = state.busy || !state.rows.length || ((id === 'export' || id === 'review') && invalid);
  $('add-row').disabled = state.busy || !state.rows.length;
  for (const id of ['photos-input', 'demo', 'settings-open', 'load-session', 'auto-review']) $(id).disabled = state.busy;
  $('drop-zone').setAttribute('aria-disabled', String(state.busy));
}
function renderPhotos() {
  $('photo-section').hidden = !state.photos.length; $('photo-count').textContent = state.photos.length; $('photo-list').replaceChildren();
  for (const photo of state.photos) {
    const card = el('div', 'photo-card'); const image = el('img'); image.src = photo.dataURL; image.alt = photo.name; image.tabIndex = 0;
    image.addEventListener('click', () => openPhoto(photo)); image.addEventListener('keydown', e => { if (e.key === 'Enter') openPhoto(photo); });
    const info = el('div', 'photo-info'); info.append(el('strong', '', photo.name));
    const label = el('label', '', 'ページ'); const input = el('input'); input.type = 'number'; input.min = '1'; input.step = '1'; input.placeholder = '自動'; input.value = photo.pageOverride ?? '';
    input.disabled = state.busy || photoRows(photo).length > 0; input.setAttribute('aria-label', `${photo.name}のページ番号`);
    input.addEventListener('change', () => { const value = input.valueAsNumber; if (input.value && (!Number.isSafeInteger(value) || value < 1)) { input.value = ''; notice('ページ番号は1以上の整数で入力してください。', true); return; } photo.pageOverride = input.value ? value : null; });
    label.append(input); info.append(label, el('span', 'photo-state', photo.label));
    const remove = btn('×', 'photo-remove', () => {
      if (photoRows(photo).length && !confirm('この写真の抽出結果も削除しますか？')) return;
      state.rows = state.rows.filter(r => r.photoId !== photo.id); state.photos = state.photos.filter(p => p.id !== photo.id); render();
    }); remove.setAttribute('aria-label', `${photo.name}を削除`); card.append(image, info, remove); $('photo-list').append(card);
  }
}
function renderRows() {
  const visible = filtered(); const pages = Math.max(1, Math.ceil(visible.length / 50)); state.page = Math.min(state.page, pages - 1);
  $('row-count').textContent = state.rows.length; $('all-count').textContent = state.rows.length;
  $('review-count').textContent = state.rows.filter(r => r.status === '要確認').length;
  $('confirmed-count').textContent = state.rows.filter(r => ['AI確認済み', '手動確認済み'].includes(r.status)).length;
  $('rows').replaceChildren(); $('empty').hidden = !!visible.length; $('pagination').hidden = !visible.length;
  if (state.rows.length && !visible.length) { $('empty').querySelector('h3').textContent = '該当する例文がありません。'; $('empty').querySelector('p').textContent = '検索条件や状態の絞り込みを変更してください。'; }
  else { $('empty').querySelector('h3').textContent = '例文が、ここに並びます。'; $('empty').querySelector('p').textContent = '写真を追加して抽出を始めてください。まずはサンプルで流れを試せます。'; }
  for (const row of visible.slice(state.page * 50, state.page * 50 + 50)) {
    const tr = el('tr', row.id === state.selected ? 'selected' : ''); tr.tabIndex = 0; tr.setAttribute('aria-label', `例文を編集: ${row.english}`);
    const select = () => { if (!state.busy) { state.selected = row.id; renderRows(); renderInspector(); } };
    tr.addEventListener('click', select); tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
    const index = el('td', 'index-cell', state.rows.indexOf(row) + 1); const content = el('td'); content.append(el('div', 'english-cell', row.english || '（英文を入力してください）'), el('div', 'japanese-cell', row.japanese));
    const location = el('td', 'location-cell', `p. ${row.pageNumber ?? '—'}`); location.append(el('small', '', `ブロック ${row.blockNumber}${row.exampleNumber ? ` · 例文 ${row.exampleNumber}` : ''}`));
    const status = el('td'); status.append(badge(row.status)); tr.append(index, content, location, status); $('rows').append(tr);
  }
  $('page-info').textContent = `${state.page * 50 + 1}–${Math.min((state.page + 1) * 50, visible.length)} / ${visible.length}件`;
  $('previous').disabled = state.page === 0; $('next').disabled = state.page >= pages - 1;
}
function field(labelText, value, action, { type = 'text', optional = false } = {}) {
  const label = el('label', 'field', labelText); const input = el(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type; input.value = value ?? ''; input.disabled = state.busy;
  if (type === 'number') { input.min = '1'; input.step = '1'; if (optional) input.placeholder = '空欄'; }
  input.addEventListener('change', () => {
    if (type === 'number') {
      if (optional && !input.value) action(null);
      else if (Number.isSafeInteger(input.valueAsNumber) && input.valueAsNumber > 0) action(input.valueAsNumber);
      else { input.value = value ?? ''; notice(`${labelText}は1以上の整数で入力してください。`, true); }
    } else action(input.value.trim());
  }); label.append(input); return label;
}
function editRow(id, key, value) {
  state.rows = state.rows.map(r => r.id === id ? markEdited(r, key, value) : r); renderRows(); updateControls();
  const row = state.rows.find(r => r.id === id); const panel = $('inspector');
  panel.querySelector('.badge')?.replaceWith(badge(row.status));
  if (panel.querySelector('.reason-box')) panel.querySelector('.reason-box').textContent = row.reason;
  panel.querySelector('.suggestion-box')?.remove();
}
function renderInspector() {
  const row = state.rows.find(r => r.id === state.selected); if (!row) return;
  const panel = $('inspector'); panel.replaceChildren();
  panel.append(el('span', 'section-label', 'LINE INSPECTOR'), badge(row.status), el('div', 'inspector-meta', row.photoName));
  const photo = state.photos.find(p => p.id === row.photoId);
  if (photo) { const image = el('img', 'inspector-thumb'); image.src = photo.dataURL; image.alt = `${row.photoName}を拡大`; image.tabIndex = 0; image.addEventListener('click', () => openPhoto(photo)); image.addEventListener('keydown', e => { if (e.key === 'Enter') openPhoto(photo); }); panel.append(image, btn('元写真を拡大 ↗', 'text-button', () => openPhoto(photo))); }
  else panel.append(el('p', '', '元写真は未追加です。同じ写真名の画像を追加すると照合できます。'));
  const reasons = el('div', 'reason-box', row.reason || (row.status === 'AI確認済み' ? 'AIは疑問点を検出しませんでした。' : row.status === '手動確認済み' ? '利用者による確認が完了しています。' : 'AIチェックはまだ完了していません。')); panel.append(reasons);
  if (row.suggestedEnglish || row.suggestedJapanese) {
    const box = el('div', 'suggestion-box', 'AIの修正候補'); if (row.suggestedEnglish) box.append(el('p', '', row.suggestedEnglish)); if (row.suggestedJapanese) box.append(el('p', '', row.suggestedJapanese));
    box.append(btn('この候補を適用', 'text-button', () => {
      state.rows = state.rows.map(r => r.id !== row.id ? r : { ...r, english: r.suggestedEnglish || r.english, japanese: r.suggestedJapanese || r.japanese,
        suggestedEnglish: '', suggestedJapanese: '', status: '要確認', checkedAt: null, reason: 'AIの修正候補を適用しました。元写真と確認してください。' }); renderRows(); renderInspector(); updateControls();
    })); panel.append(box);
  }
  panel.append(field('英文', row.english, v => editRow(row.id, 'english', v), { type: 'textarea' }), field('日本語訳', row.japanese, v => editRow(row.id, 'japanese', v), { type: 'textarea' }));
  const numbers = el('div', 'field-grid'); numbers.append(field('ページ番号', row.pageNumber, v => editRow(row.id, 'pageNumber', v), { type: 'number', optional: true }), field('ブロック番号', row.blockNumber, v => editRow(row.id, 'blockNumber', v), { type: 'number' })); panel.append(numbers);
  panel.append(field('例文番号（なければ空欄）', row.exampleNumber, v => editRow(row.id, 'exampleNumber', v), { type: 'number', optional: true }), field('確認理由・メモ', row.reason, v => editRow(row.id, 'reason', v), { type: 'textarea' }));
  const details = el('details', 'original-details'); details.append(el('summary', '', '最初の抽出内容を見る'), el('p', '', `${row.originalEnglish}\n${row.originalJapanese}`)); panel.append(details);
  panel.append(btn('手動確認済みにする ✓', 'button primary', () => {
    const current = state.rows.find(r => r.id === row.id);
    if (!current.english || !current.japanese || !current.pageNumber) { notice('英文・日本語訳・ページ番号を入力してから確認済みにしてください。', true); return; }
    state.rows = state.rows.map(r => r.id === row.id ? { ...r, status: '手動確認済み', reason: '', extractionReason: '', suggestedEnglish: '', suggestedJapanese: '', checkedAt: new Date().toISOString() } : r); renderRows(); renderInspector();
  }));
  panel.append(btn('この行を削除', 'text-button danger', () => { state.rows = state.rows.filter(r => r.id !== row.id); state.selected = state.rows[0]?.id ?? null; render(); }));
}
const initialInspector = $('inspector').cloneNode(true);
function render() { updateControls(); renderPhotos(); if (!state.rows.some(r => r.id === state.selected)) state.selected = state.rows[0]?.id ?? null; renderRows(); if (state.selected) renderInspector(); else $('inspector').replaceChildren(...[...initialInspector.childNodes].map(n => n.cloneNode(true))); }
function setBusy(value) { state.busy = value; render(); }
async function prepareImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name}: JPG・PNG・WebPの写真を使ってください（HEIC・PDFは未対応）。`);
  if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name}: ファイルは50MB以下にしてください。`);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (bitmap.width * bitmap.height > 65000000) throw new Error(`${file.name}: 画像の画素数が大きすぎます。縮小してください。`);
    const ratio = Math.min(1, 3600 / Math.max(bitmap.width, bitmap.height)); const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataURL = canvas.toDataURL('image/jpeg', .96); if (dataURL.length > 16 * 1024 * 1024) throw new Error(`${file.name}: 画像のサイズが大きすぎます。縮小してください。`);
    return { id: uid(), name: file.name, dataURL, pageOverride: null, stage: 'waiting', label: '待機中' };
  } finally { bitmap.close(); }
}
async function addPhotos(files) {
  if (state.busy || !files.length) return; state.busy = true; updateControls(); const errors = [];
  try {
    for (const file of files) {
      if (state.photos.some(p => p.name === file.name)) { errors.push(`${file.name}: 同名の写真はすでに追加されています。別の写真なら名前を変更してください。`); continue; }
      try { const photo = await prepareImage(file); state.photos.push(photo);
        const matching = state.rows.filter(r => !r.photoId && r.photoName === photo.name);
        if (matching.length) { matching.forEach(r => { r.photoId = photo.id; }); photo.stage = 'extracted'; photo.label = '既存の例文に接続'; }
      } catch (e) { errors.push(e.message); }
    }
  } finally { state.busy = false; $('photos-input').value = ''; render(); }
  notice(errors.length ? errors.join('\n') : '写真を追加しました。「抽出を開始」でGoogleに送信して処理します。', !!errors.length);
}
function openPhoto(photo) {
  state.viewer = photo.id; $('viewer-name').textContent = photo.name; $('viewer-image').src = photo.dataURL; $('zoom').value = '100'; zoomPhoto();
  $('rotate').disabled = state.busy || photoRows(photo).length > 0; if (!$('photo-dialog').open) $('photo-dialog').showModal();
}
function zoomPhoto() { $('viewer-image').style.width = `${$('zoom').value}%`; $('zoom-value').textContent = `${$('zoom').value}%`; }
async function rotatePhoto() {
  const photo = state.photos.find(p => p.id === state.viewer); if (!photo || state.busy || photoRows(photo).length) return;
  const image = await createImageBitmap(await (await fetch(photo.dataURL)).blob());
  try { const canvas = document.createElement('canvas'); canvas.width = image.height; canvas.height = image.width; const ctx = canvas.getContext('2d'); ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(image, 0, 0); photo.dataURL = canvas.toDataURL('image/jpeg', .96); $('viewer-image').src = photo.dataURL; renderPhotos(); }
  finally { image.close(); }
}
async function checkGroup(photo, rows, settings, signal, progressText) {
  const checks = new Map(); const issues = new Set();
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40); setProgress(`${progressText} · ${i + 1}–${Math.min(i + 40, rows.length)}行を照合中`, $('progress').value);
    const result = await generate(settings, settings.reviewModel, reviewParts(photo, chunk, rows), reviewSchema, { signal, onRetry: n => setProgress(`${progressText} · 接続を再試行 ${n}/2`, $('progress').value) });
    addUsage(result.usage); const valid = validateReview(result.data, chunk); valid.checks.forEach((v, k) => checks.set(k, v)); valid.pageIssues.forEach(x => issues.add(x));
  }
  // Do not partially mark a photo as checked if a later chunk fails.
  if (!photo) issues.add('元写真なし: 内容のみのチェック。写真との一致・抽出漏れは未確認。');
  const sourceAwareRows = photo ? rows : rows.map(r => ({ ...r, extractionReason: [r.extractionReason, '元写真なし: 写真との一致・抽出漏れは未確認。'].filter(Boolean).join(' / ') }));
  const reviewed = applyReview(sourceAwareRows, { checks }, { pageIssues: [...issues] }); const replacements = new Map(reviewed.map(r => [r.id, r]));
  state.rows = state.rows.map(r => replacements.get(r.id) ?? r);
}
async function runExtraction() {
  if (state.busy) return;
  if (!configured()) { openSettings(); return; }
  const photos = state.photos.filter(p => p.stage !== 'done'); if (!photos.length) return;
  const settings = { ...state.settings }; const autoReview = $('auto-review').checked; state.controller = new AbortController(); const signal = state.controller.signal;
  setBusy(true); notice(''); const errors = []; let completed = 0;
  try {
    for (const [index, photo] of photos.entries()) {
      if (signal.aborted) break;
      try {
        if (!photoRows(photo).length) {
          photo.label = '抽出中…'; renderPhotos(); setProgress(`${index + 1}/${photos.length}枚 · ${photo.name}を抽出中`, index / photos.length * 100);
          const result = await generate(settings, settings.extractModel, extractionParts(photo), extractionSchema, { signal, onRetry: n => setProgress(`${photo.name} · 接続を再試行 ${n}/2`, index / photos.length * 100) });
          addUsage(result.usage); const extracted = normalizeExtraction(result.data, photo);
          if (!extracted.rows.length) throw new Error('例文を抽出できませんでした。英文と日本語訳が読める写真を使ってください。');
          state.rows.push(...extracted.rows); photo.stage = 'extracted'; photo.label = `${extracted.rows.length}件抽出`; render();
        }
        if (autoReview) { photo.label = 'AI照合中…'; renderPhotos(); await checkGroup(photo, photoRows(photo), settings, signal, `${index + 1}/${photos.length}枚 · ${photo.name}`); }
        photo.stage = 'done'; photo.label = autoReview ? '抽出・チェック完了' : '抽出完了（チェック未実施）'; completed++; render();
      } catch (e) {
        if (e.name === 'AbortError') { photo.label = photoRows(photo).length ? 'チェック中断（抽出結果あり）' : '抽出中断'; break; }
        photo.label = photoRows(photo).length ? 'チェック失敗（再開可能）' : '抽出失敗（再開可能）'; errors.push(`${photo.name}\n${e.message}`); renderPhotos();
      }
      setProgress(`${index + 1}/${photos.length}枚の処理終了`, (index + 1) / photos.length * 100);
    }
    notice(signal.aborted ? '処理を停止しました。完了した抽出結果は残っています。再開すると未完了の処理を続けます。' : errors.length ? errors.join('\n\n') : `${completed}枚の処理が完了しました。要確認の行を選んで照合・編集し、CSVを保存してください。`, !!errors.length);
  } finally { state.controller = null; setBusy(false); }
}
async function recheckAll() {
  if (state.busy || !state.rows.length) return; if (!configured()) { openSettings(); return; }
  const settings = { ...state.settings }; const groups = new Map();
  for (const row of state.rows) { const key = row.photoId ?? row.photoName; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  state.controller = new AbortController(); const signal = state.controller.signal; setBusy(true); notice(''); const errors = []; let index = 0;
  try {
    for (const rows of groups.values()) {
      if (signal.aborted) break; const photo = state.photos.find(p => p.id === rows[0].photoId); setProgress(`${rows[0].photoName}を再チェック`, index / groups.size * 100);
      try { await checkGroup(photo, rows, settings, signal, rows[0].photoName); if (photo) { photo.stage = 'done'; photo.label = 'チェック完了'; } }
      catch (e) { if (e.name === 'AbortError') break; errors.push(`${rows[0].photoName}\n${e.message}`); }
      index++; render();
    }
    setProgress(signal.aborted ? '再チェックを停止しました' : '再チェック終了', index / groups.size * 100);
    notice(signal.aborted ? '停止しました。完了したチェック結果は残っています。' : errors.length ? errors.join('\n\n') : '再チェックが完了しました。要確認の理由と修正候補を確認してください。', !!errors.length);
  } finally { state.controller = null; setBusy(false); }
}
function download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
function saveSession() {
  download(`example-note-${new Date().toISOString().slice(0, 10)}.session.json`, JSON.stringify({ format: 'example-ocr-session', version: 1, savedAt: new Date().toISOString(),
    projectId: state.settings.projectId, extractModel: state.settings.extractModel, reviewModel: state.settings.reviewModel, rows: state.rows.map(({ photoId, ...rest }) => rest) }, null, 2), 'application/json');
}
async function loadSession(file) {
  if (!file || state.busy) return;
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('作業JSONは30MB以下にしてください。');
    const data = JSON.parse(await file.text()); const rows = restoreSession(data);
    if (state.rows.length && !confirm('現在の結果を作業JSONの内容に置き換えますか？')) return;
    state.rows = rows; state.page = 0; state.selected = rows[0]?.id ?? null;
    for (const photo of state.photos) { const matches = state.rows.filter(r => r.photoName === photo.name); matches.forEach(r => { r.photoId = photo.id; }); photo.stage = matches.length ? 'extracted' : 'waiting'; photo.label = matches.length ? '既存の例文に接続' : '待機中'; }
    render(); notice(`${rows.length}行を読み込みました。APIキーは改めて設定してください。元写真がなければ、再チェックは内容のみになります。`);
  } catch (e) { notice(`読み込みに失敗しました: ${e.message}`, true); }
  finally { $('session-input').value = ''; }
}
async function loadDemo() {
  if (state.busy) return;
  try { const response = await fetch('./sample.json'); if (!response.ok) throw new Error('サンプルを読み込めませんでした。'); const data = await response.json();
    const rows = restoreSession(data); state.rows.push(...rows); state.selected = rows[0]?.id ?? null; state.page = 0; render(); notice('サンプル15行を追加しました。添付写真の内容を手動で用意したデモです。Geminiでの処理結果ではありません。API通信なしで編集とCSV保存を試せます。');
  } catch (e) { notice(e.message, true); }
}
// Settings are held only in this tab. No local/session storage, cookies, analytics or external assets.
$('settings-open').addEventListener('click', openSettings); $('provider').addEventListener('change', providerHelp);
$('show-key').addEventListener('click', () => { const visible = $('api-key').type === 'password'; $('api-key').type = visible ? 'text' : 'password'; $('show-key').textContent = visible ? '隠す' : '表示'; });
$('settings-form').addEventListener('submit', e => { e.preventDefault(); try { const settings = settingsFromForm(); validateSettings(settings); state.settings = settings; $('settings-dialog').close(); updateControls(); notice('設定を適用しました。写真を追加して抽出を開始できます。'); } catch (e) { $('settings-error').textContent = e.message; $('settings-error').hidden = false; } });
$('test-connection').addEventListener('click', async () => {
  const button = $('test-connection'); $('settings-error').hidden = false;
  try { const settings = settingsFromForm(); validateSettings(settings); button.disabled = true; $('settings-error').textContent = '2つのモデルへの接続をテスト中（少量のAPI利用）…';
    for (const model of new Set([settings.extractModel, settings.reviewModel])) await generate(settings, model, [{ text: 'Return the JSON object with ok=true.' }], { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] });
    $('settings-error').textContent = '接続できました。「設定を適用」で保存してください。';
  } catch (e) { $('settings-error').textContent = e.message; } finally { button.disabled = false; }
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
$('help-open').addEventListener('click', () => $('help-dialog').showModal());
$('photos-input').addEventListener('change', e => addPhotos([...e.target.files]));
$('drop-zone').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !state.busy) { e.preventDefault(); $('photos-input').click(); } });
for (const event of ['dragover', 'dragenter']) $('drop-zone').addEventListener(event, e => { e.preventDefault(); if (!state.busy) $('drop-zone').classList.add('dragging'); });
for (const event of ['dragleave', 'drop']) $('drop-zone').addEventListener(event, e => { e.preventDefault(); $('drop-zone').classList.remove('dragging'); if (event === 'drop') addPhotos([...e.dataTransfer.files]); });
$('zoom').addEventListener('input', zoomPhoto); $('rotate').addEventListener('click', () => rotatePhoto().catch(e => notice(e.message, true)));
$('demo').addEventListener('click', loadDemo); $('run').addEventListener('click', runExtraction); $('review').addEventListener('click', recheckAll);
$('stop').addEventListener('click', () => { state.controller?.abort(); $('progress-message').textContent = '停止中…'; });
$('search').addEventListener('input', () => { state.page = 0; renderRows(); });
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; state.page = 0; document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }); renderRows(); }));
$('previous').addEventListener('click', () => { state.page--; renderRows(); }); $('next').addEventListener('click', () => { state.page++; renderRows(); });
$('export').addEventListener('click', () => { download(`example-note-${new Date().toISOString().slice(0, 10)}.csv`, makeCSV(state.rows, state.settings.protectCSV), 'text/csv;charset=utf-8'); notice(`全${state.rows.length}行をCSVに保存しました。画面で絞り込んでいても全行が含まれます。`); });
$('save-session').addEventListener('click', saveSession); $('load-session').addEventListener('click', () => $('session-input').click()); $('session-input').addEventListener('change', e => loadSession(e.target.files[0]));
$('clear').addEventListener('click', () => { if (!confirm('すべての抽出結果を削除しますか？必要なら先にCSV・作業JSONを保存してください。')) return;
  state.rows = []; state.selected = null; state.page = 0; state.photos.forEach(p => { p.stage = 'waiting'; p.label = '待機中'; }); render(); notice('結果をクリアしました。写真は残っています。'); });
$('add-row').addEventListener('click', () => { const previous = state.rows.find(r => r.id === state.selected) ?? state.rows.at(-1); const id = uid();
  state.rows.push({ id, photoId: previous.photoId, photoName: previous.photoName, english: '', japanese: '', pageNumber: previous.pageNumber, blockNumber: previous.blockNumber,
    exampleNumber: null, status: '要確認', reason: '追加した行に英文と日本語訳を入力してください。', extractionReason: '', originalEnglish: '', originalJapanese: '', suggestedEnglish: '', suggestedJapanese: '', checkedAt: null });
  state.selected = id; state.filter = 'all'; $('search').value = ''; document.querySelector('[data-filter="all"]').click(); state.page = Math.floor((state.rows.length - 1) / 50); render(); $('inspector').querySelector('textarea')?.focus();
});
window.addEventListener('beforeunload', e => { if (state.rows.length || state.busy) { e.preventDefault(); e.returnValue = ''; } });
render();
