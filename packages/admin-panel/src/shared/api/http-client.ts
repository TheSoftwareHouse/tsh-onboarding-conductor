import axios from 'axios';
import { acquireEngineAccessToken } from '@/features/auth';
import { readRuntimeEnv } from '@/shared/config/runtime-env';

export const httpClient = axios.create({
  baseURL: readRuntimeEnv().VITE_ENGINE_API_BASE_URL,
  withCredentials: false,
});

// The engine authenticates admin requests with an Entra ID access token, never a cookie, so
// every outgoing request carries a fresh bearer credential. With sign-in disabled there is no
// token to attach and the header is simply omitted.
httpClient.interceptors.request.use(async (config) => {
  const accessToken = await acquireEngineAccessToken();

  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }

  return config;
});
