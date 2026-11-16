import { describe, expect, it, vi } from 'vitest';
import { KEY_REPLACED_CLOSE_CODE } from '@irdashies/types';
import { createDeviceAccess } from './deviceAccess';

const OLD_KEY = 'o'.repeat(32);
const NEW_KEY = 'n'.repeat(32);
const TABLET = '192.168.1.77';
const PHONE = '192.168.1.78';

function setup() {
  let key: string | null = OLD_KEY;
  const replace = vi.fn(async () => {
    key = NEW_KEY;
    return NEW_KEY;
  });
  const access = createDeviceAccess({
    keys: { current: () => key, replace },
    localHosts: () => ['192.168.1.50'],
    now: () => 0,
  });
  const counts: number[] = [];
  access.onDevicesChanged((count) => counts.push(count));
  const socket = () => ({ close: vi.fn() });
  return { access, counts, replace, socket };
}

describe('device access', () => {
  it('asks the key rule with the key of the moment', async () => {
    const { access } = setup();

    expect(access.key()).toBe(OLD_KEY);
    expect(access.check({ remoteAddress: '127.0.0.1' }).thisMachine).toBe(true);
    expect(
      access.check({ remoteAddress: TABLET, cookieKey: OLD_KEY }).allowed
    ).toBe(true);
    expect(access.check({ remoteAddress: TABLET }).allowed).toBe(false);
  });

  it('counts devices, not pages, and says so as the count changes', () => {
    const { access, counts, socket } = setup();

    const first = access.admit(socket(), TABLET);
    const second = access.admit(socket(), TABLET);
    const third = access.admit(socket(), PHONE);
    expect(access.devices()).toBe(2);

    first();
    expect(access.devices()).toBe(2);
    second();
    expect(access.devices()).toBe(1);
    third();
    // Releasing twice changes nothing.
    third();

    expect(access.devices()).toBe(0);
    expect(counts).toEqual([1, 2, 1, 0]);
  });

  it('stops telling a listener that has left', () => {
    const { access, socket } = setup();
    const heard: number[] = [];
    const leave = access.onDevicesChanged((count) => heard.push(count));

    access.admit(socket(), TABLET);
    leave();
    access.admit(socket(), PHONE);

    expect(heard).toEqual([1]);
  });

  it('refuses the old key and disconnects its devices when the key is replaced', async () => {
    const { access, counts, socket } = setup();
    const tablet = socket();
    const phone = socket();
    const releaseTablet = access.admit(tablet, TABLET);
    access.admit(phone, PHONE);

    expect(await access.replaceKey()).toBe(NEW_KEY);

    expect(access.key()).toBe(NEW_KEY);
    for (const device of [tablet, phone]) {
      expect(device.close).toHaveBeenCalledExactlyOnceWith(
        KEY_REPLACED_CLOSE_CODE,
        'Key replaced'
      );
    }
    expect(
      access.check({ remoteAddress: TABLET, cookieKey: OLD_KEY })
    ).toMatchObject({ allowed: false, refusal: 'wrong', staleCookie: true });
    expect(
      access.check({ remoteAddress: TABLET, queryKey: NEW_KEY }).allowed
    ).toBe(true);
    // Out of the count at once; the socket's own close, later, adds nothing.
    expect(access.devices()).toBe(0);
    releaseTablet();
    expect(counts).toEqual([1, 2, 0]);
  });

  it('disconnects nobody when the new key could not be stored', async () => {
    const { access, replace, socket } = setup();
    const tablet = socket();
    access.admit(tablet, TABLET);
    replace.mockRejectedValueOnce(new Error('EPERM'));

    await expect(access.replaceKey()).rejects.toThrow('EPERM');

    expect(tablet.close).not.toHaveBeenCalled();
    expect(access.devices()).toBe(1);
    expect(
      access.check({ remoteAddress: TABLET, cookieKey: OLD_KEY }).allowed
    ).toBe(true);
  });

  it('uses the code a page knows to stop knocking by', () => {
    expect(KEY_REPLACED_CLOSE_CODE).toBe(4403);
  });
});
