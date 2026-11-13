import {readAll, transaction} from './storage.js';
import {OTHER_QUESTIONS, questionFor, seoulDay, currentSlot, reflectionGroups, dueReflection} from './reflection-core.js';

const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function initReflections({getDB, onChange, onOpen, toast}) {
  const $ = selector => document.querySelector(selector);
  let records = [], slot = currentSlot() || 'morning', selectedDay = seoulDay(), busy = false, followsClock = true;
  let draftQueue = Promise.resolve(), draftTimer;
  const drafts = new Map(), dirtyDrafts = new Set();
  const key = () => `${selectedDay}:${slot}`;
  const answerFor = () => records.find(log => log.reflection?.type === 'answer' && log.reflection.day === selectedDay && log.reflection.slot === slot);
  async function read() {
    const db = getDB();
    if (!db) { $('#reflection-status').textContent = '저장소에 연결할 수 없어 답변을 저장할 수 없습니다.'; return; }
    records = (await readAll(db)).logs.filter(log => log.reflection);
    await tick();
    render();
  }
  function render(forceAnswer = false) {
    if (busy) return;
    showDue();
    const available = selectedDay < seoulDay() || (selectedDay === seoulDay() && (slot === 'morning' ? Boolean(currentSlot()) : currentSlot() === 'evening'));
    $('#reflection-form').hidden = !available;
    $('#reflection-waiting').hidden = available;
    $('#reflection-waiting').textContent = `이 질문은 오늘 ${slot === 'morning' ? '오전 9시 30분' : '오후 7시 30분'}부터 답할 수 있어요. 시간이 되면 앱에 접속할 때 보여드릴게요.`;
    const answer = answerFor(), q = answer?.reflection || questionFor(selectedDay, slot);
    $('#reflection-date').textContent = `${selectedDay} · 한국 시간`;
    document.querySelectorAll('[data-slot]').forEach(button => {
      button.classList.toggle('selected', button.dataset.slot === slot);
      button.setAttribute('aria-pressed', String(button.dataset.slot === slot));
    });
    $('#reflection-question').textContent = available ? q.question : '아직 질문 시간이 되지 않았어요.';
    $('#reflection-source').hidden = !available;
    $('#reflection-source').textContent = `질문 ${q.questionId} · ${answer?.tags[0] || q.theme} · ${q.context || '이전에 남긴 답변을 수정할 수 있어요.'}`;
    if (forceAnswer || document.activeElement !== $('#reflection-answer')) $('#reflection-answer').value = drafts.get(key()) ?? answer?.raw ?? '';
    $('#reflection-save').textContent = answer ? '답변 수정 저장' : '답변 저장';
    $('#reflection-save').disabled = !getDB();
    const answers = records.filter(log => log.reflection.type === 'answer');
    $('#reflection-progress').textContent = `답변 ${answers.length}개 · 다음 회고까지 ${7 - answers.length % 7}개. 건너뛴 날은 채우지 않아도 괜찮아요.`;
    renderReviews(); renderHistory();
  }
  function renderReviews() {
    const groups = reflectionGroups(records);
    const reviews = records.filter(log => log.reflection.type === 'review');
    $('#reflection-reviews').innerHTML = groups.length ? groups.map((group, index) => {
      const ids = group.map(log => log.id);
      const saved = reviews.find(log => log.reflection.answerIds.every(id => ids.includes(id)));
      const themes = new Map();
      group.forEach(log => themes.set(log.tags[0], (themes.get(log.tags[0]) || 0) + 1));
      return `<details class="reflection-review"><summary>${index + 1}번째 회고 · 답변 7개${saved ? ' · 작성 완료' : ' · 작성해 보기'}</summary>
        <p class="hint">주제별 답변 수: ${[...themes].map(([theme,count]) => `${escapeHTML(theme)} ${count}개`).join(' · ')}. 질문의 분포이며 성격 분석이 아닙니다.</p>
        ${group.map(log => `<blockquote><strong>${escapeHTML(log.reflection.question)}</strong><p>${escapeHTML(log.raw)}</p></blockquote>`).join('')}
        <form data-review="${index}"><label>반복되는 패턴 · 반대 사례 · 아직 불확실한 해석 · 다음 작은 실험<textarea aria-label="${index + 1}번째 회고" name="review" rows="6" maxlength="5000" required placeholder="반복되는 패턴:\n반대 사례:\n아직 불확실한 해석:\n다음 작은 실험:">${escapeHTML(saved?.raw || '')}</textarea></label><button type="submit">회고 저장</button></form></details>`;
    }).join('') : '<p class="hint">답변이 7개 쌓이면 해당 답변을 함께 보며 회고할 수 있어요. 해석은 언제든 고칠 수 있는 가설로 남겨주세요.</p>';
  }
  function renderHistory() {
    const query = $('#reflection-search').value.trim().toLocaleLowerCase('ko-KR');
    const filtered = [...records].sort((a,b) => b.date.localeCompare(a.date)).filter(log => [log.raw, log.context, ...log.tags].join(' ').toLocaleLowerCase('ko-KR').includes(query));
    $('#reflection-history').innerHTML = filtered.length ? filtered.map(log => `<article class="reflection-entry"><div class="note-head"><strong>${{answer:'내 답변',feedback:'주변의 관찰',review:'회고'}[log.reflection.type]}</strong><time>${escapeHTML(log.reflection.day || seoulDay(new Date(log.date)))}</time></div><h3>${escapeHTML(log.context)}</h3><p>${escapeHTML(log.raw)}</p>${log.hypothesis ? `<p>내 해석: ${escapeHTML(log.hypothesis)}</p>` : ''}<div class="note-actions">${log.reflection.type === 'answer' ? `<button data-open-answer="${escapeHTML(log.id)}">답변 수정</button>` : ''}<button data-remove-reflection="${escapeHTML(log.id)}">삭제</button></div></article>`).join('') : '<p class="hint">아직 답변이 없거나 검색에 맞는 기록이 없어요.</p>';
  }
  async function write(log) {
    const db = getDB();
    if (!db || busy) return false;
    busy = true;
    document.querySelectorAll('#reflection form button, #reflection form input, #reflection form textarea').forEach(button => { button.disabled = true; });
    try {
      await transaction(db, ['logs'], 'readwrite', tx => tx.objectStore('logs').put(log));
      records = [...records.filter(item => item.id !== log.id), log];
      onChange(); toast('기기에 저장했어요.'); return true;
    } catch { toast('저장하지 못했어요. 입력을 유지하고 있습니다.'); return false; }
    finally { busy = false; document.querySelectorAll('#reflection form button, #reflection form input, #reflection form textarea').forEach(button => { button.disabled = false; }); }
  }
  function logFor({id, date, raw, context, theme, reflection, hypothesis = ''}) {
    return {id:id || crypto.randomUUID(), date:date || new Date().toISOString(), energy:0, tags:[theme], context, raw, trigger:'', hypothesis, audio:null, reflection};
  }
  function persistDraft() {
    clearTimeout(draftTimer);
    const db = getDB();
    if (!db) return draftQueue;
    const answerKey = key();
    if (!dirtyDrafts.has(answerKey)) return draftQueue;
    const draftKey = 'reflection-draft:' + answerKey, value = drafts.get(answerKey) ?? '';
    dirtyDrafts.delete(answerKey);
    draftQueue = draftQueue.catch(() => {}).then(() => transaction(db, ['meta'], 'readwrite', tx => {
      if (value) tx.objectStore('meta').put(value, draftKey); else tx.objectStore('meta').delete(draftKey);
    })).then(() => { $('#reflection-status').textContent = '답변 초안을 기기에 보관했어요.'; }).catch(() => { dirtyDrafts.add(answerKey); $('#reflection-status').textContent = '초안 보관 실패 · 입력을 유지하고 있어요.'; });
    return draftQueue;
  }
  async function switchAnswer(day, nextSlot, manual = false) {
    if (busy) return;
    await persistDraft();
    if (manual) followsClock = false;
    selectedDay = day; slot = nextSlot;
    if (!drafts.has(key()) && getDB()) {
      try {
        const saved = await transaction(getDB(), ['meta'], 'readonly', (tx, output) => { tx.objectStore('meta').get('reflection-draft:' + key()).onsuccess = event => output(event.target.result); });
        if (typeof saved === 'string') drafts.set(key(), saved);
      } catch { toast('초안을 읽지 못했어요.'); }
    }
    render(true);
  }
  $('#reflection-answer').oninput = () => { drafts.set(key(), $('#reflection-answer').value); dirtyDrafts.add(key()); clearTimeout(draftTimer); draftTimer = setTimeout(persistDraft, 350); };
  document.querySelectorAll('[data-slot]').forEach(button => { button.onclick = () => switchAnswer(seoulDay(), button.dataset.slot, true); });
  $('#reflection-form').onsubmit = async event => {
    event.preventDefault();
    const raw = $('#reflection-answer').value.trim();
    if (!raw || busy) return;
    const existing = answerFor(), q = existing?.reflection || questionFor(selectedDay, slot);
    await persistDraft();
    const saved = await write(logFor({id:existing?.id || `reflection:${selectedDay}:${slot}`, date:existing?.date, raw, context:q.question, theme:existing?.tags[0] || q.theme,
      reflection:{type:'answer', day:selectedDay, slot, questionId:q.questionId, question:q.question}}));
    if (saved) {
      drafts.delete(key());
      try { await transaction(getDB(), ['meta'], 'readwrite', tx => tx.objectStore('meta').delete('reflection-draft:' + key())); }
      catch { toast('답변은 저장됐지만 초안을 지우지 못했어요.'); }
      render(); $('#reflection-status').textContent = '답변이 저장되었습니다.';
    }
  };
  $('#reflection-reviews').onsubmit = async event => {
    const form = event.target.closest('[data-review]');
    if (!form) return;
    event.preventDefault();
    const group = reflectionGroups(records)[Number(form.dataset.review)], raw = form.elements.review.value.trim();
    if (!group || !raw) return;
    const ids = group.map(log => log.id), existing = records.find(log => log.reflection.type === 'review' && log.reflection.answerIds.every(id => ids.includes(id)));
    if (await write(logFor({id:existing?.id, date:existing?.date, raw, context:'답변 7개 돌아보기', theme:'자기이해 회고', reflection:{type:'review', answerIds:ids}}))) render();
  };
  $('#reflection-search').oninput = renderHistory;
  $('#reflection-history').onclick = async event => {
    const edit = event.target.closest('[data-open-answer]'), remove = event.target.closest('[data-remove-reflection]');
    if (edit) {
      const log = records.find(item => item.id === edit.dataset.openAnswer);
      await switchAnswer(log.reflection.day, log.reflection.slot, true); $('#reflection-answer').focus();
    }
    if (remove && !busy && getDB() && confirm('이 자기이해 기록을 삭제할까요? 삭제한 기록은 되돌릴 수 없습니다.')) {
      try { await transaction(getDB(), ['logs'], 'readwrite', tx => tx.objectStore('logs').delete(remove.dataset.removeReflection)); onChange(); await read(); toast('기록을 삭제했어요.'); }
      catch { toast('삭제하지 못했어요.'); }
    }
  };
  $('#reflection-others').innerHTML = OTHER_QUESTIONS.map((item,index) => `<article class="reflection-entry"><h3>${escapeHTML(item.person)}</h3><p>${escapeHTML(item.question)}</p><p class="hint">관련 질문 ${item.ids}번</p><button type="button" data-feedback="${index}">들은 답변 기록하기</button></article>`).join('');
  $('#reflection-others').onclick = event => {
    const button = event.target.closest('[data-feedback]'); if (!button) return;
    $('#feedback-question').value = OTHER_QUESTIONS[Number(button.dataset.feedback)].question; $('#feedback-person').focus();
  };
  $('#feedback-form').onsubmit = async event => {
    event.preventDefault();
    const person = $('#feedback-person').value.trim(), question = $('#feedback-question').value.trim(), raw = $('#feedback-answer').value.trim();
    if (!person || !question || !raw) return;
    if (await write(logFor({raw, context:`${person}에게 물었어요: ${question}`, theme:'주변의 관찰', hypothesis:$('#feedback-interpretation').value.trim(), reflection:{type:'feedback', person, question}}))) { $('#feedback-form').reset(); render(); }
  };
  function showDue() {
    const due = dueReflection(records);
    $('#reflection-due').hidden = !due || !$('#reflection').hidden || !getDB();
    if (due) {
      $('#reflection-due-title').textContent = `${due.slot === 'morning' ? '아침' : '저녁'} 자기이해 질문이 도착했어요`;
      $('#reflection-due-question').textContent = due.question;
    }
  }
  $('#reflection-open-due').onclick = async () => {
    const due = dueReflection(records);
    if (!due || busy) return;
    await switchAnswer(due.day, due.slot, true);
    onOpen(); showDue(); $('#reflection-answer').focus();
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistDraft(); });
  window.addEventListener('pagehide', persistDraft);
  // Never replace text while someone is answering, even if the next time slot begins.
  const tick = async () => {
    const day = seoulDay(), nextSlot = currentSlot(), value = $('#reflection-answer').value;
    if (nextSlot && followsClock && !busy && (day !== selectedDay || nextSlot !== slot) && (!value.trim() || value === answerFor()?.raw)) await switchAnswer(day, nextSlot);
    if (!busy) {
      const available = selectedDay < day || (selectedDay === day && (slot === 'morning' ? Boolean(nextSlot) : nextSlot === 'evening'));
      if ($('#reflection-form').hidden === available) render(); else showDue();
    }
  };
  setInterval(() => tick().catch(() => toast('질문 시간을 확인하지 못했어요.')), 60000);
  async function start() {
    await read();
    if (getDB()) {
      try {
        const saved = await transaction(getDB(), ['meta'], 'readonly', (tx, output) => { tx.objectStore('meta').get('reflection-draft:' + key()).onsuccess = event => output(event.target.result); });
        if (typeof saved === 'string') { drafts.set(key(), saved); render(); }
      } catch { toast('자기이해 초안을 읽지 못했어요.'); }
    }
  }
  return {refresh:read, start, showDue};
}
