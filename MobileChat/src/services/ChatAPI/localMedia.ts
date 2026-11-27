import {keepLocalCopy} from '@react-native-documents/picker';
import {MMKV} from 'react-native-mmkv';
import RNFS from 'react-native-fs';
import {API_ORIGIN} from '../../contents/Api_URL';

const index = new MMKV({id: 'mobilechat-local-media-v1'});
const localDirectory = `${RNFS.DocumentDirectoryPath}/MobileChatMedia`;
const MAX_CACHED_FILE_BYTES = 100 * 1024 * 1024;
const retryAfterMs = 60_000;
const pendingDownloads = new Map<string, Promise<string | null>>();
const failedAt = new Map<string, number>();

export type AttachmentMeta = {
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  fileUrl?: string;
  localUri?: string;
  images?: AttachmentMeta[];
  [key: string]: unknown;
};

export type MediaMessage = {
  _id?: string;
  type?: string;
  fileMeta?: AttachmentMeta;
  [key: string]: unknown;
};

function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

function safeFileName(value?: string) {
  const cleaned = String(value || 'attachment')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 150);
  return cleaned || 'attachment';
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value, API_ORIGIN);
    let pathname = url.pathname;
    if (pathname.startsWith('/mobilechat-api/')) pathname = pathname.slice('/mobilechat-api'.length);
    return pathname.startsWith('/') ? pathname : `/${pathname}`;
  } catch {
    return `/${value.replace(/^\/+/, '')}`;
  }
}

function downloadUrl(value: string) {
  if (/^(file:|content:|data:)/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.port === '5070') {
        return `${API_ORIGIN}${url.pathname}${url.search}`;
      }
      return value;
    } catch {
      return value;
    }
  }
  return `${API_ORIGIN}/${value.replace(/^\/+/, '')}`;
}

function aliasKey(accountId: string, remoteUrl: string) {
  return `media:${hash(accountId)}:${hash(canonicalUrl(remoteUrl))}`;
}

function localPath(localUri: string) {
  return localUri.startsWith('file://') ? localUri.slice('file://'.length) : localUri;
}

export function getLocalMediaUri(accountId: string, remoteUrl?: string) {
  if (!remoteUrl) return undefined;
  return index.getString(aliasKey(accountId, remoteUrl)) || undefined;
}

export function rememberLocalMedia(accountId: string, remoteUrl: string, localUri: string) {
  if (!accountId || !remoteUrl || !localUri) return;
  index.set(aliasKey(accountId, remoteUrl), localUri);
}

export async function keepPickedAttachmentLocal(
  accountId: string,
  uri: string,
  fileName: string,
) {
  if (!accountId || !uri || /^(file:|content:)/i.test(uri) === false) return uri;
  if (uri.startsWith(`file://${localDirectory}/`)) return uri;

  const uniqueName = `${hash(`${accountId}:${Date.now()}:${Math.random()}`)}-${safeFileName(fileName)}`;
  try {
    const [copy] = await keepLocalCopy({
      files: [{uri, fileName: uniqueName}],
      destination: 'documentDirectory',
    });
    return copy?.status === 'success' ? copy.localUri : uri;
  } catch {
    return uri;
  }
}

async function cacheRemoteAttachment(
  accountId: string,
  attachment: AttachmentMeta,
  token?: string,
): Promise<AttachmentMeta> {
  const remoteUrl = String(attachment.fileUrl || '');
  if (!remoteUrl || attachment.localUri || /^(file:|content:|data:)/i.test(remoteUrl)) return attachment;
  const fileSize = Number(attachment.fileSize || 0);
  if (fileSize > MAX_CACHED_FILE_BYTES) return attachment;

  const key = aliasKey(accountId, remoteUrl);
  const existing = index.getString(key);
  if (existing && await RNFS.exists(localPath(existing))) {
    return {...attachment, localUri: existing};
  }

  const now = Date.now();
  if (now - (failedAt.get(key) || 0) < retryAfterMs) return attachment;
  const inFlight = pendingDownloads.get(key);
  if (inFlight) {
    const localUri = await inFlight;
    return localUri ? {...attachment, localUri} : attachment;
  }

  const download = (async () => {
    try {
      await RNFS.mkdir(localDirectory);
      const accountDirectory = `${localDirectory}/${hash(accountId)}`;
      await RNFS.mkdir(accountDirectory);
      const suffix = safeFileName(attachment.fileName).match(/\.[A-Za-z0-9]{1,10}$/)?.[0] || '.bin';
      const destination = `${accountDirectory}/${hash(`${accountId}:${canonicalUrl(remoteUrl)}`)}${suffix}`;
      if (!await RNFS.exists(destination)) {
        const task = RNFS.downloadFile({
          fromUrl: downloadUrl(remoteUrl),
          toFile: destination,
          headers: token ? {Authorization: `Bearer ${token}`} : undefined,
        });
        const result = await task.promise;
        if (result.statusCode < 200 || result.statusCode >= 300) {
          await RNFS.unlink(destination).catch(() => undefined);
          failedAt.set(key, Date.now());
          return null;
        }
      }
      const localUri = `file://${destination}`;
      index.set(key, localUri);
      failedAt.delete(key);
      return localUri;
    } catch {
      failedAt.set(key, Date.now());
      return null;
    } finally {
      pendingDownloads.delete(key);
    }
  })();

  pendingDownloads.set(key, download);
  const localUri = await download;
  return localUri ? {...attachment, localUri} : attachment;
}

export async function cacheMessageMedia(accountId: string, message: MediaMessage, token?: string) {
  const meta = message.fileMeta;
  if (!accountId || !meta) return message;
  const grouped = Array.isArray(meta.images) && meta.images.length > 0;
  if (grouped) {
    const images = await Promise.all(meta.images!.map(item => cacheRemoteAttachment(accountId, item, token)));
    return {...message, fileMeta: {...meta, images}};
  }
  return {...message, fileMeta: await cacheRemoteAttachment(accountId, meta, token)};
}

export function hasUncachedMedia(message: MediaMessage) {
  const meta = message.fileMeta;
  if (!meta) return false;
  if (Array.isArray(meta.images) && meta.images.length > 0) {
    return meta.images.some(item => Boolean(item.fileUrl && !item.localUri));
  }
  return Boolean(meta.fileUrl && !meta.localUri);
}

export function getServerMediaUrl(value: string) {
  return downloadUrl(value);
}

