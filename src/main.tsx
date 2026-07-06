import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import 'antd/dist/reset.css';
import '@xyflow/react/dist/style.css';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('找不到工作台挂载节点 #root');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
