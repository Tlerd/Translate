import 'server-only';

export interface ServerEnv {
  SONIOX_API_KEY?: string;
  NEMOTRON_BASE_URL?: string;
  NEMOTRON_WEBSOCKET_URL?: string;
  NEMOTRON_GATEWAY_SECRET?: string;
  NEMOTRON_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  SUMMARY_GOOGLE_API_KEY?: string;
  SUMMARY_OPENAI_API_KEY?: string;
  IMAGE_GOOGLE_API_KEY?: string;
  IMAGE_OPENAI_API_KEY?: string;
  AI_TRANSLATION_MODEL: string;
  AI_SUMMARY_MODEL: string;
  AI_IMAGE_MODEL: string;
  AI_IMAGE_ENABLED: boolean;
  AUTH_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
  OWNER_EMAIL?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

export function getServerEnv(): ServerEnv {
  return {
    SONIOX_API_KEY: process.env.SONIOX_API_KEY?.trim() || undefined,
    NEMOTRON_BASE_URL: process.env.NEMOTRON_BASE_URL?.trim() || undefined,
    NEMOTRON_WEBSOCKET_URL: process.env.NEMOTRON_WEBSOCKET_URL?.trim() || undefined,
    NEMOTRON_GATEWAY_SECRET: process.env.NEMOTRON_GATEWAY_SECRET?.trim() || undefined,
    NEMOTRON_API_KEY: process.env.NEMOTRON_API_KEY?.trim() || undefined,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY?.trim() || undefined,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY?.trim() || undefined,
    SUMMARY_GOOGLE_API_KEY: process.env.SUMMARY_GOOGLE_API_KEY?.trim() || undefined,
    SUMMARY_OPENAI_API_KEY: process.env.SUMMARY_OPENAI_API_KEY?.trim() || undefined,
    IMAGE_GOOGLE_API_KEY: process.env.IMAGE_GOOGLE_API_KEY?.trim() || undefined,
    IMAGE_OPENAI_API_KEY: process.env.IMAGE_OPENAI_API_KEY?.trim() || undefined,
    AI_TRANSLATION_MODEL:
      process.env.AI_TRANSLATION_MODEL?.trim() || 'google:gemini-3.5-flash-lite',
    AI_SUMMARY_MODEL:
      process.env.AI_SUMMARY_MODEL?.trim() || 'google:gemini-3.8-flash',
    AI_IMAGE_MODEL:
      process.env.AI_IMAGE_MODEL?.trim() || 'google:gemini-3.1-flash-lite-image',
    AI_IMAGE_ENABLED: process.env.AI_IMAGE_ENABLED === 'true',
    AUTH_SECRET: process.env.AUTH_SECRET?.trim() || undefined,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID?.trim() || undefined,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET?.trim() || undefined,
    OWNER_EMAIL: process.env.OWNER_EMAIL?.trim() || undefined,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL?.trim() || undefined,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || undefined,
  };
}
