import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { ErrorBoundary } from './components/AppStatus.jsx';
import './styles/tokens.css';
import './styles/base.css';
import './styles/home.css';
import './styles/views.css';
import './styles/layout.css';
import './styles/memories.css';
import './styles/interactions.css';
import './styles/friends.css';
import './styles/notifications.css';
import './styles/pwa.css';
import './styles/photobooth.css';
import './styles/captions.css';
import './styles/motion.css';
import { registerServiceWorker } from './lib/pwa.js';
import { applyTheme } from './lib/settings.js';

applyTheme();   // before the first paint, so there is no flash of the wrong theme

// Phones: track the visual viewport so the layout stays above the on-screen keyboard.
function trackViewport() {
  const vv = window.visualViewport;
  if (vv) document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
}
trackViewport();
window.addEventListener('resize', trackViewport);
window.visualViewport?.addEventListener('resize', trackViewport);

createRoot(document.getElementById('root')).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
registerServiceWorker();
