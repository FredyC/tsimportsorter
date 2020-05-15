import log4js from 'log4js';
import path from 'path';

export function normalizePath(str: string | undefined | null) {
  if (!str) return '';
  const r = path.normalize(str.replace(/\\/g, '/')).replace(/\\/g, '/');
  return !str.startsWith('.')
    ? r
    : !r.startsWith('.')
    ? './' + r
    : r === '.'
    ? './'
    : r.endsWith('..')
    ? r + '/'
    : r;
}

export function logger(category?: string) {
  return log4js.getLogger(category);
}
