import './styles.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DataExplorer } from './DataExplorer';

const root = document.getElementById('root')!;
createRoot(root).render(<DataExplorer />);
