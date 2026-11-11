const databaseName = 'cademeupet-adoption-session';
const storeName = 'sessions';
let databasePromise;

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName, { keyPath: 'sessionId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('A abertura do armazenamento da sessão foi bloqueada.'));
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

async function runTransaction(mode, createRequest) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));
    let result;

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('A gravação da sessão foi cancelada.'));
  });
}

export function loadAdoptionSessionMedia(sessionId) {
  return runTransaction('readonly', (store) => store.get(sessionId));
}

export function saveAdoptionSessionMedia(sessionId, media) {
  if (!media.photo && !media.previewUrl) {
    return runTransaction('readwrite', (store) => store.delete(sessionId));
  }
  return runTransaction('readwrite', (store) => store.put({ sessionId, ...media }));
}

export function deleteAdoptionSessionMedia(sessionId) {
  return runTransaction('readwrite', (store) => store.delete(sessionId));
}
