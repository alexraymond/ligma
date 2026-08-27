import { describe, expect, it } from 'vitest';
import { addressLabel, parseTalkAddress, talkRoleIds } from './talk-address';

const ROLES = ['researcher', 'developer', 'business-analyst'];

describe('parseTalkAddress', () => {
  it('defaults to the system', () => {
    expect(parseTalkAddress('  why is login stuck?  ', ROLES)).toEqual({
      to: 'system',
      body: 'why is login stuck?',
    });
  });

  it('addresses a known crew member and strips the token', () => {
    expect(parseTalkAddress('@researcher what did you find?', ROLES)).toEqual({
      to: 'researcher',
      body: 'what did you find?',
    });
  });

  it('handles a hyphenated role id', () => {
    expect(parseTalkAddress('@business-analyst rank these', ROLES)).toEqual({
      to: 'business-analyst',
      body: 'rank these',
    });
  });

  it('leaves an unknown @word alone rather than guessing', () => {
    expect(parseTalkAddress('@wizard fix everything', ROLES)).toEqual({
      to: 'system',
      body: '@wizard fix everything',
    });
  });

  it('does not treat a mid-message @ as an address', () => {
    expect(parseTalkAddress('ask @researcher about it', ROLES)).toEqual({
      to: 'system',
      body: 'ask @researcher about it',
    });
  });

  it('reads a bare address as an empty body, not as prose', () => {
    expect(parseTalkAddress('@developer', ROLES)).toEqual({ to: 'developer', body: '' });
  });

  it('splits on a newline as readily as a space', () => {
    expect(parseTalkAddress('@developer\nthe build is red', ROLES)).toEqual({
      to: 'developer',
      body: 'the build is red',
    });
  });

  it('does not address anyone when the registry is empty', () => {
    expect(parseTalkAddress('@researcher hello', [])).toEqual({
      to: 'system',
      body: '@researcher hello',
    });
  });
});

describe('talkRoleIds', () => {
  it('merges built-ins with the registry, deduped', () => {
    expect(
      talkRoleIds([{ id: 'me' }, { id: 'researcher' }], [{ id: 'researcher' }, { id: 'scout' }]),
    ).toEqual(['me', 'researcher', 'scout']);
  });

  it('drops inactive registry agents', () => {
    expect(
      talkRoleIds(
        [],
        [
          { id: 'retired', status: 'inactive' },
          { id: 'live', status: 'active' },
        ],
      ),
    ).toEqual(['live']);
  });
});

describe('addressLabel', () => {
  it('names the destination in the words the composer shows', () => {
    expect(addressLabel('system')).toBe('the system');
    expect(addressLabel('researcher')).toBe('@researcher');
  });
});
