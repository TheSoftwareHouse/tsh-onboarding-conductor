import axios from 'axios';
import { readRuntimeEnv } from '@/config/runtime-env';

// The engine authenticates admin requests with a better-auth session cookie, so the browser has
// to send it, including from the cross-origin `pnpm dev` panel.
export const httpClient = axios.create({
  baseURL: readRuntimeEnv().VITE_ENGINE_API_BASE_URL,
  withCredentials: true,
});
