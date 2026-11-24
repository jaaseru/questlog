export interface AppConfig {
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  /** Only used once, to create the first user when upgrading from the single-password version. */
  appPassword: string;
  adminUsername: string;
  sessionSecret: string;
  timezone: string;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config: AppConfig = {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? '',
    databaseSsl: env.DATABASE_SSL === 'true',
    appPassword: env.APP_PASSWORD ?? '',
    adminUsername: (env.ADMIN_USERNAME ?? 'admin').trim().toLowerCase(),
    sessionSecret: env.SESSION_SECRET ?? '',
    timezone: env.APP_TIMEZONE ?? 'UTC',
    isProduction: env.NODE_ENV === 'production',
  };

  const problems: string[] = [];
  if (!config.databaseUrl) {
    problems.push(
      'DATABASE_URL is required. On Railway, add it to this app service (not the database) as a reference ' +
        'to your Postgres service, e.g. ${{Postgres.DATABASE_URL}}, where "Postgres" must match the database service name.',
    );
  } else {
    const urlProblem = describeDatabaseUrlProblem(config.databaseUrl);
    if (urlProblem) problems.push(urlProblem);
  }
  if (!/^[a-z0-9._-]{2,32}$/.test(config.adminUsername)) {
    problems.push('ADMIN_USERNAME must be 2-32 characters: lowercase letters, digits, ".", "_" or "-"');
  }
  if (config.sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.timezone });
  } catch {
    problems.push(`APP_TIMEZONE "${config.timezone}" is not a valid IANA time zone`);
  }
  if (problems.length) throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  return config;
}

/**
 * pg silently treats anything that isn't a full URL as a path on a host called "base",
 * which surfaces as a confusing `getaddrinfo ENOTFOUND base`. Catch the common mistakes
 * up front. The value itself is never echoed, since it contains the database password.
 */
export function describeDatabaseUrlProblem(url: string): string | null {
  if (url.includes('${{')) {
    return (
      'DATABASE_URL contains an unresolved Railway reference (${{...}}). The service name inside it must match your ' +
      'database service exactly. Easiest fix: delete the variable and re-add it with "Add Reference".'
    );
  }
  if (/^\s*DATABASE_URL\s*=/i.test(url)) {
    return 'DATABASE_URL value starts with "DATABASE_URL=". Put only the URL in the value field, starting with postgresql://';
  }
  if (/^\s|\s$/.test(url) || /^["']/.test(url)) {
    return 'DATABASE_URL has surrounding quotes or whitespace. Remove them so the value starts with postgresql://';
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'DATABASE_URL is not a valid URL. It should look like postgresql://user:password@host:5432/database';
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return `DATABASE_URL must start with postgresql:// (got "${parsed.protocol}//").`;
  }
  if (!parsed.hostname) return 'DATABASE_URL is missing a host name.';
  return null;
}
