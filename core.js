export const TAGS = ['회의', '집중 작업', '사람과 대화', '혼자 있는 시간', '운동', '이동', '휴식', '새로운 도전'];
export const ENERGY = {'1': '충전', '0': '평온', '-1': '방전'};
export const BACKUP_LIMIT = 100 * 1024 * 1024;
export const emotional = text => /짜증|힘들|힘든|최악|무능|자책|왜 이럴|싫어|싫다|우울|망했|한심/.test(text);
export const summarize = text => text.trim().split(/(?<=[.!?。])\s+|\n/)[0]?.slice(0, 160) || '';
export const hasDraft = draft => draft.energy !== null || draft.tags.length > 0 ||
  ['context', 'raw', 'trigger', 'hypothesis'].some(key => draft[key].trim()) || Boolean(draft.audio);

export function inPeriod(logs, days, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return logs.filter(log => new Date(log.date) >= start && new Date(log.date) <= now);
}

export function rankings(logs, energy) {
  const counts = new Map();
  logs.filter(log => log.energy === energy).forEach(log => {
    new Set(log.tags).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1));
  });
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
}

export function daySummary(logs, date) {
  const items = logs.filter(log => new Date(log.date).toDateString() === date.toDateString());
  return {count: items.length, average: items.length ? items.reduce((sum, log) => sum + log.energy, 0) / items.length : null};
}

export function filterLogs(logs, query = '', energy = 'all') {
  const q = query.trim().toLocaleLowerCase('ko-KR');
  return logs.filter(log => (energy === 'all' || log.energy === Number(energy)) &&
    [log.context, log.raw, log.trigger, log.hypothesis, ...log.tags].join(' ').toLocaleLowerCase('ko-KR').includes(q));
}

export function validateBackup(data) {
  if (data?.format !== 'bug-book' || data.version !== 1 || !Array.isArray(data.logs) || data.logs.length > 100000) {
    throw Error('버그 북 백업 형식이 아닙니다.');
  }
  const ids = new Set();
  return data.logs.map(log => {
    const validDate = typeof log?.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(log.date) &&
      Number.isFinite(Date.parse(log.date)) && new Date(log.date).toISOString() === log.date;
    const validAudio = log?.audio === null || (typeof log?.audio === 'string' &&
      /^data:audio\/[a-z0-9.+-]+(?:;[a-z0-9=., -]+)*;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/i.test(log.audio));
    if (!log || typeof log.id !== 'string' || !log.id.trim() || log.id.length > 100 || ids.has(log.id) || !validDate ||
      ![-1, 0, 1].includes(log.energy) || !Array.isArray(log.tags) || !log.tags.length || log.tags.length > 50 ||
      log.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 30) ||
      ['context', 'raw', 'trigger', 'hypothesis'].some(key => typeof log[key] !== 'string' || log[key].length > 5000) || !validAudio) {
      throw Error('백업에 잘못된 기록이 있습니다. 기존 기록은 변경하지 않았습니다.');
    }
    ids.add(log.id);
    return {id: log.id, date: log.date, energy: log.energy, tags: [...new Set(log.tags.map(tag => tag.trim()))],
      context: log.context, raw: log.raw, trigger: log.trigger, hypothesis: log.hypothesis, audio: log.audio};
  });
}
