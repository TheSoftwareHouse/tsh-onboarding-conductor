import './styles.css';
import { mountAdminOnboardingsApp } from './app';

const root = document.getElementById('app');

if (!root) {
  throw new Error('Root element "#app" was not found.');
}

mountAdminOnboardingsApp(root);
