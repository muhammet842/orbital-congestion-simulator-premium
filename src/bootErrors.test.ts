// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { classifyBootError, DataUnavailableError, hasWebGL } from './bootErrors';

describe('classifyBootError', () => {
  it('recognises catalog problems', () => {
    expect(classifyBootError(new DataUnavailableError('x'))).toBe('data');
  });

  it('recognises WebGL failures from the renderer', () => {
    expect(classifyBootError(new Error('Error creating WebGL context.'))).toBe('webgl');
  });

  it('falls back to unknown for anything else', () => {
    expect(classifyBootError(new Error('boom'))).toBe('unknown');
    expect(classifyBootError('string')).toBe('unknown');
  });
});

describe('hasWebGL', () => {
  it('is false when the browser cannot create a context (jsdom has no WebGL)', () => {
    expect(hasWebGL()).toBe(false);
  });
});
