import {protectedClientRoutes} from './clientApiRouteContract.js';

const base = (process.env.MOBILECHAT_QA_API_BASE || 'http://127.0.0.1:5070').replace(/\/$/, '');
const root = await fetch(`${base}/api/`);
console.log(`API root: ${root.status}`);

const results = [];
for (let offset = 0; offset < protectedClientRoutes.length; offset += 8) {
  const batch = protectedClientRoutes.slice(offset, offset + 8);
  results.push(...await Promise.all(batch.map(async ([method, path]) => {
    try {
      const response = await fetch(`${base}${path}`, {method, redirect: 'manual'});
      return {method, path, status: response.status};
    } catch (error) {
      return {method, path, status: 'NETWORK_ERROR', error: error.message};
    }
  })));
}

const reachable = results.filter(item => item.status === 401).length;
const missing = results.filter(item => item.status === 404);
const unexpected = results.filter(item => item.status !== 401 && item.status !== 404);
console.log(`Protected client routes: ${results.length}; auth-gated: ${reachable}; missing: ${missing.length}; unexpected: ${unexpected.length}`);
for (const item of [...missing, ...unexpected]) console.log(`${item.method} ${item.path} -> ${item.status}${item.error ? ` (${item.error})` : ''}`);
if (root.status !== 200 || missing.length || unexpected.length) process.exitCode = 1;
