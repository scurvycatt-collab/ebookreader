/* ===========================================================
   LIBRARY — import handling, metadata/cover extraction, grid render
   =========================================================== */
const Library = (() => {
  const gridEl = document.getElementById('library-grid');
  const emptyEl = document.getElementById('library-empty');
  const progressWrap = document.getElementById('import-progress');
  const progressFill = document.getElementById('import-progress-fill');
  const progressLabel = document.getElementById('import-progress-label');
  const errorBanner = document.getElementById('import-error-banner');

  function fmtFromName(name) {
    const ext = name.toLowerCase().split('.').pop();
    if (ext === 'epub') return 'epub';
    if (ext === 'pdf') return 'pdf';
    return null;
  }

  async function extractEpubMeta(file, log) {
    const buf = await file.arrayBuffer();
    const book = ePub(buf.slice(0)); // slice so the buffer isn't neutered for later use
    try {
      await book.ready;
    } catch (e) {
      log(`Couldn't open "${file.name}": ${e?.message || e}`);
      throw e;
    }
    let meta = {};
    try {
      meta = await book.loaded.metadata;
    } catch (e) {
      log(`Note: couldn't read metadata for "${file.name}" (using filename instead): ${e?.message || e}`);
    }
    let coverBlob = null;
    try {
      const coverUrl = await book.coverUrl();
      if (coverUrl) {
        const resp = await fetch(coverUrl);
        coverBlob = await resp.blob();
      }
    } catch (e) {
      log(`Note: couldn't extract a cover for "${file.name}" (will show a placeholder instead): ${e?.message || e}`);
    }
    try { book.destroy(); } catch (e) {}
    return {
      title: meta.title || file.name.replace(/\.epub$/i, ''),
      author: meta.creator || '',
      coverBlob
    };
  }

  async function extractPdfMeta(file, log) {
    const buf = await file.arrayBuffer();
    // loading the document itself is the only step allowed to be fatal —
    // everything after this degrades gracefully instead of aborting the import
    let pdf;
    try {
      const loadingTask = pdfjsLib.getDocument({ data: buf.slice(0) });
      pdf = await loadingTask.promise;
    } catch (e) {
      log(`Couldn't open "${file.name}": ${e?.message || e}`);
      throw e;
    }

    let title = file.name.replace(/\.pdf$/i, '');
    let author = '';
    try {
      const info = await pdf.getMetadata();
      if (info?.info?.Title) title = info.info.Title;
      if (info?.info?.Author) author = info.info.Author;
    } catch (e) {
      log(`Note: couldn't read metadata for "${file.name}" (using filename instead): ${e?.message || e}`);
    }

    // render first page to a small canvas for the cover thumbnail — optional, never fatal
    let coverBlob = null;
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const targetW = 300;
      const scale = targetW / viewport.width;
      const scaledViewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(scaledViewport.width));
      canvas.height = Math.max(1, Math.round(scaledViewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
      coverBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    } catch (e) {
      log(`Note: couldn't generate a cover thumbnail for "${file.name}" (will show a placeholder instead): ${e?.message || e}`);
    }

    const totalPages = pdf.numPages;
    try { await pdf.destroy(); } catch (e) {}
    return { title, author, coverBlob, totalPages };
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList).filter(f => fmtFromName(f.name));
    if (!files.length) return;
    progressWrap.classList.remove('hidden');
    errorBanner.classList.add('hidden');
    errorBanner.innerHTML = '';
    const notes = [];
    const log = (msg) => { notes.push(msg); console.warn(msg); };
    let addedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      progressLabel.textContent = `Adding “${file.name}” (${i + 1}/${files.length})…`;
      progressFill.style.width = `${Math.round((i / files.length) * 100)}%`;
      try {
        const format = fmtFromName(file.name);
        let meta, totalPages = null;
        if (format === 'epub') {
          meta = await extractEpubMeta(file, log);
        } else {
          meta = await extractPdfMeta(file, log);
          totalPages = meta.totalPages;
        }
        const record = {
          id: DB.uuid(),
          title: meta.title,
          author: meta.author,
          format,
          fileBlob: file,
          coverBlob: meta.coverBlob || null,
          addedAt: Date.now(),
          lastOpenedAt: null,
          progress: format === 'pdf'
            ? { page: 1, totalPages: totalPages || 1 }
            : { cfi: null, percent: 0 },
          locations: null,
          settings: { fit: 'width', spread: 'single', direction: 'ltr', theme: 'light', fontScale: 1, lineSpacing: 1.4 }
        };
        await DB.add(record);
        addedCount++;
      } catch (err) {
        log(`Skipped "${file.name}" — ${err?.name || 'Error'}: ${err?.message || err}`);
      }
    }
    progressFill.style.width = '100%';
    setTimeout(() => progressWrap.classList.add('hidden'), 400);

    if (notes.length) {
      errorBanner.innerHTML =
        `<strong>${addedCount}/${files.length} book(s) added.</strong>` +
        `<ul>${notes.map(n => `<li>${n.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</li>`).join('')}</ul>` +
        `<button id="import-error-dismiss">Dismiss</button>`;
      errorBanner.classList.remove('hidden');
      document.getElementById('import-error-dismiss').addEventListener('click', () => errorBanner.classList.add('hidden'));
    }
    await render();
  }

  function progressPercent(book) {
    if (book.format === 'pdf') {
      const p = book.progress || {};
      return p.totalPages ? Math.round(((p.page || 1) / p.totalPages) * 100) : 0;
    }
    return Math.round((book.progress?.percent || 0) * 100);
  }

  function cardHtml(book) {
    const pct = progressPercent(book);
    const coverInner = book.coverBlob
      ? `<img src="${URL.createObjectURL(book.coverBlob)}" alt="">`
      : `<div class="book-card__cover--placeholder">${escapeHtml(book.title)}</div>`;
    return `
      <div class="book-card" data-id="${book.id}">
        <div class="book-card__cover">
          ${coverInner}
          <span class="book-card__badge">${book.format.toUpperCase()}</span>
          <div class="book-card__progress"><div class="book-card__progress-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="book-card__title">${escapeHtml(book.title)}</div>
        ${book.author ? `<div class="book-card__author">${escapeHtml(book.author)}</div>` : ''}
      </div>`;
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function render() {
    const books = await DB.getAll();
    if (!books.length) {
      emptyEl.classList.remove('hidden');
      gridEl.innerHTML = '';
      return;
    }
    emptyEl.classList.add('hidden');
    gridEl.innerHTML = books.map(cardHtml).join('');
  }

  return { importFiles, render };
})();
