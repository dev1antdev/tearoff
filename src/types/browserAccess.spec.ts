import { describe, expect, it } from 'vitest';
import {
  DEVICE_KEY_PARAM,
  KEY_REPLACED_CLOSE_CODE,
  browserPageUrl,
  isLocalHostName,
  maskDeviceKey,
} from './browserAccess';

const KEY = 'AbC-123_xyz'.repeat(3).slice(0, 32);

describe('browserPageUrl', () => {
  it('names a page by host, port and path', () => {
    expect(
      browserPageUrl({ host: 'localhost', port: 3000, path: '/pitwall' })
    ).toBe('http://localhost:3000/pitwall');
  });

  it('names the profile the way the browser source links always have', () => {
    expect(
      browserPageUrl({
        host: '192.168.1.50',
        port: 4321,
        path: '/dashboard',
        profile: 'race + night',
      })
    ).toBe('http://192.168.1.50:4321/dashboard?profile=race%20%2B%20night');
  });

  it('carries the key last, where a link for another device has one', () => {
    expect(
      browserPageUrl({
        host: '192.168.1.50',
        port: 3000,
        path: '/pitwall',
        key: KEY,
      })
    ).toBe(`http://192.168.1.50:3000/pitwall?key=${KEY}`);
    expect(
      browserPageUrl({
        host: '192.168.1.50',
        port: 3000,
        path: '/dashboard',
        profile: 'default',
        key: KEY,
      })
    ).toBe(`http://192.168.1.50:3000/dashboard?profile=default&key=${KEY}`);
  });

  it('leaves out what it is not given', () => {
    const page = { host: 'localhost', port: 3000, path: '/dashboard' };

    expect(browserPageUrl({ ...page, profile: '', key: '' })).toBe(
      'http://localhost:3000/dashboard'
    );
    expect(browserPageUrl({ ...page, key: null })).toBe(
      'http://localhost:3000/dashboard'
    );
  });

  it('is read back by the server under the name it looks for', () => {
    const url = new URL(
      browserPageUrl({
        host: '192.168.1.50',
        port: 3000,
        path: '/pitwall',
        profile: 'a&b=c',
        key: KEY,
      })
    );

    expect(DEVICE_KEY_PARAM).toBe('key');
    expect(url.searchParams.get(DEVICE_KEY_PARAM)).toBe(KEY);
    expect(url.searchParams.get('profile')).toBe('a&b=c');
  });
});

describe('maskDeviceKey', () => {
  const url = `http://192.168.1.50:3000/pitwall?profile=default&key=${KEY}`;

  it('puts dots where the key is, and leaves the rest to read', () => {
    const shown = maskDeviceKey(url, KEY);

    expect(shown).toBe(
      'http://192.168.1.50:3000/pitwall?profile=default&key=••••••••'
    );
    expect(shown).not.toContain(KEY);
  });

  it('leaves a link with no key in it as it is', () => {
    const local = 'http://localhost:3000/pitwall';

    expect(maskDeviceKey(local, KEY)).toBe(local);
    expect(maskDeviceKey(url, null)).toBe(url);
    expect(maskDeviceKey(url, undefined)).toBe(url);
    expect(maskDeviceKey(url, '')).toBe(url);
  });

  it('does not take text that only looks like the key for the key', () => {
    // A profile named after the key is not the key parameter.
    const odd = `http://192.168.1.50:3000/pitwall?profile=${KEY}&key=${KEY}`;

    expect(maskDeviceKey(odd, KEY)).toBe(
      `http://192.168.1.50:3000/pitwall?profile=${KEY}&key=••••••••`
    );
  });
});

describe('isLocalHostName', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'takes %s for this PC itself',
    (host) => expect(isLocalHostName(host)).toBe(true)
  );

  it.each(['192.168.1.50', 'racing-pc', 'racing-pc.local', ''])(
    'does not take %s for this PC itself',
    (host) => expect(isLocalHostName(host)).toBe(false)
  );
});

describe('KEY_REPLACED_CLOSE_CODE', () => {
  it('is a code an application may close a socket with', () => {
    expect(KEY_REPLACED_CLOSE_CODE).toBeGreaterThanOrEqual(4000);
    expect(KEY_REPLACED_CLOSE_CODE).toBeLessThanOrEqual(4999);
  });
});
