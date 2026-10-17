const SPAM_PATTERNS = [/\b(casino|viagra|crypto giveaway|payday loan)\b/ig, /免费领取.{0,8}(现金|贷款|奖品)/g];
export function detectLanguage(text = '') {
  // Japanese text commonly contains Kanji too, so test kana before Han characters.
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[a-z]/i.test(text)) return 'en';
  return 'unknown';
}
export function scoreSpam({ title = '', body = '', links = [] } = {}) {
  const text = `${title} ${body}`.slice(0, 100000);
  let score = 0;
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  if (words.length > 30) {
    const freq = new Map(); for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    const maxRepeat = Math.max(...freq.values());
    if (maxRepeat / words.length > 0.12) score += 0.25;
  }
  for (const re of SPAM_PATTERNS) { re.lastIndex = 0; const hits = [...text.matchAll(re)].length; score += Math.min(0.18, hits * 0.06); }
  const linkDensity = links.length / Math.max(1, Math.ceil(text.length / 500));
  if (linkDensity > 12) score += 0.2;
  if (title.length < 4 || body.trim().length < 180) score += 0.12;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}
export function scoreQuality({ title = '', description = '', body = '', language = 'unknown', spamScore = 0 } = {}) {
  const length = body.trim().length;
  const lengthScore = Math.min(1, length / 1800);
  const titleScore = title.trim().length >= 8 ? 1 : 0.25;
  const descriptionScore = description.trim().length >= 30 ? 1 : 0.35;
  const languageScore = language === 'unknown' ? 0.55 : 1;
  return Math.max(0, Math.min(1, Number((0.35 * lengthScore + 0.2 * titleScore + 0.1 * descriptionScore + 0.1 * languageScore + 0.25 * (1 - spamScore)).toFixed(3))));
}
