/**
 * Offlyn Apply — Lightweight Feature Tour
 * Shows a step-by-step tour highlighting UI elements with a backdrop cutout.
 * Persists completion to localStorage so it only shows once.
 */
(function () {
  var TOUR_DONE_KEY = 'ofl-tour-done';
  var TOUR_PENDING_KEY = 'ofl-tour-pending';

  var overlay, tooltip, backdrop;
  var steps = [];
  var currentStep = 0;

  function isDone(tourId) {
    try { return localStorage.getItem(TOUR_DONE_KEY + '-' + tourId) === '1'; } catch (_) { return false; }
  }

  function markDone(tourId) {
    try { localStorage.setItem(TOUR_DONE_KEY + '-' + tourId, '1'); } catch (_) {}
  }

  function clearPending() {
    try { localStorage.removeItem(TOUR_PENDING_KEY); } catch (_) {}
  }

  function isPending() {
    try { return localStorage.getItem(TOUR_PENDING_KEY) === 'true'; } catch (_) { return false; }
  }

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'ofl-tour-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';

    backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:2147483645;transition:opacity 0.3s;';
    backdrop.addEventListener('click', function () { endTour(); });

    tooltip = document.createElement('div');
    tooltip.id = 'ofl-tour-tooltip';
    tooltip.style.cssText = [
      'position:fixed;z-index:2147483647;background:#fff;border-radius:12px;',
      'box-shadow:0 8px 32px rgba(0,0,0,0.25);padding:20px 24px 16px;',
      'max-width:320px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      'color:#1e293b;pointer-events:auto;transition:top 0.3s ease,left 0.3s ease;'
    ].join('');

    document.body.appendChild(backdrop);
    document.body.appendChild(overlay);
    document.body.appendChild(tooltip);
  }

  function removeOverlay() {
    if (backdrop) backdrop.remove();
    if (overlay) overlay.remove();
    if (tooltip) tooltip.remove();
    backdrop = overlay = tooltip = null;
  }

  function positionTooltip(target) {
    var rect = target.getBoundingClientRect();
    var tooltipHeight = tooltip.offsetHeight;
    var tooltipWidth = tooltip.offsetWidth;
    var top, left;

    // Highlight cutout
    var pad = 8;
    overlay.style.background = 'transparent';
    overlay.innerHTML = '<svg width="100%" height="100%" style="position:absolute;inset:0;">' +
      '<defs><mask id="ofl-tour-mask"><rect width="100%" height="100%" fill="white"/>' +
      '<rect x="' + (rect.left - pad) + '" y="' + (rect.top - pad) + '" ' +
      'width="' + (rect.width + pad * 2) + '" height="' + (rect.height + pad * 2) + '" ' +
      'rx="8" fill="black"/></mask></defs></svg>';

    // Position below target by default, above if not enough space
    if (rect.bottom + tooltipHeight + 20 < window.innerHeight) {
      top = rect.bottom + 12;
    } else {
      top = rect.top - tooltipHeight - 12;
    }

    left = Math.max(16, Math.min(rect.left, window.innerWidth - tooltipWidth - 16));
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';

    // Scroll target into view if needed
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function renderStep() {
    if (currentStep >= steps.length) { endTour(); return; }
    var step = steps[currentStep];
    var target = document.querySelector(step.selector);

    if (!target) {
      currentStep++;
      renderStep();
      return;
    }

    var stepNum = (currentStep + 1) + '/' + steps.length;
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<span style="font-size:11px;color:#94a3b8;font-weight:600;">' + stepNum + '</span>' +
      '<span style="font-size:11px;color:#94a3b8;cursor:pointer;" id="ofl-tour-skip">Skip tour</span></div>' +
      '<div style="font-size:15px;font-weight:700;margin-bottom:6px;color:#1e293b;">' + step.title + '</div>' +
      '<div style="font-size:13px;color:#64748b;line-height:1.5;margin-bottom:14px;">' + step.body + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">';

    if (currentStep > 0) {
      html += '<button id="ofl-tour-prev" style="padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;">Back</button>';
    }
    if (currentStep < steps.length - 1) {
      html += '<button id="ofl-tour-next" style="padding:7px 16px;border:none;border-radius:8px;background:#7c3aed;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Next</button>';
    } else {
      html += '<button id="ofl-tour-done" style="padding:7px 16px;border:none;border-radius:8px;background:#16a34a;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Got it!</button>';
    }
    html += '</div>';

    tooltip.innerHTML = html;
    positionTooltip(target);

    var skipBtn = document.getElementById('ofl-tour-skip');
    var prevBtn = document.getElementById('ofl-tour-prev');
    var nextBtn = document.getElementById('ofl-tour-next');
    var doneBtn = document.getElementById('ofl-tour-done');

    if (skipBtn) skipBtn.addEventListener('click', function () { endTour(); });
    if (prevBtn) prevBtn.addEventListener('click', function () { currentStep--; renderStep(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { currentStep++; renderStep(); });
    if (doneBtn) doneBtn.addEventListener('click', function () { endTour(); });
  }

  function endTour() {
    if (steps.length > 0 && steps._tourId) markDone(steps._tourId);
    clearPending();
    removeOverlay();
    steps = [];
    currentStep = 0;
  }

  function startTour(tourId, tourSteps) {
    if (isDone(tourId)) return false;
    steps = tourSteps;
    steps._tourId = tourId;
    currentStep = 0;
    createOverlay();
    renderStep();
    return true;
  }

  window.offlynTour = {
    start: startTour,
    end: endTour,
    isDone: isDone,
    isPending: isPending,
    clearPending: clearPending,
    markDone: markDone,
  };
})();
