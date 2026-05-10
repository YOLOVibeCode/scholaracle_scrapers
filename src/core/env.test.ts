import { getEnv, getRequiredEnv, getHomeDir, ENV_KEYS } from './env';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ---------------------------------------------------------------------------
// getEnv — optional env var with sanitization
// ---------------------------------------------------------------------------

describe('getEnv', () => {
  it('should return undefined when the variable is not set', () => {
    delete process.env['TEST_VAR'];
    expect(getEnv('TEST_VAR')).toBeUndefined();
  });

  it('should return the value when set', () => {
    process.env['TEST_VAR'] = 'hello';
    expect(getEnv('TEST_VAR')).toBe('hello');
  });

  it('should strip trailing newline (\\n)', () => {
    process.env['TEST_VAR'] = 'secret\n';
    expect(getEnv('TEST_VAR')).toBe('secret');
  });

  it('should strip trailing carriage return + newline (\\r\\n)', () => {
    process.env['TEST_VAR'] = 'secret\r\n';
    expect(getEnv('TEST_VAR')).toBe('secret');
  });

  it('should strip leading and trailing whitespace', () => {
    process.env['TEST_VAR'] = '  spaced  \n';
    expect(getEnv('TEST_VAR')).toBe('spaced');
  });

  it('should strip multiple trailing newlines', () => {
    process.env['TEST_VAR'] = 'value\n\n\n';
    expect(getEnv('TEST_VAR')).toBe('value');
  });

  it('should strip embedded newlines from the value', () => {
    process.env['TEST_VAR'] = 'line1\nline2\n';
    expect(getEnv('TEST_VAR')).toBe('line1line2');
  });

  it('should return the fallback when the variable is not set', () => {
    delete process.env['TEST_VAR'];
    expect(getEnv('TEST_VAR', 'default')).toBe('default');
  });

  it('should return the env value over the fallback when set', () => {
    process.env['TEST_VAR'] = 'real';
    expect(getEnv('TEST_VAR', 'default')).toBe('real');
  });

  it('should treat empty-after-trim as unset and return fallback', () => {
    process.env['TEST_VAR'] = '  \n  ';
    expect(getEnv('TEST_VAR', 'fallback')).toBe('fallback');
  });

  it('should treat empty-after-trim as unset and return undefined without fallback', () => {
    process.env['TEST_VAR'] = '\n';
    expect(getEnv('TEST_VAR')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getRequiredEnv — throws when missing
// ---------------------------------------------------------------------------

describe('getRequiredEnv', () => {
  it('should return the sanitized value when set', () => {
    process.env['REQ_VAR'] = 'present\n';
    expect(getRequiredEnv('REQ_VAR')).toBe('present');
  });

  it('should throw when the variable is not set', () => {
    delete process.env['REQ_VAR'];
    expect(() => getRequiredEnv('REQ_VAR')).toThrow(
      'Required environment variable REQ_VAR is not set',
    );
  });

  it('should throw when the variable is whitespace-only', () => {
    process.env['REQ_VAR'] = '  \n  ';
    expect(() => getRequiredEnv('REQ_VAR')).toThrow(
      'Required environment variable REQ_VAR is not set',
    );
  });
});

// ---------------------------------------------------------------------------
// getHomeDir — special case for HOME
// ---------------------------------------------------------------------------

describe('getHomeDir', () => {
  it('should return HOME when set', () => {
    process.env['HOME'] = '/Users/test\n';
    expect(getHomeDir()).toBe('/Users/test');
  });

  it('should fall back to os.homedir() when HOME is unset', () => {
    delete process.env['HOME'];
    const home = getHomeDir();
    expect(typeof home).toBe('string');
    expect(home.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ENV_KEYS — known env var inventory
// ---------------------------------------------------------------------------

describe('ENV_KEYS', () => {
  it('should contain all known environment variable names', () => {
    expect(ENV_KEYS).toContain('CANVAS_BASE_URL');
    expect(ENV_KEYS).toContain('CANVAS_USERNAME');
    expect(ENV_KEYS).toContain('CANVAS_PASSWORD');
    expect(ENV_KEYS).toContain('SKYWARD_BASE_URL');
    expect(ENV_KEYS).toContain('SKYWARD_USERNAME');
    expect(ENV_KEYS).toContain('SKYWARD_PASSWORD');
    expect(ENV_KEYS).toContain('ANTHROPIC_API_KEY');
    expect(ENV_KEYS).toContain('NOCTUSOFT_API_KEY');
    expect(ENV_KEYS).toContain('HOME');
  });

  it('should be a frozen array', () => {
    expect(Object.isFrozen(ENV_KEYS)).toBe(true);
  });
});
