import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Unable to find the application root.');
}

createRoot(root).render(<App />);
