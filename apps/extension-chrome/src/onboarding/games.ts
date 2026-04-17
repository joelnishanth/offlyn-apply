/**
 * Mini-games for onboarding wait screens.
 *
 * - Trivia quiz: shown during Ollama model download
 * - Game picker (Word Scramble, Memory Flip, 2048, Dino Runner): shown during resume parsing
 */

// ─── Shared helpers ──────────────────────────────────────────────────────────

function el(tag: string, attrs: Record<string, string> = {}, ...children: (string | HTMLElement)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

function svgSpan(svgMarkup: string, className = ''): HTMLElement {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.innerHTML = svgMarkup;
  return span;
}

const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"';

const ICONS = {
  lightbulb: `<svg ${SVG_ATTRS}><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>`,
  briefcase: `<svg ${SVG_ATTRS}><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
  document:  `<svg ${SVG_ATTRS}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  mail:      `<svg ${SVG_ATTRS}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  target:    `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
  dollar:    `<svg ${SVG_ATTRS}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  handshake: `<svg ${SVG_ATTRS}><path d="M20.5 11.5L17 8l-4 1-3-3-5.5 5.5"/><path d="M17 8l-1.5 7.5L9 12l-3.5 3.5"/><path d="M3.5 11.5l4 4"/><path d="M15.5 15.5l4-4"/></svg>`,
  gradCap:   `<svg ${SVG_ATTRS}><path d="M22 10l-10-5L2 10l10 5 10-5z"/><path d="M6 12v5c0 2 3 3 6 3s6-1 6-3v-5"/><line x1="22" y1="10" x2="22" y2="16"/></svg>`,
  star:      `<svg ${SVG_ATTRS}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  runner:    `<svg ${SVG_ATTRS}><circle cx="17" cy="4" r="2"/><path d="M15 7l-5 5 4 4-3 6"/><path d="M7 12l-3 6"/><path d="M15 7l4 2v5"/></svg>`,
  letters:   `<svg ${SVG_ATTRS}><path d="M4 20h4l1-4h6l1 4h4"/><path d="M9 16l3-12 3 12"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
  cards:     `<svg ${SVG_ATTRS}><rect x="2" y="4" width="8" height="8" rx="1"/><rect x="14" y="4" width="8" height="8" rx="1"/><rect x="2" y="16" width="8" height="4" rx="1"/><rect x="14" y="16" width="8" height="4" rx="1"/></svg>`,
  grid:      `<svg ${SVG_ATTRS}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
} as const;

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── 1. TRIVIA QUIZ ─────────────────────────────────────────────────────────

interface TriviaQuestion {
  q: string;
  options: string[];
  answer: number; // 0-based index
  fact: string;
}

const TRIVIA_QUESTIONS: TriviaQuestion[] = [
  { q: 'What is the ideal resume length for someone with < 10 years of experience?', options: ['1 page', '2 pages', '3 pages', 'As long as needed'], answer: 0, fact: 'Recruiters spend an average of 7.4 seconds on an initial resume scan — keep it concise!' },
  { q: 'Which section do hiring managers look at first?', options: ['Education', 'Skills', 'Work experience', 'Hobbies'], answer: 2, fact: 'Relevant work experience is the #1 thing recruiters scan for before anything else.' },
  { q: 'What percentage of resumes are filtered out by ATS before a human sees them?', options: ['25%', '50%', '75%', '90%'], answer: 2, fact: 'About 75% of resumes never reach a human. Keyword optimization is critical.' },
  { q: 'What\'s the best way to follow up after a job application?', options: ['Call the CEO', 'Email after 1-2 weeks', 'Show up in person', 'Send gifts'], answer: 1, fact: 'A polite follow-up email 1-2 weeks after applying shows genuine interest.' },
  { q: 'Which of these is a red flag on a resume?', options: ['Using action verbs', 'Listing achievements', 'Including a photo (in the US)', 'Quantifying results'], answer: 2, fact: 'In the US, including a photo can lead to unconscious bias and is generally avoided.' },
  { q: 'What does "STAR" stand for in the STAR interview method?', options: ['Skills, Training, Aptitude, Results', 'Situation, Task, Action, Result', 'Strategy, Tactics, Approach, Review', 'Strengths, Talents, Abilities, Resilience'], answer: 1, fact: 'The STAR method helps structure behavioral interview answers with clear examples.' },
  { q: 'When negotiating salary, when should you name a number first?', options: ['Always', 'Never', 'Only if you have market data', 'Only for senior roles'], answer: 2, fact: 'Research shows naming a well-researched number first can anchor the negotiation in your favor.' },
  { q: 'What\'s the best time to send a job application email?', options: ['Friday afternoon', 'Monday morning', 'Tuesday 10am', 'Sunday night'], answer: 2, fact: 'Studies show Tuesday through Thursday mornings get the highest open rates for emails.' },
  { q: 'How long should a cover letter be?', options: ['Half a page', 'One page max', '2-3 pages', 'As long as needed'], answer: 1, fact: 'Keep your cover letter to one page — hiring managers prefer concise, targeted letters.' },
  { q: 'What\'s the most important thing to research before an interview?', options: ['The interviewer\'s social media', 'The company\'s mission and recent news', 'The office dress code', 'The company cafeteria menu'], answer: 1, fact: 'Showing knowledge of the company\'s mission and recent developments demonstrates genuine interest.' },
  { q: 'Which font is generally considered most professional for resumes?', options: ['Comic Sans', 'Times New Roman', 'Calibri or Garamond', 'Papyrus'], answer: 2, fact: 'Clean, readable fonts like Calibri, Garamond, or Helvetica are preferred by recruiters.' },
  { q: 'What should you do if you don\'t meet 100% of a job posting\'s requirements?', options: ['Don\'t apply', 'Apply if you meet ~60-70%', 'Lie about qualifications', 'Wait until you\'re fully qualified'], answer: 1, fact: 'Job postings describe ideal candidates. Meeting 60-70% of requirements is usually enough to apply.' },
  { q: 'What\'s the hidden job market?', options: ['Dark web job listings', 'Jobs filled through networking before being posted', 'Government jobs', 'Remote-only positions'], answer: 1, fact: 'Up to 70% of jobs are never publicly posted — networking is how most roles are filled.' },
  { q: 'How quickly should you send a thank-you note after an interview?', options: ['Within 24 hours', 'Within a week', 'Only if you liked the interview', 'Never — it seems desperate'], answer: 0, fact: 'A prompt thank-you email reinforces your interest and keeps you top of mind.' },
  { q: 'What\'s the biggest mistake in a cover letter?', options: ['Being too short', 'Being generic / not tailored', 'Using bullet points', 'Mentioning salary expectations'], answer: 1, fact: 'Generic cover letters scream "mass application." Tailor each one to the specific role and company.' },
];

let triviaCleanup: (() => void) | null = null;

export function mountTriviaGame(container: HTMLElement): void {
  destroyTriviaGame();
  const questions = shuffleArray(TRIVIA_QUESTIONS).slice(0, 8);
  let idx = 0;
  let score = 0;

  const root = el('div', { className: 'game-trivia' });
  const header = el('div', { className: 'game-trivia-header' });
  const scoreEl = el('span', { className: 'game-trivia-score' }, `Score: 0/${questions.length}`);
  const headerLabel = el('span', { style: 'display:inline-flex;align-items:center;gap:6px;' });
  headerLabel.appendChild(svgSpan(ICONS.lightbulb));
  headerLabel.appendChild(document.createTextNode('While you wait\u2026'));
  header.appendChild(headerLabel);
  header.appendChild(scoreEl);
  root.appendChild(header);

  const body = el('div', { className: 'game-trivia-body' });
  root.appendChild(body);

  function renderQuestion() {
    body.innerHTML = '';
    if (idx >= questions.length) {
      const pct = Math.round((score / questions.length) * 100);
      body.appendChild(el('div', { className: 'game-trivia-final' },
        el('div', { className: 'game-trivia-final-score' }, `${pct}%`),
        el('p', {}, `You got ${score} out of ${questions.length} right!`),
        el('p', { style: 'font-size:12px;color:var(--gray-400);margin-top:6px;' }, pct >= 75 ? 'You\'re interview-ready!' : 'Keep learning — you\'ve got this!'),
      ));
      const again = el('button', { className: 'game-trivia-again' }, 'Play Again');
      again.onclick = () => { idx = 0; score = 0; scoreEl.textContent = `Score: 0/${questions.length}`; renderQuestion(); };
      body.appendChild(again);
      return;
    }
    const q = questions[idx];
    body.appendChild(el('p', { className: 'game-trivia-q' }, `${idx + 1}. ${q.q}`));
    const opts = el('div', { className: 'game-trivia-opts' });
    q.options.forEach((opt, oi) => {
      const btn = el('button', { className: 'game-trivia-opt' }, opt);
      btn.onclick = () => {
        const isCorrect = oi === q.answer;
        if (isCorrect) score++;
        scoreEl.textContent = `Score: ${score}/${questions.length}`;

        opts.querySelectorAll('button').forEach((b, bi) => {
          (b as HTMLButtonElement).disabled = true;
          if (bi === q.answer) b.classList.add('correct');
          if (bi === oi && !isCorrect) b.classList.add('wrong');
        });

        const fact = el('p', { className: 'game-trivia-fact' }, q.fact);
        body.appendChild(fact);

        const next = el('button', { className: 'game-trivia-next' }, idx < questions.length - 1 ? 'Next \u2192' : 'See Results');
        next.onclick = () => { idx++; renderQuestion(); };
        body.appendChild(next);
      };
      opts.appendChild(btn);
    });
    body.appendChild(opts);
  }

  renderQuestion();
  container.appendChild(root);
  triviaCleanup = () => { root.remove(); };
}

export function destroyTriviaGame(): void {
  if (triviaCleanup) { triviaCleanup(); triviaCleanup = null; }
}


// ─── 2. WORD SCRAMBLE ───────────────────────────────────────────────────────

const WORD_BANK = [
  { word: 'INTERVIEW', hint: 'You sit across a desk for this' },
  { word: 'RESUME', hint: 'Document summarizing your career' },
  { word: 'SALARY', hint: 'What you negotiate at the end' },
  { word: 'NETWORK', hint: 'It\'s not what you know, it\'s who you know' },
  { word: 'RECRUITER', hint: 'Person who finds candidates' },
  { word: 'LINKEDIN', hint: 'Professional social network' },
  { word: 'REFERENCE', hint: 'Someone who vouches for you' },
  { word: 'PROMOTION', hint: 'Moving up in your company' },
  { word: 'BENEFITS', hint: 'Health insurance, PTO, 401k...' },
  { word: 'DEADLINE', hint: 'Don\'t miss this date' },
  { word: 'ONBOARD', hint: 'Your first days at a new job' },
  { word: 'MENTOR', hint: 'Experienced guide in your career' },
  { word: 'SKILL', hint: 'What you list on your resume' },
  { word: 'HYBRID', hint: 'Part office, part remote' },
  { word: 'CULTURE', hint: 'Company vibe and values' },
];

let scrambleCleanup: (() => void) | null = null;

function scramble(word: string): string {
  const letters = word.split('');
  let s: string;
  do { s = shuffleArray(letters).join(''); } while (s === word);
  return s;
}

export function mountWordScramble(container: HTMLElement): void {
  destroyWordScramble();
  const words = shuffleArray(WORD_BANK).slice(0, 6);
  let idx = 0, score = 0;

  const root = el('div', { className: 'game-scramble' });
  const scoreBar = el('div', { className: 'game-scramble-score' }, `0/${words.length}`);
  root.appendChild(scoreBar);

  const body = el('div', { className: 'game-scramble-body' });
  root.appendChild(body);

  function render() {
    body.innerHTML = '';
    if (idx >= words.length) {
      body.appendChild(el('div', { className: 'game-scramble-done' },
        el('div', { style: 'font-size:28px;font-weight:700;color:var(--green);' }, `${score}/${words.length}`),
        el('p', {}, 'Words unscrambled!'),
      ));
      const again = el('button', { className: 'game-btn-small' }, 'Play Again');
      again.onclick = () => { idx = 0; score = 0; scoreBar.textContent = `0/${words.length}`; render(); };
      body.appendChild(again);
      return;
    }
    const w = words[idx];
    const scrambled = scramble(w.word);
    body.appendChild(el('div', { className: 'game-scramble-letters' }, scrambled));
    body.appendChild(el('p', { className: 'game-scramble-hint' }, `Hint: ${w.hint}`));
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = w.word.length;
    input.className = 'game-scramble-input';
    input.placeholder = `${w.word.length} letters`;
    input.autocomplete = 'off';

    const submit = el('button', { className: 'game-btn-small' }, 'Check');
    const feedback = el('p', { className: 'game-scramble-feedback' });

    const check = () => {
      const guess = input.value.toUpperCase().trim();
      if (guess === w.word) {
        score++;
        scoreBar.textContent = `${score}/${words.length}`;
        feedback.textContent = 'Correct!';
        feedback.className = 'game-scramble-feedback correct';
        input.disabled = true;
        (submit as HTMLButtonElement).disabled = true;
        setTimeout(() => { idx++; render(); }, 800);
      } else {
        feedback.textContent = 'Try again!';
        feedback.className = 'game-scramble-feedback wrong';
        input.focus();
      }
    };
    submit.onclick = check;
    input.onkeydown = (e) => { if (e.key === 'Enter') check(); };

    const skipBtn = el('button', { className: 'game-btn-link' }, 'Skip');
    skipBtn.onclick = () => {
      feedback.textContent = `It was: ${w.word}`;
      feedback.className = 'game-scramble-feedback wrong';
      input.disabled = true;
      (submit as HTMLButtonElement).disabled = true;
      setTimeout(() => { idx++; render(); }, 1200);
    };

    const row = el('div', { style: 'display:flex;gap:8px;align-items:center;justify-content:center;' });
    row.appendChild(input);
    row.appendChild(submit);
    row.appendChild(skipBtn);
    body.appendChild(row);
    body.appendChild(feedback);
    setTimeout(() => input.focus(), 50);
  }

  render();
  container.appendChild(root);
  scrambleCleanup = () => root.remove();
}

export function destroyWordScramble(): void {
  if (scrambleCleanup) { scrambleCleanup(); scrambleCleanup = null; }
}


// ─── 3. MEMORY CARD FLIP ────────────────────────────────────────────────────

interface MemoryIcon { id: string; svg: string }
const MEMORY_ICONS: MemoryIcon[] = [
  { id: 'briefcase', svg: ICONS.briefcase },
  { id: 'document',  svg: ICONS.document },
  { id: 'mail',      svg: ICONS.mail },
  { id: 'target',    svg: ICONS.target },
  { id: 'dollar',    svg: ICONS.dollar },
  { id: 'handshake', svg: ICONS.handshake },
  { id: 'gradCap',   svg: ICONS.gradCap },
  { id: 'star',      svg: ICONS.star },
];

let memoryCleanup: (() => void) | null = null;

export function mountMemoryFlip(container: HTMLElement): void {
  destroyMemoryFlip();
  const pairs = shuffleArray([...MEMORY_ICONS].slice(0, 6));
  const cards = shuffleArray([...pairs, ...pairs]);
  let flipped: number[] = [];
  let matched = new Set<number>();
  let moves = 0;
  let busy = false;

  const root = el('div', { className: 'game-memory' });
  const info = el('div', { className: 'game-memory-info' });
  const movesEl = el('span', {}, 'Moves: 0');
  const matchesEl = el('span', {}, `Matched: 0/${pairs.length}`);
  info.appendChild(movesEl);
  info.appendChild(matchesEl);
  root.appendChild(info);

  const grid = el('div', { className: 'game-memory-grid' });
  root.appendChild(grid);

  const cardEls: HTMLElement[] = cards.map((icon, i) => {
    const card = el('div', { className: 'game-memory-card' });
    card.dataset.idx = String(i);
    const front = el('div', { className: 'game-memory-front' }, '?');
    const back = el('div', { className: 'game-memory-back' });
    back.innerHTML = icon.svg;
    card.appendChild(front);
    card.appendChild(back);
    card.onclick = () => flip(i);
    grid.appendChild(card);
    return card;
  });

  function flip(i: number) {
    if (busy || flipped.includes(i) || matched.has(i)) return;
    flipped.push(i);
    cardEls[i].classList.add('flipped');

    if (flipped.length === 2) {
      moves++;
      movesEl.textContent = `Moves: ${moves}`;
      busy = true;
      const [a, b] = flipped;
      if (cards[a].id === cards[b].id) {
        matched.add(a);
        matched.add(b);
        matchesEl.textContent = `Matched: ${matched.size / 2}/${pairs.length}`;
        cardEls[a].classList.add('matched');
        cardEls[b].classList.add('matched');
        flipped = [];
        busy = false;
        if (matched.size === cards.length) showWin();
      } else {
        setTimeout(() => {
          cardEls[a].classList.remove('flipped');
          cardEls[b].classList.remove('flipped');
          flipped = [];
          busy = false;
        }, 700);
      }
    }
  }

  function showWin() {
    const msg = el('div', { className: 'game-memory-win' },
      el('p', {}, `Done in ${moves} moves!`),
    );
    const again = el('button', { className: 'game-btn-small' }, 'Play Again');
    again.onclick = () => {
      root.remove();
      mountMemoryFlip(container);
    };
    msg.appendChild(again);
    root.appendChild(msg);
  }

  container.appendChild(root);
  memoryCleanup = () => root.remove();
}

export function destroyMemoryFlip(): void {
  if (memoryCleanup) { memoryCleanup(); memoryCleanup = null; }
}


// ─── 4. 2048 ────────────────────────────────────────────────────────────────

let game2048Cleanup: (() => void) | null = null;

export function mount2048(container: HTMLElement): void {
  destroy2048();
  const SIZE = 4;
  let grid: number[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  let score = 0;
  let gameOver = false;

  const root = el('div', { className: 'game-2048' });
  const header = el('div', { className: 'game-2048-header' });
  const scoreEl = el('span', { className: 'game-2048-score' }, 'Score: 0');
  const newBtn = el('button', { className: 'game-btn-small' }, 'New');
  newBtn.onclick = restart;
  header.appendChild(scoreEl);
  header.appendChild(newBtn);
  root.appendChild(header);

  const board = el('div', { className: 'game-2048-board' });
  root.appendChild(board);

  const msgEl = el('div', { className: 'game-2048-msg', style: 'display:none;' });
  root.appendChild(msgEl);

  function addRandom() {
    const empty: [number, number][] = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (grid[r][c] === 0) empty.push([r, c]);
    if (empty.length === 0) return;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  }

  function render() {
    board.innerHTML = '';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = grid[r][c];
        const cell = el('div', { className: `game-2048-cell v${v}` }, v ? String(v) : '');
        board.appendChild(cell);
      }
    }
    scoreEl.textContent = `Score: ${score}`;
  }

  function slide(row: number[]): { row: number[]; pts: number; moved: boolean } {
    let pts = 0;
    const nums = row.filter(x => x !== 0);
    const merged: number[] = [];
    let i = 0;
    while (i < nums.length) {
      if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
        const val = nums[i] * 2;
        merged.push(val);
        pts += val;
        i += 2;
      } else {
        merged.push(nums[i]);
        i++;
      }
    }
    while (merged.length < SIZE) merged.push(0);
    const moved = row.some((v, idx) => v !== merged[idx]);
    return { row: merged, pts, moved };
  }

  function move(dir: 'left' | 'right' | 'up' | 'down'): boolean {
    let moved = false;
    const getRow = (r: number): number[] => {
      if (dir === 'left') return grid[r].slice();
      if (dir === 'right') return grid[r].slice().reverse();
      if (dir === 'up') return grid.map(row => row[r]);
      return grid.map(row => row[r]).reverse();
    };
    const setRow = (r: number, row: number[]) => {
      if (dir === 'right') row = row.slice().reverse();
      if (dir === 'down') row = row.slice().reverse();
      if (dir === 'left' || dir === 'right') grid[r] = row;
      else row.forEach((v, i) => grid[i][r] = v);
    };
    for (let r = 0; r < SIZE; r++) {
      const result = slide(getRow(r));
      if (result.moved) moved = true;
      score += result.pts;
      setRow(r, result.row);
    }
    return moved;
  }

  function checkGameOver(): boolean {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c] === 0) return false;
        if (c + 1 < SIZE && grid[r][c] === grid[r][c + 1]) return false;
        if (r + 1 < SIZE && grid[r][c] === grid[r + 1][c]) return false;
      }
    return true;
  }

  function handleKey(e: KeyboardEvent) {
    if (gameOver) return;
    const map: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    if (move(dir)) {
      addRandom();
      render();
      if (checkGameOver()) {
        gameOver = true;
        msgEl.textContent = `Game Over! Score: ${score}`;
        msgEl.style.display = '';
      }
    }
  }

  // Touch / swipe support
  let touchX = 0, touchY = 0;
  function handleTouchStart(e: TouchEvent) { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }
  function handleTouchEnd(e: TouchEvent) {
    if (gameOver) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return;
    const dir: 'left' | 'right' | 'up' | 'down' = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    if (move(dir)) {
      addRandom();
      render();
      if (checkGameOver()) {
        gameOver = true;
        msgEl.textContent = `Game Over! Score: ${score}`;
        msgEl.style.display = '';
      }
    }
  }

  function restart() {
    grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    score = 0;
    gameOver = false;
    msgEl.style.display = 'none';
    addRandom();
    addRandom();
    render();
  }

  document.addEventListener('keydown', handleKey);
  board.addEventListener('touchstart', handleTouchStart, { passive: true });
  board.addEventListener('touchend', handleTouchEnd, { passive: true });

  restart();
  container.appendChild(root);

  game2048Cleanup = () => {
    document.removeEventListener('keydown', handleKey);
    board.removeEventListener('touchstart', handleTouchStart);
    board.removeEventListener('touchend', handleTouchEnd);
    root.remove();
  };
}

export function destroy2048(): void {
  if (game2048Cleanup) { game2048Cleanup(); game2048Cleanup = null; }
}


// ─── 5. DINO RUNNER ─────────────────────────────────────────────────────────

let dinoCleanup: (() => void) | null = null;

export function mountDinoRunner(container: HTMLElement): void {
  destroyDinoRunner();

  const W = 400, H = 150;
  const GROUND_Y = H - 30;
  const GRAVITY = 0.6;
  const JUMP_VEL = -10;

  const root = el('div', { className: 'game-dino' });
  const hud = el('div', { className: 'game-dino-hud' });
  const scoreEl = el('span', {}, 'Score: 0');
  hud.appendChild(scoreEl);
  root.appendChild(hud);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.className = 'game-dino-canvas';
  root.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  const isDark = document.documentElement.classList.contains('dark');
  const FG = isDark ? '#e5e5e5' : '#2c2b28';
  const BG = isDark ? '#1a1a1a' : '#f4f3f0';
  const GREEN = isDark ? '#2da870' : '#1a7f5a';
  const RED = isDark ? '#f87171' : '#dc2626';

  interface Obstacle {
    x: number;
    w: number;
    h: number;
    kind: 'rejection' | 'offer';
    label: string;
  }

  const REJECTION_LABELS = ['404', 'Rejected', 'Ghosted', 'No Reply', 'Overqualified', 'Position Filled'];
  const OFFER_LABELS = ['Offer!', '$$$', 'Hired!', 'Welcome!'];

  let playerY = GROUND_Y;
  let velY = 0;
  let jumping = false;
  let obstacles: Obstacle[] = [];
  let score = 0;
  let hiScore = 0;
  let speed = 3;
  let frame = 0;
  let alive = true;
  let started = false;
  let rafId = 0;

  function spawnObstacle() {
    const isOffer = Math.random() < 0.25;
    const h = 20 + Math.random() * 15;
    const w = 30 + Math.random() * 20;
    obstacles.push({
      x: W + 10,
      w, h,
      kind: isOffer ? 'offer' : 'rejection',
      label: isOffer
        ? OFFER_LABELS[Math.floor(Math.random() * OFFER_LABELS.length)]
        : REJECTION_LABELS[Math.floor(Math.random() * REJECTION_LABELS.length)],
    });
  }

  function jump() {
    if (!alive) { restart(); return; }
    if (!started) { started = true; }
    if (!jumping) { velY = JUMP_VEL; jumping = true; }
  }

  function restart() {
    playerY = GROUND_Y;
    velY = 0;
    jumping = false;
    obstacles = [];
    score = 0;
    speed = 3;
    frame = 0;
    alive = true;
    started = true;
  }

  function update() {
    if (!alive || !started) return;
    frame++;
    speed = 3 + Math.floor(frame / 500) * 0.5;

    // Player physics
    velY += GRAVITY;
    playerY += velY;
    if (playerY >= GROUND_Y) { playerY = GROUND_Y; velY = 0; jumping = false; }

    // Spawn
    if (frame % Math.max(40, 80 - Math.floor(frame / 200)) === 0) spawnObstacle();

    // Move obstacles
    for (const o of obstacles) o.x -= speed;
    obstacles = obstacles.filter(o => o.x + o.w > -10);

    // Collisions (player is a 20x20 box)
    const px = 50, pw = 16, ph = 20;
    const py = playerY - ph;
    for (const o of obstacles) {
      const ox = o.x, oy = GROUND_Y - o.h;
      if (px + pw > ox && px < ox + o.w && py + ph > oy && py < oy + o.h) {
        if (o.kind === 'offer') {
          score += 50;
          o.x = -100; // remove
        } else {
          alive = false;
          if (score > hiScore) hiScore = score;
        }
      }
    }
    if (alive) score++;
  }

  function draw() {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    // Ground
    ctx.strokeStyle = FG;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 1);
    ctx.lineTo(W, GROUND_Y + 1);
    ctx.stroke();

    // Player (little person)
    const px = 50, ph = 20, pw = 16;
    const py = playerY - ph;
    ctx.fillStyle = GREEN;
    ctx.fillRect(px, py, pw, ph);
    // head
    ctx.beginPath();
    ctx.arc(px + pw / 2, py - 5, 5, 0, Math.PI * 2);
    ctx.fill();

    // Obstacles
    for (const o of obstacles) {
      ctx.fillStyle = o.kind === 'rejection' ? RED : GREEN;
      const oy = GROUND_Y - o.h;
      ctx.fillRect(o.x, oy, o.w, o.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(o.label, o.x + o.w / 2, oy + o.h / 2 + 3, o.w - 4);
    }

    // Score
    ctx.fillStyle = FG;
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`Score: ${score}`, W - 10, 18);
    if (hiScore > 0) ctx.fillText(`Best: ${hiScore}`, W - 10, 32);

    if (!started) {
      ctx.fillStyle = FG;
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Press Space or Tap to start', W / 2, H / 2);
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText('Jump over rejections, collect offers!', W / 2, H / 2 + 18);
    }

    if (!alive) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Game Over!', W / 2, H / 2 - 8);
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText(`Score: ${score} \u2022 Tap/Space to retry`, W / 2, H / 2 + 12);
    }
  }

  function loop() {
    update();
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); jump(); }
  }
  function handleClick() { jump(); }

  document.addEventListener('keydown', handleKey);
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); jump(); }, { passive: false });

  loop();
  container.appendChild(root);

  dinoCleanup = () => {
    cancelAnimationFrame(rafId);
    document.removeEventListener('keydown', handleKey);
    canvas.removeEventListener('click', handleClick);
    root.remove();
  };
}

export function destroyDinoRunner(): void {
  if (dinoCleanup) { dinoCleanup(); dinoCleanup = null; }
}


// ─── GAME PICKER (for resume parsing wait) ──────────────────────────────────

const GAME_LIST = [
  { id: 'dino', icon: ICONS.runner, name: 'Job Runner', desc: 'Dodge rejections, collect offers', mount: mountDinoRunner, destroy: destroyDinoRunner },
  { id: 'scramble', icon: ICONS.letters, name: 'Word Scramble', desc: 'Unscramble job terms', mount: mountWordScramble, destroy: destroyWordScramble },
  { id: 'memory', icon: ICONS.cards, name: 'Memory Match', desc: 'Flip cards and find pairs', mount: mountMemoryFlip, destroy: destroyMemoryFlip },
  { id: '2048', icon: ICONS.grid, name: '2048', desc: 'Merge tiles to reach 2048', mount: mount2048, destroy: destroy2048 },
];

let pickerCleanup: (() => void) | null = null;
let activeGameDestroy: (() => void) | null = null;

export function mountGamePicker(container: HTMLElement): void {
  destroyGamePicker();
  const root = el('div', { className: 'game-picker' });

  const title = el('p', { className: 'game-picker-title' }, 'Play while you wait');
  root.appendChild(title);

  const cards = el('div', { className: 'game-picker-cards' });
  const gameArea = el('div', { className: 'game-picker-area' });
  const backBtn = el('button', { className: 'game-btn-link', style: 'display:none;margin-bottom:8px;' }, '\u2190 Back to games');

  function showPicker() {
    if (activeGameDestroy) { activeGameDestroy(); activeGameDestroy = null; }
    gameArea.innerHTML = '';
    cards.style.display = '';
    backBtn.style.display = 'none';
  }

  backBtn.onclick = showPicker;

  for (const g of GAME_LIST) {
    const card = el('button', { className: 'game-picker-card' },
      svgSpan(g.icon, 'game-picker-icon'),
      el('span', { className: 'game-picker-name' }, g.name),
      el('span', { className: 'game-picker-desc' }, g.desc),
    );
    card.onclick = () => {
      cards.style.display = 'none';
      backBtn.style.display = '';
      g.mount(gameArea);
      activeGameDestroy = g.destroy;
    };
    cards.appendChild(card);
  }

  root.appendChild(cards);
  root.appendChild(backBtn);
  root.appendChild(gameArea);
  container.appendChild(root);

  pickerCleanup = () => {
    if (activeGameDestroy) { activeGameDestroy(); activeGameDestroy = null; }
    root.remove();
  };
}

export function destroyGamePicker(): void {
  if (pickerCleanup) { pickerCleanup(); pickerCleanup = null; }
}

export function destroyAllGames(): void {
  destroyTriviaGame();
  destroyWordScramble();
  destroyMemoryFlip();
  destroy2048();
  destroyDinoRunner();
  destroyGamePicker();
}
