import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExtraction, validateReview, applyReview, parseModelJSON, makeCSV, markEdited, restoreSession, buildEndpoint, validateSettings } from '../public/js/core.js';
import { generate, extractionSchema, reviewParts } from '../public/js/api.js';
const photo = { id: 'photo-1', name: 'lesson.jpg', pageOverride: null };
const raw = { english: 'a remarkably resilient man', japanese: '驚くほど立ち直りが早い男', pageNumber: 469, blockNumber: 1, exampleNumber: null, reason: '' };
const extracted = () => normalizeExtraction({ rows: [raw], notes: [] }, photo).rows;
const config = { provider: 'vertex', projectId: 'my-teaching-project', apiKey: 'example-fake-key', extractModel: 'gemini-2.5-flash', reviewModel: 'gemini-2.5-pro' };
test('preserves fragments, numbering, filename, accents and page', () => {
  const rows = normalizeExtraction({ rows: [raw, { ...raw, english: 'The café is my favorite haunt.', blockNumber: 3, exampleNumber: 2 }], notes: [] }, photo).rows;
  assert.equal(rows[0].english, raw.english); assert.equal(rows[0].exampleNumber, null); assert.equal(rows[0].photoName, photo.name);
  assert.equal(rows[1].english, 'The café is my favorite haunt.'); assert.equal(rows[1].exampleNumber, 2); assert.equal(rows[1].pageNumber, 469);
});
test('flags missing translation and page without inventing either', () => {
  const rows = normalizeExtraction({ rows: [{ ...raw, japanese: '', pageNumber: null }], notes: ['下端が切れている'] }, photo).rows;
  assert.equal(rows[0].status, '要確認'); assert.equal(rows[0].pageNumber, null); assert.match(rows[0].reason, /日本語訳/); assert.match(rows[0].reason, /下端/);
});
test('manual page override wins and invalid block/empty English are rejected', () => {
  assert.equal(normalizeExtraction({ rows: [raw], notes: [] }, { ...photo, pageOverride: 470 }).rows[0].pageNumber, 470);
  assert.throws(() => normalizeExtraction({ rows: [{ ...raw, blockNumber: 0 }], notes: [] }, photo));
  assert.throws(() => normalizeExtraction({ rows: [{ ...raw, english: '' }], notes: [] }, photo));
});
test('review enforces exact ID coverage: no missing, unknown, or duplicated IDs', () => {
  const rows = extracted(); const check = { id: rows[0].id, verdict: 'ok', reasons: [], suggestedEnglish: '', suggestedJapanese: '' };
  assert.throws(() => validateReview({ checks: [], pageIssues: [] }, rows));
  assert.throws(() => validateReview({ checks: [{ ...check, id: 'unknown' }], pageIssues: [] }, rows));
  assert.throws(() => validateReview({ checks: [check, check], pageIssues: [] }, rows));
  assert.equal(validateReview({ checks: [check], pageIssues: [] }, rows).checks.size, 1);
});
test('suggestions flag a row but do not rewrite original text', () => {
  const rows = extracted(); const reviewed = validateReview({ checks: [{ id: rows[0].id, verdict: 'ok', reasons: [], suggestedEnglish: 'changed text', suggestedJapanese: '' }], pageIssues: [] }, rows);
  const applied = applyReview(rows, reviewed)[0]; assert.equal(applied.english, raw.english); assert.equal(applied.originalEnglish, raw.english); assert.equal(applied.status, '要確認'); assert.equal(applied.suggestedEnglish, 'changed text');
});
test('clean checks become AI-confirmed, while extraction doubt survives review', () => {
  for (const reason of ['', '読みにくい']) { const rows = normalizeExtraction({ rows: [{ ...raw, reason }], notes: [] }, photo).rows;
    const reviewed = validateReview({ checks: [{ id: rows[0].id, verdict: 'ok', reasons: [], suggestedEnglish: '', suggestedJapanese: '' }], pageIssues: [] }, rows);
    assert.equal(applyReview(rows, reviewed)[0].status, reason ? '要確認' : 'AI確認済み'); }
});
test('edits invalidate old AI verdict and old suggestions', () => {
  const row = markEdited({ ...extracted()[0], status: 'AI確認済み', checkedAt: 'now', suggestedEnglish: 'x' }, 'english', 'new text');
  assert.equal(row.status, '要確認'); assert.equal(row.checkedAt, null); assert.equal(row.suggestedEnglish, ''); assert.equal(row.originalEnglish, raw.english);
});
test('CSV has exact eight columns, BOM, CRLF, correct quote escaping, blank numbering', () => {
  const csv = makeCSV([{ ...extracted()[0], english: 'He said, "Hi."\nAgain.' }]);
  assert.ok(csv.startsWith('\uFEFF"英文","日本語訳","写真名","ページ番号","ブロック番号","例文番号","状態","確認理由"\r\n'));
  assert.ok(csv.includes('"He said, ""Hi.""\nAgain."')); assert.ok(csv.includes('"469","1","","抽出済み",""\r\n'));
});
test('CSV formula protection handles leading whitespace; can be disabled', () => {
  const rows = [{ ...extracted()[0], english: '  =1+1' }]; assert.ok(makeCSV(rows).includes("'  =1+1")); assert.ok(!makeCSV(rows, false).includes("'  =1+1"));
});
test('truncated/blocked/no output responses are not accepted as final', () => {
  const body = { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'hidden' }, { text: '```json\n{"rows":[]}\n```' }] } }] };
  assert.deepEqual(parseModelJSON(body), { rows: [] }); assert.throws(() => parseModelJSON({ candidates: [{ finishReason: 'MAX_TOKENS' }] }));
  assert.throws(() => parseModelJSON({ promptFeedback: { blockReason: 'SAFETY' } })); assert.throws(() => parseModelJSON({}));
});
test('session restore validates shape and drops old photo bindings', () => {
  const data = { format: 'example-ocr-session', version: 1, rows: extracted() }; const rows = restoreSession(data);
  assert.equal(rows[0].photoId, null); assert.notEqual(rows[0].id, data.rows[0].id); assert.equal(rows[0].photoName, 'lesson.jpg');
  assert.throws(() => restoreSession({ version: 1, rows: [] })); assert.throws(() => restoreSession({ ...data, rows: [{ ...data.rows[0], pageNumber: -1 }] }));
});
test('key-specific endpoint is correct for Vertex/Gemini; rejects malformed model IDs', () => {
  assert.equal(buildEndpoint(config, config.extractModel), 'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent');
  assert.equal(buildEndpoint({ ...config, provider: 'gemini' }, config.reviewModel), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent');
  assert.throws(() => buildEndpoint(config, '../other?key=x')); assert.doesNotThrow(() => validateSettings(config)); assert.throws(() => validateSettings({ ...config, projectId: '12345' }));
});
test('actual request contains image/schema and key header but never key in URL/body', async () => {
  let req; const data = { rows: [raw], notes: [] };
  const result = await generate(config, config.extractModel, [{ inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } }], extractionSchema, {
    fetchImpl: async (url, options) => { req = { url, options }; return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(data) }] } }] }), { status: 200 }); } });
  assert.equal(req.options.headers['x-goog-api-key'], config.apiKey); assert.ok(!req.url.includes(config.apiKey)); assert.ok(!req.options.body.includes(config.apiKey));
  const body = JSON.parse(req.options.body); assert.equal(body.generationConfig.responseMimeType, 'application/json'); assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'image/jpeg'); assert.deepEqual(result.data, data);
});
test('error bodies redact the API key', async () => {
  await assert.rejects(() => generate(config, config.extractModel, [], extractionSchema, { fetchImpl: async () => new Response(JSON.stringify({ error: { message: `invalid ${config.apiKey}` } }), { status: 403 }) }), error => !error.message.includes(config.apiKey) && error.message.includes('403'));
});
test('abort interrupts request without marking it complete', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => generate(config, config.extractModel, [], extractionSchema, { signal: controller.signal, fetchImpl: async () => { throw new DOMException('aborted', 'AbortError'); } }), { name: 'AbortError' });
});
test('source-less review explicitly limits verification to content', () => {
  const parts = reviewParts(null, extracted()); assert.equal(parts.length, 1); assert.match(parts[0].text, /元写真がない/); assert.match(parts[0].text, /文の断片という理由で警告しない/);
});
