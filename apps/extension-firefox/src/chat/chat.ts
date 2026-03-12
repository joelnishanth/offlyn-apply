/**
 * Chat with your Resume — page logic
 *
 * Sends CHAT_QUERY messages to the background script, which uses the stored
 * profile + graph memory + Ollama to answer questions about the user's background.
 * The source tag on each reply shows whether the answer came from the graph,
 * the profile directly, or the LLM.
 */

// ── Sample questions ──────────────────────────────────────────────────────

const SAMPLE_QUESTIONS = [
  'What is my current job title?',
  'What are my top skills?',
  'How many years of experience do I have?',
  'What companies have I worked at?',
  "What's my highest level of education?",
  'What programming languages do I know?',
  'Do I require visa sponsorship?',
  'Where am I located?',
  'What is my email address?',
  "What's my most recent project?",
  "Am I legally authorized to work in the US?",
  'What is my LinkedIn URL?',
];

// ── State ─────────────────────────────────────────────────────────────────

let profileLoaded = false;
let isBusy = false;

// ── DOM helpers ───────────────────────────────────────────────────────────

function qs<T extends Element>(sel: string): T {
  return document.querySelector(sel) as T;
}

function scrollToBottom(): void {
  const messages = qs<HTMLElement>('#messages');
  messages.scrollTop = messages.scrollHeight;
}

function autoResize(ta: HTMLTextAreaElement): void {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

// ── Render helpers ────────────────────────────────────────────────────────

function removeWelcome(): void {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
  const chips = document.getElementById('chips-section');
  if (chips) chips.style.display = 'none';
}

function appendUserBubble(text: string): void {
  const messages = qs<HTMLElement>('#messages');
  const div = document.createElement('div');
  div.className = 'message user';
  div.innerHTML = `
    <div class="avatar avatar-user">U</div>
    <div class="bubble bubble-user">${escapeHtml(text)}</div>
  `;
  messages.appendChild(div);
  scrollToBottom();
}

function appendThinking(): HTMLElement {
  const messages = qs<HTMLElement>('#messages');
  const div = document.createElement('div');
  div.className = 'message';
  div.id = 'thinking-indicator';
  div.innerHTML = `
    <div class="avatar avatar-ai">✦</div>
    <div class="bubble bubble-ai">
      <div class="thinking">
        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
      </div>
    </div>
  `;
  messages.appendChild(div);
  scrollToBottom();
  return div;
}

function removeThinking(): void {
  const el = document.getElementById('thinking-indicator');
  if (el) el.remove();
}

type AnswerSource = 'graph' | 'profile' | 'llm' | 'error';

function appendAIBubble(text: string, source: AnswerSource): void {
  const messages = qs<HTMLElement>('#messages');
  const div = document.createElement('div');
  div.className = 'message';

  const sourceLabel =
    source === 'graph'   ? '⬡ Graph memory'   :
    source === 'profile' ? '👤 Profile'        :
    source === 'llm'     ? '✦ Ollama'          :
    '⚠ Error';

  const sourceClass =
    source === 'graph'   ? 'graph' :
    source === 'llm'     ? 'llm'   :
    '';

  div.innerHTML = `
    <div class="avatar avatar-ai">✦</div>
    <div class="bubble bubble-ai">
      <div style="white-space:pre-wrap;">${escapeHtml(text)}</div>
      <div class="source-badge ${sourceClass}">${sourceLabel}</div>
    </div>
  `;
  messages.appendChild(div);
  scrollToBottom();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Message passing ───────────────────────────────────────────────────────

async function sendChatQuery(question: string): Promise<{ answer: string; source: AnswerSource }> {
  try {
    const response = await browser.runtime.sendMessage({
      kind: 'CHAT_QUERY',
      question,
    }) as { answer: string; source: AnswerSource } | undefined;

    if (!response) {
      return { answer: 'No response from background. Is Ollama running?', source: 'error' };
    }
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { answer: `Error: ${msg}`, source: 'error' };
  }
}

// ── Submit logic ──────────────────────────────────────────────────────────

async function submitQuestion(question: string): Promise<void> {
  if (!question.trim() || isBusy) return;

  isBusy = true;
  const input = qs<HTMLTextAreaElement>('#chat-input');
  const sendBtn = qs<HTMLButtonElement>('#send-btn');

  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;

  removeWelcome();
  appendUserBubble(question);
  appendThinking();

  const { answer, source } = await sendChatQuery(question);

  removeThinking();
  appendAIBubble(answer, source);

  isBusy = false;
  sendBtn.disabled = false;
  input.focus();
}

// ── Init ──────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const badge = qs<HTMLElement>('#profile-badge');
  const sendBtn = qs<HTMLButtonElement>('#send-btn');
  const input = qs<HTMLTextAreaElement>('#chat-input');
  const backBtn = qs<HTMLButtonElement>('#back-btn');

  // Back button — close this tab
  backBtn.addEventListener('click', () => window.close());

  // Auto-resize textarea
  input.addEventListener('input', () => {
    autoResize(input);
    sendBtn.disabled = input.value.trim().length === 0 || isBusy;
  });

  // Send on Enter (Shift+Enter = newline)
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitQuestion(input.value.trim());
    }
  });

  // Send button
  sendBtn.addEventListener('click', () => submitQuestion(input.value.trim()));

  // Render chips
  const chipsEl = qs<HTMLElement>('#chips');
  for (const q of SAMPLE_QUESTIONS) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = q;
    chip.addEventListener('click', () => submitQuestion(q));
    chipsEl.appendChild(chip);
  }

  // Check profile status via background
  try {
    badge.classList.add('loading');
    badge.textContent = 'Loading…';

    const resp = await browser.runtime.sendMessage({ kind: 'CHAT_PROFILE_STATUS' }) as
      | { hasProfile: boolean; name?: string }
      | undefined;

    if (resp?.hasProfile) {
      badge.classList.remove('loading');
      badge.textContent = resp.name ? `Hi, ${resp.name.split(' ')[0]}` : 'Profile loaded';
      profileLoaded = true;
      sendBtn.disabled = false;
    } else {
      badge.classList.remove('loading');
      badge.textContent = 'No profile';
      badge.style.background = 'rgba(239,68,68,.2)';
      badge.style.color = '#f87171';
      badge.style.borderColor = 'rgba(248,113,113,.2)';
      document.getElementById('no-profile-banner')!.style.display = 'flex';
      // Still allow asking — background will explain
      sendBtn.disabled = false;
    }
  } catch {
    badge.classList.remove('loading');
    badge.textContent = 'Offline';
  }

  input.focus();
}

document.addEventListener('DOMContentLoaded', init);
