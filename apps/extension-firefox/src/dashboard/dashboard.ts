/**
 * Job Applications Dashboard - Kanban Board
 * Displays applications in status columns with edit/delete functionality
 */

import browser from '../shared/browser-compat';
import { setHTML } from '../shared/html';
import {
  getAllApplications,
  getApplicationStats,
  getApplicationTrends,
  updateApplicationStatus,
  deleteApplication,
  type ApplicationStats,
  type DailyTrend,
} from '../shared/storage';
import type { JobApplication } from '../shared/types';
import { getActiveProfileId, listProfiles } from '../shared/profile';

// Chart.js type (loaded via CDN)
declare const Chart: any;

let allApplications: JobApplication[] = [];
let filteredApplications: JobApplication[] = [];
let trendChart: any = null;
let statusChart: any = null;
let currentEditingApp: JobApplication | null = null;

/**
 * Initialize dashboard on page load
 */
async function init() {
  console.log('Dashboard initializing...');

  // Show active profile indicator in header
  try {
    const activeId = await getActiveProfileId();
    const profiles = await listProfiles();
    const activeMeta = profiles.find(p => p.id === activeId);
    if (activeMeta) {
      const headerBrand = document.querySelector('.header-brand');
      if (headerBrand) {
        const badge = document.createElement('div');
        badge.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:16px;padding:4px 12px;background:#f1f5f9;border-radius:20px;';
        const dot = document.createElement('span');
        dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${activeMeta.color};display:inline-block;flex-shrink:0;`;
        const label = document.createElement('span');
        label.style.cssText = 'font-size:12px;color:#475569;font-weight:500;white-space:nowrap;';
        label.textContent = activeMeta.name || 'My Profile';
        badge.appendChild(dot);
        badge.appendChild(label);
        headerBrand.appendChild(badge);
      }
    }
  } catch (_) { /* non-critical */ }
  
  // Load data
  await loadDashboardData();
  
  // Setup event listeners
  setupEventListeners();
  
  // Initial render
  renderDashboard();
  
  console.log('Dashboard initialized with', allApplications.length, 'applications');
}

/**
 * Load all dashboard data
 */
async function loadDashboardData() {
  try {
    console.log('[Dashboard] Loading data...');
    allApplications = await getAllApplications();
    filteredApplications = [...allApplications];
    console.log('[Dashboard] Loaded', allApplications.length, 'applications');

    if (allApplications.length === 0) {
      console.warn('[Dashboard] No applications found. User may not have submitted any applications yet, or use "Generate Test Data" to populate.');
    }
  } catch (err) {
    console.error('[Dashboard] Failed to load dashboard data:', err);
    showError('Failed to load applications data');
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Search input
  const searchInput = document.getElementById('searchInput') as HTMLInputElement;
  searchInput?.addEventListener('input', handleSearch);

  // Filter dropdown
  const filterStatus = document.getElementById('filterStatus') as HTMLSelectElement;
  filterStatus?.addEventListener('change', handleSearch);
  
  // Export button
  const exportBtn = document.getElementById('exportBtn');
  exportBtn?.addEventListener('click', handleExport);
  
  // Edit form
  const editForm = document.getElementById('editForm');
  editForm?.addEventListener('submit', handleEditSubmit);

  // Cancel edit button (replaces inline onclick to satisfy CSP)
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  cancelEditBtn?.addEventListener('click', closeEditModal);

  // Test data buttons
  const clearDataBtn = document.getElementById('clearDataBtn');
  clearDataBtn?.addEventListener('click', clearAllData);

  // Learned Values button — set the deep-link flag and open the onboarding page
  const viewLearnedBtn = document.getElementById('viewLearnedValuesBtn');
  viewLearnedBtn?.addEventListener('click', async () => {
    try {
      await browser.storage.local.set({ showLearnedValues: true });
      window.location.href = '../onboarding/onboarding.html';
    } catch (err) {
      console.error('[Dashboard] Failed to open learned values:', err);
    }
  });
}

/**
 * Main render function
 */
async function renderDashboard() {
  await renderStats();
  renderKanbanBoard();
  await renderCharts();
}

/**
 * Render statistics cards
 */
async function renderStats() {
  try {
    const stats = await getApplicationStats();
    
    // Update stat cards
    setElementText('statTotal', stats.total.toString());
    setElementText('statSubmitted', stats.submitted.toString());
    setElementText('statInterviewing', stats.interviewing.toString());
    setElementText('statAccepted', stats.accepted.toString());
    setElementText('statRejected', stats.rejected.toString());
    setElementText('statRate', `${stats.responseRate}%`);
    
    // Update date range
    if (stats.dateRange.earliest && stats.dateRange.latest) {
      const dateText = stats.dateRange.earliest === stats.dateRange.latest
        ? formatDate(stats.dateRange.earliest)
        : `${formatDate(stats.dateRange.earliest)} - ${formatDate(stats.dateRange.latest)}`;
      setElementText('dateRange', dateText);
    } else {
      setElementText('dateRange', 'No applications yet');
    }
  } catch (err) {
    console.error('Failed to render stats:', err);
  }
}

/**
 * Render Kanban board with status columns
 */
function renderKanbanBoard() {
  const container = document.getElementById('kanbanContent');
  if (!container) return;
  
  if (filteredApplications.length === 0) {
    setHTML(container, `
      <div class="empty-state">
        <h3>No applications found</h3>
        <p>${allApplications.length === 0 ? 'Start submitting applications and they will appear here' : 'Try adjusting your search'}</p>
      </div>
    `);
    return;
  }
  
  // Group applications by status
  const columns = {
    submitted: filteredApplications.filter(a => a.status === 'submitted'),
    interviewing: filteredApplications.filter(a => a.status === 'interviewing'),
    rejected: filteredApplications.filter(a => a.status === 'rejected'),
    accepted: filteredApplications.filter(a => a.status === 'accepted'),
    withdrawn: filteredApplications.filter(a => a.status === 'withdrawn'),
  };
  
  setHTML(container, `
    <div class="kanban-board">
      ${createKanbanColumn('submitted', 'Submitted', columns.submitted)}
      ${createKanbanColumn('interviewing', 'Interviewing', columns.interviewing)}
      ${createKanbanColumn('rejected', 'Rejected', columns.rejected)}
      ${createKanbanColumn('accepted', 'Accepted', columns.accepted)}
      ${createKanbanColumn('withdrawn', 'Withdrawn', columns.withdrawn)}
    </div>
  `);
  
  // Attach event listeners to cards
  attachCardListeners();
}

/**
 * Create a Kanban column (drop zone)
 */
function createKanbanColumn(status: string, title: string, apps: JobApplication[]): string {
  const cardsHTML = apps.map(app => createApplicationCard(app)).join('');
  
  return `
    <div class="kanban-column" data-status="${status}">
      <div class="column-header ${status}">
        <span>${title}</span>
        <span class="count">${apps.length}</span>
      </div>
      <div class="column-cards" data-status="${status}">
        ${cardsHTML || '<div class="empty-state"><p>No applications</p></div>'}
      </div>
    </div>
  `;
}

/**
 * Create application card HTML
 */
function createApplicationCard(app: JobApplication): string {
  const date = new Date(app.timestamp);
  const dateStr = formatDate(date.toISOString().split('T')[0]);
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  return `
    <div class="app-card" data-app-id="${app.id}" draggable="true">
      <div class="app-card-header">
        <div class="app-card-title">${escapeHtml(app.jobTitle)}</div>
        <div class="app-card-company">${escapeHtml(app.company)}</div>
      </div>
      ${app.atsHint ? `<div class="ats-badge">${escapeHtml(app.atsHint)}</div>` : ''}
      ${app.notes ? `<div class="app-card-meta"><div style="color: #4a5568;">${escapeHtml(app.notes)}</div></div>` : ''}
      <div class="app-card-meta">
        <div>${dateStr} at ${timeStr}</div>
      </div>
      <div class="app-card-actions">
        <button class="btn-edit" data-action="edit">Edit</button>
        <button class="btn-delete" data-action="delete">Delete</button>
      </div>
    </div>
  `;
}

/**
 * Attach event listeners to card buttons and drag-and-drop
 */
function attachCardListeners() {
  // --- Card button listeners ---
  document.querySelectorAll('.app-card').forEach(card => {
    const appId = card.getAttribute('data-app-id');
    if (!appId) return;
    
    // Edit button
    const editBtn = card.querySelector('[data-action="edit"]');
    editBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleEdit(appId);
    });
    
    // Delete button
    const deleteBtn = card.querySelector('[data-action="delete"]');
    deleteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDelete(appId);
    });
    
    // Click card to open URL (only if not a drag)
    let didDrag = false;
    card.addEventListener('mousedown', () => { didDrag = false; });
    card.addEventListener('mousemove', () => { didDrag = true; });
    card.addEventListener('click', () => {
      if (didDrag) return;
      const app = allApplications.find(a => a.id === appId);
      if (app) {
        browser.tabs.create({ url: app.url });
      }
    });
    
    // --- Drag start ---
    card.addEventListener('dragstart', (e) => {
      const de = e as DragEvent;
      card.classList.add('dragging');
      de.dataTransfer?.setData('text/plain', appId);
      if (de.dataTransfer) {
        de.dataTransfer.effectAllowed = 'move';
      }
    });
    
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });
  
  // --- Column drop zone listeners ---
  document.querySelectorAll('.kanban-column').forEach(column => {
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'move';
      column.classList.add('drag-over');
    });
    
    column.addEventListener('dragleave', (e) => {
      // Only remove highlight if we actually left the column, not just entered a child
      const related = (e as MouseEvent).relatedTarget as Node | null;
      if (related && column.contains(related)) return;
      column.classList.remove('drag-over');
    });
    
    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      column.classList.remove('drag-over');
      
      const appId = (e as DragEvent).dataTransfer?.getData('text/plain');
      const newStatus = column.getAttribute('data-status') as JobApplication['status'];
      
      if (!appId || !newStatus) return;
      
      // Find the app's current status to avoid no-op updates
      const app = allApplications.find(a => a.id === appId);
      if (!app || app.status === newStatus) return;
      
      // Persist the status change
      const success = await updateApplicationStatus(appId, newStatus);
      if (success) {
        await loadDashboardData();
        renderDashboard();
      }
    });
  });
}

/**
 * Handle edit button click
 */
function handleEdit(appId: string) {
  const app = allApplications.find(a => a.id === appId);
  if (!app) return;
  
  currentEditingApp = app;
  
  // Populate edit form
  const companyInput = document.getElementById('editCompany') as HTMLInputElement;
  const positionInput = document.getElementById('editPosition') as HTMLInputElement;
  const statusSelect = document.getElementById('editStatus') as HTMLSelectElement;
  const notesTextarea = document.getElementById('editNotes') as HTMLTextAreaElement;
  
  if (companyInput) companyInput.value = app.company;
  if (positionInput) positionInput.value = app.jobTitle;
  if (statusSelect) statusSelect.value = app.status;
  if (notesTextarea) notesTextarea.value = app.notes || '';
  
  // Show modal
  const modal = document.getElementById('editModal');
  modal?.classList.add('active');
}

/**
 * Handle edit form submit
 */
async function handleEditSubmit(e: Event) {
  e.preventDefault();
  
  if (!currentEditingApp) return;
  
  const statusSelect = document.getElementById('editStatus') as HTMLSelectElement;
  const notesTextarea = document.getElementById('editNotes') as HTMLTextAreaElement;
  
  const newStatus = statusSelect.value as JobApplication['status'];
  const newNotes = notesTextarea.value;
  
  // Update application
  const success = await updateApplicationStatus(currentEditingApp.id!, newStatus, newNotes);
  
  if (success) {
    // Reload data and re-render
    await loadDashboardData();
    renderDashboard();
    closeEditModal();
  } else {
    alert('Failed to update application. Please try again.');
  }
}

/**
 * Close edit modal
 */
function closeEditModal() {
  const modal = document.getElementById('editModal');
  modal?.classList.remove('active');
  currentEditingApp = null;
}

// closeEditModal is wired via addEventListener in setupEventListeners — no global needed

/**
 * Handle delete button click
 */
async function handleDelete(appId: string) {
  const app = allApplications.find(a => a.id === appId);
  if (!app) return;
  
  const confirmed = confirm(`Delete application for ${app.jobTitle} at ${app.company}?`);
  
  if (confirmed) {
    const success = await deleteApplication(appId);
    
    if (success) {
      // Reload data and re-render
      await loadDashboardData();
      renderDashboard();
    } else {
      alert('Failed to delete application. Please try again.');
    }
  }
}

/**
 * Handle search
 */
function handleSearch() {
  const searchInput = document.getElementById('searchInput') as HTMLInputElement;
  const filterStatus = document.getElementById('filterStatus') as HTMLSelectElement;
  const searchTerm = searchInput?.value.toLowerCase() || '';
  const statusFilter = filterStatus?.value || 'all';

  filteredApplications = allApplications.filter(app => {
    const matchesSearch = !searchTerm || (
      app.jobTitle.toLowerCase().includes(searchTerm) ||
      app.company.toLowerCase().includes(searchTerm) ||
      (app.notes?.toLowerCase().includes(searchTerm) ?? false)
    );
    const matchesStatus = statusFilter === 'all' || app.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  
  renderKanbanBoard();
}

/**
 * Render Chart.js charts
 */
async function renderCharts() {
  try {
    const trends = await getApplicationTrends();
    
    // Destroy existing charts if any
    if (trendChart) {
      trendChart.destroy();
    }
    if (statusChart) {
      statusChart.destroy();
    }
    
    // Render charts
    renderTrendChart(trends);
    renderStatusChart();
  } catch (err) {
    console.error('Failed to render charts:', err);
  }
}

/**
 * Returns true when dark mode is active (html.dark class present)
 */
function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

/**
 * Chart theme colours — swaps based on current dark/light mode
 */
function chartTheme() {
  const dark = isDarkMode();
  return {
    gridColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    tickColor: dark ? '#94a3b8' : '#64748b',
    legendColor: dark ? '#cbd5e1' : '#334155',
    totalLine: dark ? '#7dd3fc' : '#1e2a3a',
    totalFill: dark ? 'rgba(125,211,252,0.08)' : 'rgba(30,42,58,0.07)',
    submittedLine: '#4299e1',
    submittedFill: 'rgba(66,153,225,0.1)',
    interviewingLine: '#ed8936',
    interviewingFill: 'rgba(237,137,54,0.1)',
  };
}

/**
 * Render applications over time chart
 */
function renderTrendChart(trends: DailyTrend[]) {
  const canvas = document.getElementById('trendChart') as HTMLCanvasElement;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  const t = chartTheme();

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trends.map(d => formatDate(d.date)),
      datasets: [
        {
          label: 'Total',
          data: trends.map(d => d.total),
          borderColor: t.totalLine,
          backgroundColor: t.totalFill,
          tension: 0.4,
          fill: true,
        },
        {
          label: 'Submitted',
          data: trends.map(d => d.submitted),
          borderColor: t.submittedLine,
          backgroundColor: t.submittedFill,
          tension: 0.4,
          fill: true,
        },
        {
          label: 'Interviewing',
          data: trends.map(d => d.interviewing),
          borderColor: t.interviewingLine,
          backgroundColor: t.interviewingFill,
          tension: 0.4,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: t.legendColor },
        },
      },
      scales: {
        x: {
          ticks: { color: t.tickColor },
          grid: { color: t.gridColor },
        },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: t.tickColor },
          grid: { color: t.gridColor },
        },
      },
    },
  });
}

/**
 * Render status distribution chart
 */
function renderStatusChart() {
  const canvas = document.getElementById('statusChart') as HTMLCanvasElement;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const t = chartTheme();
  
  const submitted = allApplications.filter(a => a.status === 'submitted').length;
  const interviewing = allApplications.filter(a => a.status === 'interviewing').length;
  const rejected = allApplications.filter(a => a.status === 'rejected').length;
  const accepted = allApplications.filter(a => a.status === 'accepted').length;
  const withdrawn = allApplications.filter(a => a.status === 'withdrawn').length;
  
  statusChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Submitted', 'Interviewing', 'Rejected', 'Accepted', 'Withdrawn'],
      datasets: [{
        data: [submitted, interviewing, rejected, accepted, withdrawn],
        backgroundColor: [
          'rgba(66, 153, 225, 0.8)',
          'rgba(237, 137, 54, 0.8)',
          'rgba(245, 101, 101, 0.8)',
          'rgba(72, 187, 120, 0.8)',
          'rgba(160, 174, 192, 0.8)',
        ],
        borderColor: [
          '#4299e1',
          '#ed8936',
          '#f56565',
          '#48bb78',
          '#a0aec0',
        ],
        borderWidth: isDarkMode() ? 0 : 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: t.legendColor },
        },
      },
    },
  });
}

/**
 * Handle CSV export
 */
function handleExport() {
  try {
    const csv = generateCSV(filteredApplications);
    downloadCSV(csv, `job-applications-${new Date().toISOString().split('T')[0]}.csv`);
  } catch (err) {
    console.error('Failed to export CSV:', err);
    alert('Failed to export applications. Check console for details.');
  }
}

/**
 * Generate CSV from applications
 */
function generateCSV(apps: JobApplication[]): string {
  const headers = ['Date', 'Time', 'Job Title', 'Company', 'Status', 'ATS', 'Notes', 'URL'];
  const rows = apps.map(app => {
    const date = new Date(app.timestamp);
    return [
      date.toISOString().split('T')[0],
      date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      app.jobTitle,
      app.company,
      app.status,
      app.atsHint || '',
      app.notes || '',
      app.url,
    ].map(escapeCSV);
  });
  
  return [
    headers.join(','),
    ...rows.map(row => row.join(',')),
  ].join('\n');
}

/**
 * Download CSV file
 */
function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Utility: Set element text content
 */
function setElementText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

/**
 * Utility: Format date (YYYY-MM-DD to readable format)
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Utility: Escape HTML
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Utility: Escape CSV field
 */
function escapeCSV(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Show error message
 */
function showError(message: string) {
  const container = document.getElementById('kanbanContent');
  if (container) {
    setHTML(container, `
      <div class="empty-state">
        <h3>Error</h3>
        <p>${escapeHtml(message)}</p>
      </div>
    `);
  }
}

/**
 * Clear all application data
 */
async function clearAllData() {
  const confirmed = confirm(
    'Are you sure you want to delete ALL application data? This cannot be undone.'
  );

  if (!confirmed) return;

  try {
    console.log('[Dashboard] Clearing all data...');

    // Build keys for past 365 days and remove any that exist
    const keysToRemove: string[] = [];
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      keysToRemove.push(`dailySummary_${d.toISOString().split('T')[0]}`);
    }

    await browser.storage.local.remove(keysToRemove);
    console.log('[Dashboard] Cleared', keysToRemove.length, 'daily summaries');

    location.reload();
  } catch (err) {
    console.error('[Dashboard] Failed to clear data:', err);
    showError('Failed to clear data');
  }
}

// Re-render charts when dark/light mode is toggled so colours update live
new MutationObserver(() => {
  renderCharts();
}).observe(document.documentElement, { attributeFilter: ['class'] });

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
