import {
  type ProfileMeta,
  getProfilesIndex,
  listProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
  updateProfileMeta,
  getProfileById,
  migrateToMultiProfile,
} from '../shared/profile';
import { setHTML } from '../shared/html';

const COLORS = [
  '#7c3aed', '#2563eb', '#059669', '#d97706',
  '#dc2626', '#8b5cf6', '#0891b2', '#be185d',
];

let allProfiles: ProfileMeta[] = [];
let activeId = 'default';
let editMode = false;

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

async function loadProfiles(): Promise<void> {
  await migrateToMultiProfile();
  const index = await getProfilesIndex();
  activeId = index?.activeId ?? 'default';
  allProfiles = await listProfiles();
  renderActiveBanner();
  renderGrid();
}

function renderActiveBanner(): void {
  const banner = document.getElementById('active-banner')!;
  const active = allProfiles.find(p => p.id === activeId);
  if (!active) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'flex';
  banner.style.background = `linear-gradient(135deg, ${active.color} 0%, ${active.color}cc 100%)`;
  const dot = document.getElementById('active-dot')!;
  dot.textContent = initials(active.name);
  setHTML(document.getElementById('active-name')!, escapeHtml(active.name));
  setHTML(
    document.getElementById('active-role')!,
    active.targetRole ? escapeHtml(active.targetRole) : 'No target role set',
  );
}

function renderGrid(): void {
  const grid = document.getElementById('profiles-grid')!;
  let html = '';

  for (const p of allProfiles) {
    const isActive = p.id === activeId;
    html += `
      <div class="profile-card ${isActive ? 'active' : ''}" data-id="${escapeHtml(p.id)}">
        ${isActive ? '<div class="active-tag">Active</div>' : ''}
        <div class="profile-card-header">
          <div class="profile-card-dot" style="background:${p.color}">${initials(p.name)}</div>
          <div>
            <div class="profile-card-name">${escapeHtml(p.name)}</div>
            ${p.targetRole ? `<div class="profile-card-role">${escapeHtml(p.targetRole)}</div>` : ''}
          </div>
        </div>
        <div class="profile-card-meta">Created ${relativeTime(p.createdAt)}</div>
        <div class="profile-card-actions">
          ${!isActive ? `<button class="btn-activate" data-activate="${escapeHtml(p.id)}">Activate</button>` : ''}
          <button class="btn-edit-profile" data-edit="${escapeHtml(p.id)}">Edit</button>
          <button class="btn-onboarding" data-onboard="${escapeHtml(p.id)}">Setup</button>
          ${allProfiles.length > 1 ? `<button class="btn-delete-profile" data-delete="${escapeHtml(p.id)}" title="Delete profile">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>` : ''}
        </div>
      </div>
    `;
  }

  html += `
    <div class="profile-card-new" id="btn-new-profile">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>New Profile</span>
    </div>
  `;

  setHTML(grid, html);
  bindCardEvents();
}

function bindCardEvents(): void {
  document.querySelectorAll('[data-activate]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.activate!;
      await setActiveProfile(id);
      await browser.runtime.sendMessage({ kind: 'SWITCH_PROFILE', profileId: id });
      await loadProfiles();
    });
  });

  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.edit!;
      openEditModal(id);
    });
  });

  document.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.delete!;
      const p = allProfiles.find(x => x.id === id);
      if (!p) return;
      if (!confirm(`Delete profile "${p.name}"? This cannot be undone.`)) return;
      await deleteProfile(id);
      await loadProfiles();
    });
  });

  document.querySelectorAll('[data-onboard]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.onboard!;
      browser.tabs.create({
        url: browser.runtime.getURL(`onboarding/onboarding.html?profileId=${id}`),
      });
    });
  });

  document.getElementById('btn-new-profile')?.addEventListener('click', () => {
    openCreateModal();
  });
}

function openCreateModal(): void {
  editMode = false;
  (document.getElementById('modal-title') as HTMLElement).textContent = 'New Profile';
  (document.getElementById('modal-submit') as HTMLElement).textContent = 'Create Profile';
  (document.getElementById('edit-id') as HTMLInputElement).value = '';
  (document.getElementById('profile-name') as HTMLInputElement).value = '';
  (document.getElementById('profile-role') as HTMLInputElement).value = '';

  const cloneSelect = document.getElementById('clone-from') as HTMLSelectElement;
  cloneSelect.innerHTML = '<option value="">Start empty</option>';
  cloneSelect.parentElement!.style.display = '';
  for (const p of allProfiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `Clone from "${p.name}"`;
    cloneSelect.appendChild(opt);
  }

  renderColorPicker(COLORS[allProfiles.length % COLORS.length]);
  document.getElementById('profile-modal')!.classList.add('active');
}

function openEditModal(id: string): void {
  const p = allProfiles.find(x => x.id === id);
  if (!p) return;
  editMode = true;
  (document.getElementById('modal-title') as HTMLElement).textContent = 'Edit Profile';
  (document.getElementById('modal-submit') as HTMLElement).textContent = 'Save Changes';
  (document.getElementById('edit-id') as HTMLInputElement).value = id;
  (document.getElementById('profile-name') as HTMLInputElement).value = p.name;
  (document.getElementById('profile-role') as HTMLInputElement).value = p.targetRole ?? '';
  document.getElementById('clone-from')!.parentElement!.style.display = 'none';

  renderColorPicker(p.color);
  document.getElementById('profile-modal')!.classList.add('active');
}

function renderColorPicker(selected: string): void {
  const container = document.getElementById('color-picker')!;
  container.innerHTML = '';
  for (const c of COLORS) {
    const el = document.createElement('div');
    el.className = `color-swatch ${c === selected ? 'selected' : ''}`;
    el.style.background = c;
    el.dataset.color = c;
    el.addEventListener('click', () => {
      container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      el.classList.add('selected');
    });
    container.appendChild(el);
  }
}

function getSelectedColor(): string {
  const sel = document.querySelector('.color-swatch.selected') as HTMLElement | null;
  return sel?.dataset.color ?? COLORS[0];
}

document.getElementById('profile-form')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = (document.getElementById('profile-name') as HTMLInputElement).value.trim();
  if (!name) return;
  const role = (document.getElementById('profile-role') as HTMLInputElement).value.trim() || undefined;
  const color = getSelectedColor();

  if (editMode) {
    const id = (document.getElementById('edit-id') as HTMLInputElement).value;
    await updateProfileMeta(id, { name, targetRole: role, color });
  } else {
    const cloneFrom = (document.getElementById('clone-from') as HTMLSelectElement).value || undefined;
    await createProfile(name, role, cloneFrom);
  }

  document.getElementById('profile-modal')!.classList.remove('active');
  await loadProfiles();
});

document.getElementById('modal-cancel')!.addEventListener('click', () => {
  document.getElementById('profile-modal')!.classList.remove('active');
});

document.getElementById('profile-modal')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('profile-modal')) {
    document.getElementById('profile-modal')!.classList.remove('active');
  }
});

loadProfiles();
