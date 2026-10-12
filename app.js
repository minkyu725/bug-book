import {TAGS, ENERGY, BACKUP_LIMIT, emotional, summarize, hasDraft, inPeriod, rankings, daySummary, filterLogs, validateBackup} from './core.js';
import {openDatabase, readAll, writeDraft, saveLog, removeLog, undoDelete, mergeLogs} from './storage.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const fields = ['context', 'raw', 'trigger', 'hypothesis'];
const PAGE_SIZE = 20;
let db, logs = [], energy = null, tags = new Set(), audio = null, editing = null;
let days = 7, visibleCount = PAGE_SIZE, activeView = 'capture', trash = null;
let recorder, recordingStream, recognition, mediaBusy = false, saving = false;
let recordTimer, draftTimer, toastTimer, draftQueue = Promise.resolve(), draftDirty = false;
let channel;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}

function snapshot() {
  return {energy, tags: [...tags], audio, editing,
    ...Object.fromEntries(fields.map(key => [key, $('#' + key).value]))};
}

function updateDraftStatus(message) { $('#draft-status').textContent = message; }

function persistDraft() {
  clearTimeout(draftTimer);
  if (!db || saving || !draftDirty) return draftQueue;
  const draft = snapshot();
  draftDirty = false;
  // Serialize autosaves so an older completion cannot overwrite a newer draft.
  draftQueue = draftQueue.then(() => writeDraft(db, hasDraft(draft) ? draft : null)).then(() => {
    updateDraftStatus(hasDraft(draft) ? '✓ 초안이 기기에 보관되었습니다' : '에너지와 태그만 선택해도 저장할 수 있어요');
  }).catch(() => {
    draftDirty = true;
    updateDraftStatus('초안 보관 실패 · 입력을 유지하고 있습니다');
  });
  return draftQueue;
}

function changed() {
  if (saving) return;
  draftDirty = true;
  updateDraftStatus('초안 보관 중…');
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 350);
}

function syncEnergy() {
  $$('[data-energy]').forEach(button => {
    const selected = Number(button.dataset.energy) === energy;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function rememberTags(values) {
  values.forEach(tag => { if (!TAGS.includes(tag)) TAGS.push(tag); });
}

function renderTags() {
  $('#tags').innerHTML = TAGS.map(tag => `<button type="button" data-tag="${esc(tag)}" class="${tags.has(tag) ? 'selected' : ''}" aria-pressed="${tags.has(tag)}">${esc(tag)}</button>`).join('');
}

function setAudio(value) {
  audio = value;
  $('#preview').pause();
  if (audio) $('#preview').src = audio; else $('#preview').removeAttribute('src');
  $('#preview').hidden = !audio;
  $('#discard').hidden = !audio;
}

function applyDraft(draft) {
  energy = draft.energy; tags = new Set(draft.tags); editing = draft.editing || null;
  rememberTags(draft.tags);
  fields.forEach(key => { $('#' + key).value = draft[key]; });
  setAudio(draft.audio); syncEnergy(); renderTags();
  $('#observer').hidden = !emotional($('#raw').value);
  $('#save').textContent = editing ? '수정 저장하기 ↗' : '관찰 저장하기 ↗';
  $('#cancel-edit').hidden = !editing;
  if (draft.trigger || draft.hypothesis) $('details').open = true;
}

function resetForm() {
  $('#form').reset(); energy = null; tags.clear(); editing = null;
  setAudio(null); syncEnergy(); renderTags();
  $('#observer').hidden = true; $('#cancel-edit').hidden = true;
  $('#save').textContent = '관찰 저장하기 ↗';
  $('details').open = false;
  updateDraftStatus('에너지와 태그만 선택해도 저장할 수 있어요');
}

function lockForm(locked) {
  saving = locked;
  $$('#form button, #form input, #form textarea').forEach(control => { control.disabled = locked; });
  $('#form').setAttribute('aria-busy', String(locked));
}

function mediaActive() { return mediaBusy || recorder?.state === 'recording' || Boolean(recognition); }

$('#tags').onclick = event => {
  const button = event.target.closest('[data-tag]');
  if (!button || saving) return;
  const tag = button.dataset.tag;
  if (!tags.has(tag) && tags.size >= 50) return toast('태그는 최대 50개까지 선택하세요.');
  if (tags.has(tag)) tags.delete(tag); else tags.add(tag);
  renderTags(); changed();
};
$('#add-tag').onclick = () => {
  const tag = $('#new-tag').value.trim();
  if (!tag) return;
  if (!tags.has(tag) && tags.size >= 50) return toast('태그는 최대 50개까지 선택하세요.');
  rememberTags([tag]); tags.add(tag); $('#new-tag').value = ''; renderTags(); changed();
};
$('#new-tag').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('#add-tag').click(); } };
$$('[data-energy]').forEach(button => {
  button.setAttribute('aria-pressed', 'false');
  button.onclick = () => { energy = Number(button.dataset.energy); syncEnergy(); changed(); };
});
fields.forEach(key => { $('#' + key).addEventListener('input', () => {
  if (key === 'raw') $('#observer').hidden = !emotional($('#raw').value);
  changed();
}); });
$('#discard').onclick = () => { setAudio(null); changed(); };

function view(name, scroll = false) {
  if (!['capture', 'logs', 'report', 'settings'].includes(name)) name = 'capture';
  activeView = name;
  $$('.view').forEach(section => { section.hidden = section.id !== name; });
  $$('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === name);
    if (button.dataset.view === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (location.hash !== '#' + name) location.hash = name;
  render();
  if (scroll) window.scrollTo({top: 0, behavior: 'instant'});
}
$$('[data-view]').forEach(button => { button.onclick = () => view(button.dataset.view, true); });
window.addEventListener('hashchange', () => view(location.hash.slice(1)));

async function refresh() {
  const state = await readAll(db);
  logs = state.logs.sort((a, b) => new Date(b.date) - new Date(a.date));
  trash = state.trash || null;
  logs.forEach(log => rememberTags(log.tags));
  render();
  return state;
}
function broadcast() { channel?.postMessage('changed'); }

$('#form').onsubmit = async event => {
  event.preventDefault();
  if (!db || saving) return;
  if (energy === null) { toast('에너지 상태를 선택하세요.'); $('[data-energy]').focus(); return; }
  if (!tags.size) { toast('상황 태그를 선택하세요.'); $('#tags button').focus(); return; }
  if (mediaActive()) return toast('음성 입력을 마친 후 저장하세요.');
  clearTimeout(draftTimer);
  const draft = snapshot();
  const log = {id: editing?.id || crypto.randomUUID(), date: editing?.date || new Date().toISOString(),
    energy: draft.energy, tags: draft.tags, audio: draft.audio,
    ...Object.fromEntries(fields.map(key => [key, draft[key].trim()]))};
  lockForm(true);
  try {
    await draftQueue;
    await saveLog(db, log, Boolean(editing));
  } catch (error) {
    lockForm(false); draftDirty = true; persistDraft();
    toast(error.message || '저장하지 못했어요. 저장 공간을 확인하세요.');
    return;
  }
  const wasEditing = Boolean(editing);
  draftDirty = false; resetForm(); lockForm(false);
  // A failed list refresh must not be reported as a failed durable save.
  logs = [log, ...logs.filter(item => item.id !== log.id)].sort((a, b) => new Date(b.date) - new Date(a.date));
  render(); broadcast();
  toast(wasEditing ? '관찰을 수정했어요.' : '관찰을 저장했어요. 한 걸음 더 알아갔네요.');
};

$('#cancel-edit').onclick = async () => {
  if (mediaActive()) return toast('음성 입력을 먼저 마쳐 주세요.');
  if (!confirm('수정 중인 내용을 버리고 새 관찰을 시작할까요? 원본 기록은 유지됩니다.')) return;
  clearTimeout(draftTimer); lockForm(true);
  try { await draftQueue; await writeDraft(db, null); draftDirty = false; resetForm(); }
  catch { toast('초안을 비우지 못했어요. 다시 시도하세요.'); }
  finally { lockForm(false); }
};

function render() {
  $('#count').textContent = daySummary(logs, new Date()).count;
  if (activeView === 'logs') renderLogs();
  if (activeView === 'report') renderReport();
}

function renderLogs() {
  const filtered = filterLogs(logs, $('#search').value, $('#filter').value);
  $('#log-result').textContent = `${filtered.length}개의 관찰`;
  $('#undo-panel').hidden = !trash;
  $('#list').innerHTML = filtered.length ? filtered.slice(0, visibleCount).map(log => {
    const stamp = new Date(log.date);
    return `<article class="card note"><div class="note-head"><strong class="${log.energy === -1 ? 'drain' : ''}">${ENERGY[log.energy]}</strong><span>OBSERVATION</span><time datetime="${stamp.toISOString()}">${stamp.toLocaleString('ko-KR', {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</time></div><h3>${esc(log.context || summarize(log.raw) || '에너지와 상황을 기록한 관찰')}</h3>${log.raw ? `<p>${esc(log.raw)}</p>` : ''}<p class="note-tags">${log.tags.map(tag => '#' + esc(tag)).join(' · ')}</p>${log.trigger ? `<p><b>트리거</b>　${esc(log.trigger)}</p>` : ''}${log.hypothesis ? `<p><b>다음 실험</b>　${esc(log.hypothesis)}</p>` : ''}${log.audio ? `<audio controls preload="none" src="${esc(log.audio)}"></audio>` : ''}<div class="note-actions"><button data-edit="${esc(log.id)}">기록 수정</button><button data-delete="${esc(log.id)}">기록 삭제</button></div></article>`;
  }).join('') : `<div class="empty"><strong>${logs.length ? '검색 결과가 없어요.' : '아직 수집한 관찰이 없어요.'}</strong><p>${logs.length ? '검색어나 에너지 필터를 바꿔 보세요.' : '에너지와 상황으로 오늘의 첫 관찰을 남겨 보세요.'}</p></div>`;
  $('#load-more').hidden = filtered.length <= visibleCount;
}
function searchChanged() { visibleCount = PAGE_SIZE; renderLogs(); }
$('#search').oninput = searchChanged; $('#filter').onchange = searchChanged;
$('#load-more').onclick = () => { visibleCount += PAGE_SIZE; renderLogs(); };

$('#list').onclick = async event => {
  const edit = event.target.closest('[data-edit]'), remove = event.target.closest('[data-delete]');
  if (!db || saving || (!edit && !remove)) return;
  if (edit) {
    if (mediaActive()) return toast('음성 입력을 먼저 마쳐 주세요.');
    const log = logs.find(item => item.id === edit.dataset.edit);
    if (!log) return;
    if (hasDraft(snapshot()) && !confirm('현재 초안을 이 기록의 수정 내용으로 바꿀까요?')) return;
    applyDraft({...log, editing: {id: log.id, date: log.date}});
    changed(); await persistDraft(); view('capture', true); $('#context').focus();
    return;
  }
  if (!confirm('이 관찰을 삭제할까요? 가장 최근 삭제 1건은 취소할 수 있습니다.')) return;
  remove.disabled = true;
  try {
    const deleted = await removeLog(db, remove.dataset.delete);
    if (deleted) { logs = logs.filter(log => log.id !== deleted.id); trash = deleted; render(); broadcast(); toast('삭제했어요. 목록 위에서 삭제를 취소할 수 있어요.'); }
  } catch { remove.disabled = false; toast('삭제하지 못했어요.'); }
};
$('#undo-delete').onclick = async () => {
  $('#undo-delete').disabled = true;
  try { await undoDelete(db); await refresh(); broadcast(); toast('관찰과 음성을 복원했어요.'); }
  catch (error) { toast(error.message || '삭제를 취소하지 못했어요.'); }
  finally { $('#undo-delete').disabled = false; }
};

function rank(items, drain, total) {
  return `<div class="${drain ? 'drain-bars' : ''}">${items.length ? items.map(([tag, count], i) => `<div class="rank-label"><span>0${i + 1}　${esc(tag)}</span><span>${count}회 · ${Math.round(count / total * 100)}%</span></div><div class="bar"><i style="width:${count / total * 100}%"></i></div>`).join('') : '<p class="hint">아직 이 상태의 관찰이 없어요.</p>'}</div>`;
}
function renderReport() {
  const periodLogs = inPeriod(logs, days), now = new Date();
  const up = periodLogs.filter(log => log.energy === 1).length, down = periodLogs.filter(log => log.energy === -1).length;
  let trend = '';
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now); date.setDate(date.getDate() - i);
    const {average, count} = daySummary(periodLogs, date);
    const direction = average === null ? '기록 없음' : average > 0 ? '충전' : average < 0 ? '방전' : '평균 평온';
    trend += `<div class="trend-cell" role="img" aria-label="${date.getMonth() + 1}월 ${date.getDate()}일 ${direction}, ${count}회"><div style="color:${average < 0 ? '#b38563' : '#708951'}">${average === null ? '·' : average > 0 ? '↗' : average < 0 ? '↘' : '→'}</div>${date.getMonth() + 1}/${date.getDate()}</div>`;
  }
  $('#report-content').innerHTML = `<div class="stats">${[['전체 관찰', periodLogs.length], ['충전 관찰', up], ['방전 관찰', down]].map(([title, count]) => `<article class="card"><span>${title}</span><strong>${count}</strong></article>`).join('')}</div><article class="card"><h2>일별 에너지 흐름</h2><p class="hint">그날의 평균 변화 방향 · 기록 없는 날은 점으로 표시</p><div class="trend">${trend}</div></article><div class="report-grid"><article class="card"><h2>↘ 에너지가 누수된 상황 TOP 3</h2><p class="hint">방전 관찰 ${down}회 중 포함된 비율</p>${rank(rankings(periodLogs, -1), true, down)}</article><article class="card"><h2>↗ 에너지가 충전된 상황 TOP 3</h2><p class="hint">충전 관찰 ${up}회 중 포함된 비율</p>${rank(rankings(periodLogs, 1), false, up)}</article></div>${periodLogs.length > 0 && periodLogs.length < 5 ? '<p class="hint">관찰이 아직 적습니다. 몇 번 더 기록하고 반복되는 조건을 살펴보세요.</p>' : ''}`;
}
$$('[data-days]').forEach(button => {
  button.setAttribute('aria-pressed', String(Number(button.dataset.days) === days));
  button.onclick = () => { days = Number(button.dataset.days); $$('[data-days]').forEach(item => {
    const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected));
  }); renderReport(); };
});

function voiceStatus(message) { $('#voice-status').textContent = message; }
function stopMedia() {
  if (recorder?.state === 'recording') { mediaBusy = true; $('#record').disabled = true; recorder.stop(); }
  recognition?.stop();
}
$('#record').onclick = async () => {
  if (recorder?.state === 'recording') { stopMedia(); return; }
  if (mediaBusy || saving) return;
  if (recognition) return toast('받아쓰기를 먼저 마쳐 주세요.');
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('녹음 미지원 브라우저입니다. 키보드 마이크를 이용하세요.');
  if (audio && !confirm('이전 녹음을 새 녹음으로 바꿀까요?')) return;
  mediaBusy = true; $('#record').disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio: true});
    recordingStream = stream;
    if (document.visibilityState === 'hidden') { stream.getTracks().forEach(track => track.stop()); return; }
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    const current = new MediaRecorder(stream, mime ? {mimeType: mime} : {});
    recorder = current;
    const chunks = [], started = Date.now();
    const cleanUp = () => {
      clearInterval(recordTimer); stream.getTracks().forEach(track => track.stop());
      mediaBusy = false; $('#record').disabled = saving; $('#record').textContent = '◉ 음성 녹음';
    };
    current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    current.onstop = async () => {
      clearInterval(recordTimer); stream.getTracks().forEach(track => track.stop());
      mediaBusy = true; $('#record').disabled = true;
      try {
        const blob = new Blob(chunks, {type: current.mimeType || 'audio/mp4'});
        if (!blob.size) throw Error();
        const value = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
        });
        setAudio(value); changed(); await persistDraft(); voiceStatus('녹음 완료 · 저장할 관찰에 첨부됩니다');
      } catch { toast('녹음을 저장하지 못했어요. 이전 녹음은 유지됩니다.'); }
      finally { cleanUp(); }
    };
    current.onerror = () => { cleanUp(); toast('녹음 오류가 발생했어요. 다시 시도하세요.'); };
    current.start(1000);
    $('#record').textContent = '■ 녹음 마치기'; voiceStatus('녹음 중 0:00 / 2:00');
    recordTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      voiceStatus(`녹음 중 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / 2:00`);
      if (seconds >= 120 && current.state === 'recording') stopMedia();
    }, 1000);
  } catch { recordingStream?.getTracks().forEach(track => track.stop()); toast('마이크 권한을 허용하고 다시 시도하세요.'); }
  finally { mediaBusy = false; $('#record').disabled = saving; }
};
$('#dictate').onclick = () => {
  if (recognition) { recognition.stop(); return; }
  if (mediaActive() || saving) return toast('녹음을 먼저 마쳐 주세요.');
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) return toast('받아쓰기 미지원입니다. 아이폰 키보드 마이크를 이용하세요.');
  if (!navigator.onLine) return toast('받아쓰기는 온라인에서 이용하세요. 녹음과 텍스트 기록은 오프라인에서도 가능합니다.');
  if (!confirm('음성 인식을 시작할까요? 음성이 브라우저 제공자의 서비스로 전송될 수 있습니다.')) return;
  const current = new Speech(); recognition = current;
  current.lang = 'ko-KR'; current.continuous = true;
  current.onresult = event => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) $('#raw').value = ($('#raw').value + ' ' + event.results[i][0].transcript).trim().slice(0, 5000);
    }
    $('#raw').dispatchEvent(new Event('input'));
  };
  current.onerror = event => { if (event.error !== 'aborted') toast('음성 인식을 사용할 수 없어요. 키보드 마이크를 이용하세요.'); };
  current.onend = () => { recognition = null; $('#dictate').textContent = '♩ 받아쓰기'; persistDraft(); voiceStatus('받아쓰기를 마쳤어요.'); };
  try { current.start(); $('#dictate').textContent = '■ 받아쓰기 마치기'; voiceStatus('한국어 음성 인식 중…'); }
  catch { recognition = null; toast('음성 인식을 시작하지 못했어요.'); }
};

$('#export').onclick = async () => {
  if (!db) return;
  $('#export').disabled = true;
  try {
    const {logs: latest} = await readAll(db);
    const blob = new Blob([JSON.stringify({format: 'bug-book', version: 1, exportedAt: new Date().toISOString(), logs: latest}, null, 2)], {type: 'application/json'});
    if (blob.size > BACKUP_LIMIT) throw Error('백업이 100MB를 넘습니다. 음성이 많은 기록을 정리한 뒤 다시 시도하세요.');
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `bug-book-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('백업 다운로드를 요청했어요. 다운로드 폴더를 확인하세요.');
  } catch (error) { toast(error.message || '백업을 만들지 못했어요.'); }
  finally { $('#export').disabled = false; }
};
$('#import').onchange = async event => {
  const file = event.target.files[0]; if (!file || !db) return;
  $('#import').disabled = true;
  try {
    if (file.size > BACKUP_LIMIT) throw Error('100MB 이하의 백업을 선택하세요.');
    const imported = validateBackup(JSON.parse(await file.text()));
    const added = await mergeLogs(db, imported);
    await refresh(); renderTags(); broadcast();
    toast(`${added}개 추가 · ${imported.length - added}개 중복 유지`);
  } catch (error) { toast(error instanceof SyntaxError ? '올바른 JSON 파일이 아닙니다.' : error.message || '가져오지 못했어요.'); }
  finally { $('#import').disabled = false; $('#import').value = ''; }
};

let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('#install').hidden = false; });
$('#install').onclick = async () => {
  if (!installPrompt) return;
  try { await installPrompt.prompt(); await installPrompt.userChoice; }
  catch { toast('설치 메뉴를 다시 열어 주세요.'); }
  finally { installPrompt = null; $('#install').hidden = true; }
};

function connection() {
  $('#status').textContent = db ? (navigator.onLine ? '● 기기에 저장' : '● 오프라인 · 기기에 저장') : '● 저장소 연결 중';
}
window.addEventListener('online', connection); window.addEventListener('offline', connection);
function updateDate() { $('#today').textContent = new Date().toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).toUpperCase(); }
updateDate(); renderTags(); $('#save').disabled = true; $('#quick-save').disabled = true;
try {
  db = await openDatabase();
  const state = await refresh();
  if (state.draft && hasDraft(state.draft)) { applyDraft(state.draft); updateDraftStatus('✓ 이전 초안을 복원했어요'); }
  $('#save').disabled = false; $('#quick-save').disabled = false;
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel('bug-book-records');
    channel.onmessage = () => { refresh().catch(() => toast('다른 창의 변경을 읽지 못했어요.')); };
  }
  connection();
} catch (error) {
  lockForm(true); $('#export').disabled = true; $('#import').disabled = true;
  $('#storage-error').hidden = false;
  $('#storage-error').textContent = error.message || '기기 저장소를 열 수 없어요. 브라우저 저장 권한을 확인하고 다시 접속하세요.';
  $('#status').textContent = '● 저장소 사용 불가';
}
view(location.hash.slice(1) || 'capture');

if ('serviceWorker' in navigator) {
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'});
    const ready = await navigator.serviceWorker.ready;
    const cacheReady = await caches.has(`bug-book-shell:${ready.scope}:v3`);
    $('#offline').textContent = cacheReady ? '✓ 오프라인 준비 완료 · 인터넷 없이 기록할 수 있어요.' : '앱 업데이트 준비 중입니다. 모든 버그 북 창을 닫고 다시 열어 주세요.';
    function notifyUpdate() {
      if (registration.waiting) { $('#update-panel').hidden = false; $('#offline').textContent = '새 버전이 준비되었습니다. 초안은 자동 보관됩니다. 모든 버그 북 창을 닫고 다시 열어 적용하세요.'; }
    }
    notifyUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') notifyUpdate(); });
    });
  } catch { $('#offline').textContent = '오프라인 준비 실패. 온라인 상태에서 다시 접속하세요.'; }
} else { $('#offline').textContent = '오프라인 설치 미지원 브라우저입니다.'; }

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { stopMedia(); persistDraft(); }
  else { updateDate(); if (db) refresh().catch(() => toast('기록을 새로 읽지 못했어요.')); }
});
window.addEventListener('pagehide', () => { stopMedia(); persistDraft(); });
