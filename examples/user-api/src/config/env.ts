import { defineConfig } from 'better-back';
import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  API_BEARER_TOKEN: z.string().min(12).default('dev-secret-token-2026'),
  CORS_ORIGIN: z.string().default('https://dashboard.better-back.dev'),
  ALLOW_FRAME_EMBED: z.coerce.boolean().default(false),
  USERS_WAL_PATH: z.string().min(1).optional(),
});

export type AppEnv = z.output<typeof EnvSchema>;

export const AppConfig = defineConfig({
  name: 'AppConfig',
  schema: EnvSchema,
  profiles: {
    development: { PORT: 3000 },
    test: { PORT: 0 },
    production: { PORT: 8080 },
  },
});
