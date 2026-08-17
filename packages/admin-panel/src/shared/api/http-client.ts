import axios from 'axios';
import { acquireEngineAccessToken } from '@/features/auth';

export const httpClient = axios.create({
  baseURL: import.meta.env.VITE_ENGINE_API_BASE_URL,
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
