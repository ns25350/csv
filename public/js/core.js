export const HEADERS = ['英文', '日本語訳', '写真名', 'ページ番号', 'ブロック番号', '例文番号', '状態', '確認理由'];
export const STATUSES = ['抽出済み', 'AI確認済み', '要確認', '手動確認済み'];
export const uid = () => crypto.randomUUID();
const text = (v, name) => { if (typeof v !== 'string') throw new Error(`${name}の形式が正しくありません。`); return v.trim(); };
function number(v, name, optional = false) {
  if (optional && v === null) return null;
  if (!Number.isSafeInteger(v) || v < 1) throw new Error(`${name}が正の整数ではありません。`);
  return v;
}
export function parseModelJSON(response) {
  if (response?.promptFeedback?.blockReason) throw new Error('Googleの安全性フィルターにより応答が停止しました。');
  const candidate = response?.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new Error(`AIの応答が完了しませんでした（${candidate.finishReason}）。未完成のデータは採用していません。`);
  const raw = candidate?.content?.parts?.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('') ?? '';
  if (!raw.trim()) throw new Error('AIから文字データが返りませんでした。モデル・画像を確認してください。');
  try { return JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')); }
  catch { throw new Error('AIの応答が正しいJSONではありません。もう一度実行してください。'); }
}
export function normalizeExtraction(data, photo) {
  if (!data || !Array.isArray(data.rows) || !Array.isArray(data.notes)) throw new Error('抽出結果の形式が正しくありません。');
  if (data.rows.length > 300) throw new Error('1枚の写真の抽出件数が多すぎます。写真を分けてください。');
  const notes = data.notes.map(x => text(x, '注意点'));
  const rows = data.rows.map(raw => {
    const english = text(raw.english, '英文');
    const japanese = text(raw.japanese, '日本語訳');
    if (!english) throw new Error('英文が空の行が含まれています。抽出をやり直してください。');
    const reasons = [text(raw.reason, '確認理由')];
    if (!japanese) reasons.push('写真から日本語訳を読み取れませんでした。');
    const pageNumber = photo.pageOverride ?? number(raw.pageNumber, 'ページ番号', true);
    if (!pageNumber) reasons.push('ページ番号を読み取れませんでした。');
    const reason = reasons.filter(Boolean).join(' / ');
    return { id: uid(), photoId: photo.id, photoName: photo.name, english, japanese, pageNumber,
      blockNumber: number(raw.blockNumber, 'ブロック番号'), exampleNumber: number(raw.exampleNumber, '例文番号', true),
      status: reason ? '要確認' : '抽出済み', reason, extractionReason: reason,
      originalEnglish: english, originalJapanese: japanese, suggestedEnglish: '', suggestedJapanese: '', checkedAt: null };
  });
  if (notes.length && rows.length) {
    rows[0].extractionReason = [rows[0].extractionReason, ...notes.map(n => `写真全体: ${n}`)].filter(Boolean).join(' / ');
    rows[0].reason = rows[0].extractionReason;
    rows[0].status = '要確認';
  }
  return { rows, notes };
}
export function validateReview(data, rows) {
  if (!data || !Array.isArray(data.checks) || !Array.isArray(data.pageIssues)) throw new Error('チェック結果の形式が正しくありません。');
  const expected = new Set(rows.map(r => r.id));
  const checks = new Map();
  for (const check of data.checks) {
    if (!expected.has(check.id) || checks.has(check.id)) throw new Error('チェック結果の行IDが一致しません。チェックをやり直してください。');
    if (!['ok', 'needs_review'].includes(check.verdict) || !Array.isArray(check.reasons)) throw new Error('チェック判定の形式が正しくありません。');
    const reasons = check.reasons.map(x => text(x, 'チェック理由')).filter(Boolean);
    const suggestedEnglish = text(check.suggestedEnglish, '英文候補');
    const suggestedJapanese = text(check.suggestedJapanese, '訳候補');
    if (check.verdict === 'needs_review' && !reasons.length) reasons.push('AIが要確認と判定しました。写真と照合してください。');
    if ((suggestedEnglish && suggestedEnglish !== rows.find(r => r.id === check.id).english) || (suggestedJapanese && suggestedJapanese !== rows.find(r => r.id === check.id).japanese)) {
      if (!reasons.length) reasons.push('AIから修正候補が提示されました。');
    }
    checks.set(check.id, { ...check, reasons, suggestedEnglish, suggestedJapanese });
  }
  if (checks.size !== expected.size) throw new Error('一部の行がチェックされていません。結果を採用せず停止しました。再チェックしてください。');
  return { checks, pageIssues: data.pageIssues.map(x => text(x, '写真全体の確認理由')).filter(Boolean) };
}
export function applyReview(rows, reviewed, { pageIssues = [] } = {}) {
  return rows.map((row, i) => {
    const c = reviewed.checks.get(row.id);
    const reasons = [row.extractionReason, ...c.reasons, ...(i === 0 ? pageIssues.map(n => `写真全体: ${n}`) : [])].filter(Boolean);
    return { ...row, status: reasons.length ? '要確認' : 'AI確認済み', reason: reasons.join(' / '),
      suggestedEnglish: c.suggestedEnglish !== row.english ? c.suggestedEnglish : '',
      suggestedJapanese: c.suggestedJapanese !== row.japanese ? c.suggestedJapanese : '', checkedAt: new Date().toISOString() };
  });
}
export function markEdited(row, field, value) {
  const next = { ...row, [field]: value };
  if (field !== 'reason') { next.checkedAt = null; next.suggestedEnglish = ''; next.suggestedJapanese = ''; }
  next.status = '要確認';
  next.reason = field === 'reason' ? value : '手動編集後の内容を確認してください。';
  return next;
}
export function makeCSV(rows, protectFormulas = true) {
  const cell = v => {
    let s = v === null || v === undefined ? '' : String(v);
    if (protectFormulas && /^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [HEADERS, ...rows.map(r => [r.english, r.japanese, r.photoName, r.pageNumber, r.blockNumber, r.exampleNumber, r.status, r.reason])].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
export function buildEndpoint(settings, model) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(model)) throw new Error('モデルIDの形式が正しくありません。');
  const path = `publishers/google/models/${model}:generateContent`;
  if (settings.provider === 'vertex') return `https://aiplatform.googleapis.com/v1/${path}`;
  if (settings.provider === 'gemini') return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  throw new Error('接続方式が正しくありません。');
}
export function validateSettings(settings) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(settings.projectId)) throw new Error('Google CloudのプロジェクトIDを入力してください（プロジェクト名や番号ではありません）。');
  if (!settings.apiKey || /\s/.test(settings.apiKey)) throw new Error('APIキーを空白なしで入力してください。');
  buildEndpoint(settings, settings.extractModel);
  buildEndpoint(settings, settings.reviewModel);
}
export function restoreSession(data) {
  if (data?.format !== 'example-ocr-session' || data.version !== 1 || !Array.isArray(data.rows) || data.rows.length > 50000) throw new Error('このツールの作業JSONではありません。');
  return data.rows.map(r => {
    const english = text(r.english, '英文'); if (!english) throw new Error('英文が空の行があります。');
    return { id: uid(), photoId: null, photoName: text(r.photoName, '写真名'), english, japanese: text(r.japanese, '日本語訳'),
      pageNumber: number(r.pageNumber, 'ページ番号', true), blockNumber: number(r.blockNumber, 'ブロック番号'), exampleNumber: number(r.exampleNumber, '例文番号', true),
      status: STATUSES.includes(r.status) ? r.status : '要確認', reason: text(r.reason ?? '', '確認理由'),
      extractionReason: text(r.extractionReason ?? '', '抽出時の確認理由'), originalEnglish: text(r.originalEnglish ?? english, '元の英文'),
      originalJapanese: text(r.originalJapanese ?? r.japanese, '元の訳'), suggestedEnglish: text(r.suggestedEnglish ?? '', '英文候補'), suggestedJapanese: text(r.suggestedJapanese ?? '', '訳候補'), checkedAt: null };
  });
}
