import axios from 'axios';

export const httpClient = axios.create({
  baseURL: import.meta.env.VITE_ENGINE_API_BASE_URL,
  withCredentials: false,
});
