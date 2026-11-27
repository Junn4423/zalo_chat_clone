import {createHash, timingSafeEqual} from 'node:crypto';
import User from '../models/User.js';

const couchBaseUrl = () => String(process.env.COUCHDB_URL || 'http://127.0.0.1:5984').replace(/\/+$/, '');
const preferredDatabase = () => String(process.env.COUCHDB_DATABASE || '').trim();
let databaseCache = {expiresAt: 0, names: []};
const couchUserTable = () => process.env.COUCHDB_USER_TABLE || 'lv_lv0066';

class CouchServiceError extends Error {
  constructor(message = 'Dịch vụ xác thực tạm thời không khả dụng') {
    super(message);
    this.statusCode = 503;
  }
}

async function couchRequest(url) {
  const username = process.env.COUCHDB_USERNAME;
  const password = process.env.COUCHDB_PASSWORD;
  if (!username || !password) {
    throw new CouchServiceError('Dịch vụ xác thực chưa được cấu hình');
  }

  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new CouchServiceError();
  }

  if (response.status === 404) return {notFound: true, data: null};
  if (!response.ok) throw new CouchServiceError();
  try {
    return {notFound: false, data: await response.json()};
  } catch {
    throw new CouchServiceError();
  }
}

async function getCouchDatabases() {
  if (databaseCache.expiresAt > Date.now() && databaseCache.names.length) {
    return databaseCache.names;
  }

  const {data, notFound} = await couchRequest(`${couchBaseUrl()}/_all_dbs`);
  if (notFound || !Array.isArray(data)) throw new CouchServiceError();
  const names = data.filter(name => typeof name === 'string' && name && !name.startsWith('_'));
  if (!names.length) throw new CouchServiceError();
  const preferred = preferredDatabase();
  if (preferred && names.includes(preferred)) {
    names.splice(names.indexOf(preferred), 1);
    names.unshift(preferred);
  }
  databaseCache = {expiresAt: Date.now() + 60_000, names};
  return names;
}

async function forEachDatabase(names, callback, concurrency = 5) {
  const results = [];
  for (let index = 0; index < names.length; index += concurrency) {
    results.push(...await Promise.all(names.slice(index, index + concurrency).map(callback)));
  }
  return results;
}

async function getAccountDocument(database, account) {
  const documentId = `${couchUserTable()}:${account}`;
  const url = `${couchBaseUrl()}/${encodeURIComponent(database)}/${encodeURIComponent(documentId)}`;
  const result = await couchRequest(url);
  if (result.notFound || String(result.data?.lv001 || '') !== account) return null;
  return result.data;
}

export async function authenticateCouchAccount({username, password}) {
  const account = String(username || '').trim();
  if (!account || typeof password !== 'string' || !password) return null;
  if (account.length > 120 || password.length > 1024) return null;

  const databases = await getCouchDatabases();
  const documents = (await forEachDatabase(databases, database => getAccountDocument(database, account)))
    .filter(Boolean);
  const suppliedHash = createHash('md5').update(password, 'utf8').digest();
  const matchingDocument = documents.find(document => {
    const storedHash = String(document.lv005 || '').toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(storedHash)) return false;
    return timingSafeEqual(suppliedHash, Buffer.from(storedHash, 'hex'));
  });
  if (!matchingDocument) return null;

  return {
    username: account,
    name: String(matchingDocument.lv004 || '').trim() || account,
  };
}

export async function syncCouchAccountDirectory() {
  const prefix = `${couchUserTable()}:`;
  const endKey = `${prefix}\ufff0`;
  const databases = await getCouchDatabases();
  const documentsByDatabase = await forEachDatabase(databases, async database => {
    const dbUrl = `${couchBaseUrl()}/${encodeURIComponent(database)}`;
    const documents = [];
    let startKey = prefix;

    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({
        startkey: JSON.stringify(startKey),
        endkey: JSON.stringify(endKey),
        include_docs: 'true',
        limit: '500',
      });
      if (page > 0) query.set('skip', '1');
      const {data} = await couchRequest(`${dbUrl}/_all_docs?${query.toString()}`);
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const accountRows = rows.filter(row => String(row.id || '').startsWith(prefix));
      documents.push(...accountRows.map(row => row.doc).filter(Boolean).map(document => ({document, database})));
      if (rows.length < 500) break;
      startKey = String(rows[rows.length - 1].id || '');
      if (!startKey) break;
    }
    return documents;
  });
  const uniqueAccounts = new Map();
  for (const {document, database} of documentsByDatabase.flat()) {
    if (!document.lv001 || !document.lv005) continue;
    const username = String(document.lv001);
    if (uniqueAccounts.has(username)) continue;
    uniqueAccounts.set(username, {
      username,
      name: String(document.lv004 || '').trim() || username,
      database,
    });
  }
  const accounts = [...uniqueAccounts.values()];

  const operations = accounts.map(({username, name, database}) => ({
        updateOne: {
          filter: {lv001: username},
          update: {
            $set: {name, couchDbDatabase: database},
            $setOnInsert: {
              maNhanVien: `couch:${username}`,
              role: 'user',
              avatar: '',
            },
          },
          upsert: true,
        },
      }));

  if (operations.length) {
    try {
      await User.bulkWrite(operations, {ordered: false});
    } catch (error) {
      const duplicateOnly = error?.code === 11000
        || error?.writeErrors?.every(writeError => writeError?.code === 11000);
      if (!duplicateOnly) throw error;
    }
  }

  return {
    totalAccounts: accounts.length,
    accounts: accounts.map(({username, name}) => ({username, name})),
  };
}

export async function getCouchAccountDirectory() {
  return (await syncCouchAccountDirectory()).accounts;
}
