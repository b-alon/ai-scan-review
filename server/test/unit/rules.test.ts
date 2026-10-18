import { describe, expect, it } from 'vitest';
import { isExcludedPath, isPlaceholderValue, maskValue, scanText } from '../../src/scan/rules/engine.js';
import { RULES } from '../../src/scan/rules/rules.js';

describe('rules', () => {
  it('have unique ids and non-global patterns', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(RULES.every((r) => !r.pattern.global)).toBe(true);
  });

  it('flags an AWS key and masks the value in evidence', () => {
    const [f] = scanText('src/config.js', 'const key = "AKIAIOSFODNN7EXAMPLE";');
    expect(f).toMatchObject({ ruleId: 'secret.aws_access_key', severity: 'critical', location: 'src/config.js:1' });
    expect(f?.evidence).toBe('const key = "AKIA****";');
    expect(f?.evidence).not.toContain('IOSFODNN7EXAMPLE');
  });

  it('flags github tokens, stripe keys, private keys and slack webhooks', () => {
    const text = [
      'token = "ghp_' + 'a'.repeat(36) + '"',
      'STRIPE = "sk_live_' + 'b'.repeat(24) + '"',
      '-----BEGIN RSA PRIVATE KEY-----',
      'url = "https://hooks.slack.com/services/T000/B000/xxxx"',
    ].join('\n');
    const ids = scanText('deploy.sh', text).map((f) => f.ruleId);
    expect(ids).toEqual(['secret.github_token', 'secret.stripe_live_key', 'secret.private_key', 'secret.slack_webhook']);
  });

  it('flags generic credential assignments in the shapes real code uses', () => {
    expect(scanText('src/db.ts', 'DB_PASSWORD = "hunter2hunter2"')).toHaveLength(1);
    expect(scanText('src/db.ts', 'JWT_SECRET: "hunter2hunter2"')).toHaveLength(1);
    expect(scanText('src/db.ts', 'const dbPassword = "hunter2hunter2";')).toHaveLength(1);
    expect(scanText('src/db.ts', 'ACCESS_TOKEN="hunter2hunter2"')).toHaveLength(1);
    expect(scanText('config.json', '"password": "hunter2hunter2",')).toHaveLength(1);
    expect(scanText('src/db.ts', 'const tokenizer = "abcdefghijk";')).toHaveLength(0);
  });

  it('flags generic credential assignments but not placeholders, env lookups or test paths', () => {
    expect(scanText('src/db.ts', 'const password = "hunter2hunter2";')).toHaveLength(1);
    expect(scanText('src/db.ts', 'const password = "changeme";')).toHaveLength(0);
    expect(scanText('src/db.ts', 'const apiKey = "${API_KEY}";')).toHaveLength(0);
    expect(scanText('src/db.ts', 'const token = process.env.TOKEN;')).toHaveLength(0);
    expect(scanText('test/db.test.ts', 'const password = "hunter2hunter2";')).toHaveLength(0);
    expect(scanText('README.md', 'password = "hunter2hunter2"')).toHaveLength(0);
  });

  it('flags eval, shell and sql interpolation, dangerouslySetInnerHTML and DEBUG=True by extension', () => {
    expect(scanText('a.js', 'eval(userInput)')[0]?.ruleId).toBe('code.eval');
    expect(scanText('a.py', 'eval(x)')[0]?.ruleId).toBe('code.eval');
    expect(scanText('a.py', 'model.eval()')).toHaveLength(0);
    expect(scanText('a.py', 'self.net.eval()')).toHaveLength(0);
    expect(scanText('a.rb', 'eval(x)')).toHaveLength(0);
    expect(scanText('a.ts', 'execSync(`ls ${dir}`)')[0]?.ruleId).toBe('code.shell_interpolation');
    expect(scanText('a.ts', 'db.query(`select * from t where id = ${id}`)')[0]?.ruleId).toBe('code.sql_interpolation');
    expect(scanText('a.tsx', '<div dangerouslySetInnerHTML={{ __html: html }} />')[0]?.ruleId).toBe('code.dangerously_set_inner_html');
    expect(scanText('settings.py', 'DEBUG = True')[0]?.ruleId).toBe('config.debug_true');
  });

  it('produces stable fingerprints across indentation and substitutes the location', () => {
    const a = scanText('a.js', '  eval(x)')[0]!;
    const b = scanText('a.js', 'eval(x)\n\n')[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.recommendation).toContain('a.js:1');
    expect(a.metadata).toMatchObject({ line: 1, path: 'a.js' });
  });

  it('masks secrets that share a line with a non-secret finding', () => {
    const findings = scanText('a.js', 'eval(x); const key = "AKIAIOSFODNN7EXAMPLE"; const password = "hunter2hunter2";');
    const ids = findings.map((f) => f.ruleId).sort();
    expect(ids).toEqual(['code.eval', 'secret.aws_access_key']);
    for (const f of findings) {
      expect(f.evidence).not.toContain('IOSFODNN7EXAMPLE');
      expect(f.evidence).not.toContain('hunter2hunter2');
    }
  });

  it('helpers behave', () => {
    expect(maskValue('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA****');
    expect(maskValue('ab')).toBe('****');
    expect(isPlaceholderValue('your-api-key-here')).toBe(true);
    expect(isPlaceholderValue('<secret>')).toBe(true);
    expect(isPlaceholderValue('s3cr3tP@ssw0rd!')).toBe(false);
    expect(isExcludedPath('src/__mocks__/x.ts')).toBe(true);
    expect(isExcludedPath('src/app.ts')).toBe(false);
  });
});
