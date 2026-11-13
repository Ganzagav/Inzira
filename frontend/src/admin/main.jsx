import React from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './AdminApp.jsx';
import { setPortal } from '../shared/api.js';
import '../styles.css';

setPortal('admin');
createRoot(document.getElementById('root')).render(<AdminApp />);
