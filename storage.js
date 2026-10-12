// Keep record changes and draft/trash changes in the same transaction.
export function openDatabase(factory = indexedDB) {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = factory.open('bug-book', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('logs')) db.createObjectStore('logs', {keyPath: 'id'});
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    request.onblocked = () => { blocked = true; reject(Error('다른 버그 북 창을 닫고 다시 접속하세요.')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

export function transaction(db, stores, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result, failure;
    const output = value => { result = value; };
    const abort = error => { failure = error; tx.abort(); };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || Error('저장 작업이 취소되었습니다.'));
    tx.onerror = () => { failure = failure || tx.error; };
    try { work(tx, output, abort); } catch (error) { abort(error); }
  });
}

export function readAll(db) {
  return transaction(db, ['logs', 'meta'], 'readonly', (tx, output) => {
    const state = {};
    tx.objectStore('logs').getAll().onsuccess = event => { state.logs = event.target.result; };
    tx.objectStore('meta').get('draft').onsuccess = event => { state.draft = event.target.result; };
    tx.objectStore('meta').get('trash').onsuccess = event => { state.trash = event.target.result; };
    output(state);
  });
}

export function writeDraft(db, draft) {
  return transaction(db, ['meta'], 'readwrite', tx => {
    const store = tx.objectStore('meta');
    if (draft) store.put(draft, 'draft'); else store.delete('draft');
  });
}

export function saveLog(db, log, editing = false) {
  return transaction(db, ['logs', 'meta'], 'readwrite', (tx, output, abort) => {
    const store = tx.objectStore('logs');
    if (editing) {
      store.get(log.id).onsuccess = event => {
        if (!event.target.result) { abort(Error('원본 기록이 삭제되었습니다. 초안 내용은 유지됩니다.')); return; }
        store.put(log);
        tx.objectStore('meta').delete('draft');
      };
    } else {
      store.add(log);
      tx.objectStore('meta').delete('draft');
    }
  });
}

export function removeLog(db, id) {
  return transaction(db, ['logs', 'meta'], 'readwrite', (tx, output) => {
    const store = tx.objectStore('logs');
    store.get(id).onsuccess = event => {
      const log = event.target.result;
      if (!log) return;
      tx.objectStore('meta').put(log, 'trash');
      store.delete(id);
      output(log);
    };
  });
}

export function undoDelete(db) {
  return transaction(db, ['logs', 'meta'], 'readwrite', (tx, output, abort) => {
    const meta = tx.objectStore('meta'), store = tx.objectStore('logs');
    meta.get('trash').onsuccess = event => {
      const log = event.target.result;
      if (!log) return;
      store.get(log.id).onsuccess = event => {
        if (event.target.result) { abort(Error('같은 ID의 기록이 있어 복원할 수 없습니다.')); return; }
        store.add(log); meta.delete('trash'); output(log);
      };
    };
  });
}

export function mergeLogs(db, logs) {
  // Check IDs inside this transaction, including records added from other tabs.
  return transaction(db, ['logs'], 'readwrite', (tx, output) => {
    const store = tx.objectStore('logs');
    let added = 0;
    output(0);
    for (const log of logs) {
      store.get(log.id).onsuccess = event => {
        if (event.target.result) return;
        store.add(log); output(++added);
      };
    }
  });
}
