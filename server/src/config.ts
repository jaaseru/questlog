export interface AppConfig {
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  appPassword: string;
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
  }
  if (!config.appPassword) problems.push('APP_PASSWORD is required');
  if (config.sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.timezone });
  } catch {
    problems.push(`APP_TIMEZONE "${config.timezone}" is not a valid IANA time zone`);
  }
  if (problems.length) throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  return config;
}
