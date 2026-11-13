import React from 'react';
import { createRoot } from 'react-dom/client';
import PoliceApp from './PoliceApp.jsx';
import { setPortal } from '../shared/api.js';
import '../styles.css';

setPortal('police');
createRoot(document.getElementById('root')).render(<PoliceApp />);
