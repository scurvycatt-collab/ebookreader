/* ===========================================================
   PDF / MANGA READER — wraps pdf.js
   Supports: fit-width / fit-page, single / two-page spread,
   LTR / RTL (manga) reading direction, dark invert.
   =========================================================== */
const PdfReader = (() => {
  let pdf = null;
  let currentRecord = null;
  let currentPage = 1;
  let totalPages = 1;
  let settings = { fit: 'width', spread: 'single', direction: 'ltr' };
  let saveTimer = null;
  let renderToken = 0;

  const viewerEl = document.getElementById('pdf-viewer');
  const wrapEl = document.getElementById('pdf-page-wrap');
  const canvasA = document.getElementById('pdf-canvas-a');
  const canvasB = document.getElementById('pdf-canvas-b');

  async function open(record) {
    currentRecord = record;
    settings = Object.assign({ fit: 'width', spread: 'single', direction: 'ltr' }, record.settings);
    const buf = await record.fileBlob.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: buf });
    pdf = await loadingTask.promise;
    totalPages = pdf.numPages;
    currentPage = Math.min(Math.max(record.progress?.page || 1, 1), totalPages);
    viewerEl.classList.toggle('invert', settings.theme === 'dark');
    await renderCurrent();
  }

  function pageNumbersForSpread() {
    if (settings.spread === 'single') return [currentPage];
    // pair current page with the next; keep pairing stable on odd/even doesn't matter for manga scans
    const partner = currentPage + 1 <= totalPages ? currentPage + 1 : null;
    return partner ? [currentPage, partner] : [currentPage];
  }

  async function renderPageToCanvas(pageNum, canvas) {
    const page = await pdf.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });

    let scale;
    if (settings.fit === 'page') {
      const availH = viewerEl.clientHeight;
      const availW = viewerEl.clientWidth / (settings.spread === 'double' ? 2 : 1);
      scale = Math.min(availW / baseViewport.width, availH / baseViewport.height);
    } else {
      const availW = viewerEl.clientWidth / (settings.spread === 'double' ? 2 : 1);
      scale = availW / baseViewport.width;
    }
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * dpr });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
  }

  async function renderCurrent() {
    const myToken = ++renderToken;
    const pages = pageNumbersForSpread();
    const [pLeft, pRight] = orderForDirection(pages);

    await renderPageToCanvas(pLeft, canvasA);
    if (myToken !== renderToken) return;
    canvasA.classList.remove('hidden');

    if (pRight) {
      await renderPageToCanvas(pRight, canvasB);
      if (myToken !== renderToken) return;
      canvasB.classList.remove('hidden');
    } else {
      canvasB.classList.add('hidden');
    }

    updateProgressUI();
    queueSave();
  }

  // decides visual left/right canvas assignment based on direction
  function orderForDirection(pages) {
    if (pages.length === 1) return [pages[0], null];
    const [a, b] = pages; // a = currentPage (lower), b = currentPage+1
    return settings.direction === 'rtl' ? [b, a] : [a, b];
  }

  function updateProgressUI() {
    const slider = document.getElementById('progress-slider');
    const left = document.getElementById('progress-label-left');
    const right = document.getElementById('progress-label-right');
    slider.max = totalPages;
    slider.value = currentPage;
    left.textContent = String(currentPage);
    right.textContent = `of ${totalPages}`;
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      DB.update(currentRecord.id, {
        progress: { page: currentPage, totalPages },
        lastOpenedAt: Date.now()
      });
    }, 400);
  }

  function pageStep() { return settings.spread === 'double' ? 2 : 1; }

  // "advance" = move forward in reading order (higher page number)
  function advance() {
    if (currentPage + pageStep() > totalPages && currentPage >= totalPages) return;
    currentPage = Math.min(currentPage + pageStep(), totalPages);
    renderCurrent();
  }
  // "retreat" = move backward in reading order (lower page number)
  function retreat() {
    currentPage = Math.max(currentPage - pageStep(), 1);
    renderCurrent();
  }

  // physical taps map to logical advance/retreat depending on direction
  function goPhysicalRight() { settings.direction === 'rtl' ? retreat() : advance(); }
  function goPhysicalLeft() { settings.direction === 'rtl' ? advance() : retreat(); }

  function seekToPage(n) {
    currentPage = Math.min(Math.max(Math.round(n), 1), totalPages);
    renderCurrent();
  }

  function setFit(fit) {
    settings.fit = fit;
    DB.update(currentRecord.id, { settings: Object.assign({}, currentRecord.settings, { fit }) });
    renderCurrent();
  }
  function setSpread(spread) {
    settings.spread = spread;
    DB.update(currentRecord.id, { settings: Object.assign({}, currentRecord.settings, { spread }) });
    renderCurrent();
  }
  function setDirection(direction) {
    settings.direction = direction;
    DB.update(currentRecord.id, { settings: Object.assign({}, currentRecord.settings, { direction }) });
    renderCurrent();
  }
  function setInvert(on) {
    viewerEl.classList.toggle('invert', on);
  }

  function destroy() {
    clearTimeout(saveTimer);
    if (pdf) pdf.destroy();
    pdf = null; currentRecord = null;
  }

  function getSettings() { return Object.assign({}, settings); }

  return {
    open, advance, retreat, goPhysicalRight, goPhysicalLeft,
    seekToPage, setFit, setSpread, setDirection, setInvert,
    destroy, getSettings, renderCurrent
  };
})();
