/* ===========================================================
   EPUB READER — wraps epub.js
   =========================================================== */
const EpubReader = (() => {
  let book = null;
  let rendition = null;
  let currentRecord = null;
  let fontScale = 1;
  let lineSpacing = 1.4;
  let saveTimer = null;

  const viewerEl = document.getElementById('epub-viewer');

  const THEMES = {
    light: { bg: '#F1EADB', fg: '#242220' },
    sepia: { bg: '#F3E9D2', fg: '#3C2F1E' },
    dark:  { bg: '#1B1815', fg: '#EDE6D6' }
  };

  function registerThemes() {
    Object.entries(THEMES).forEach(([name, c]) => {
      rendition.themes.register(name, {
        body: {
          background: c.bg,
          color: c.fg,
          'line-height': String(lineSpacing)
        },
        'p, li, div': { color: c.fg + ' !important' }
      });
    });
  }

  async function open(record) {
    currentRecord = record;
    fontScale = record.settings?.fontScale || 1;
    lineSpacing = record.settings?.lineSpacing || 1.4;

    const buf = await record.fileBlob.arrayBuffer();
    book = ePub(buf);
    await book.ready;

    rendition = book.renderTo(viewerEl, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'auto',
      allowScriptedContent: false
    });

    registerThemes();
    rendition.themes.select(record.settings?.theme || 'light');
    rendition.themes.fontSize(`${Math.round(fontScale * 100)}%`);

    // restore position
    const startCfi = record.progress?.cfi;
    await rendition.display(startCfi || undefined);

    // generate / restore locations for percentage progress (cache on the record)
    if (record.locations) {
      book.locations.load(record.locations);
    } else {
      book.locations.generate(1024).then(() => {
        DB.update(record.id, { locations: book.locations.save() });
      });
    }

    rendition.on('relocated', (location) => {
      const percent = book.locations.length()
        ? book.locations.percentageFromCfi(location.start.cfi)
        : 0;
      updateProgressUI(percent);
      queueSave(location.start.cfi, percent);
    });

    // keyboard support (external keyboard / desktop testing)
    rendition.on('keyup', (e) => {
      if (e.key === 'ArrowRight') rendition.next();
      if (e.key === 'ArrowLeft') rendition.prev();
    });

    buildToc();
    applyThemeChrome(record.settings?.theme || 'light');
  }

  function queueSave(cfi, percent) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      DB.update(currentRecord.id, {
        progress: { cfi, percent },
        lastOpenedAt: Date.now()
      });
    }, 400);
  }

  function updateProgressUI(percent) {
    const slider = document.getElementById('progress-slider');
    const left = document.getElementById('progress-label-left');
    const right = document.getElementById('progress-label-right');
    slider.value = Math.round(percent * 1000);
    left.textContent = `${Math.round(percent * 100)}%`;
    right.textContent = book?.locations?.length() ? `${book.locations.length()} locs` : '';
  }

  function buildToc() {
    const listEl = document.getElementById('toc-list');
    book.loaded.navigation.then(nav => {
      listEl.innerHTML = nav.toc.map(item =>
        `<li><a href="#" data-href="${item.href}">${item.label.trim()}</a></li>`
      ).join('');
      listEl.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          rendition.display(a.dataset.href);
          App.closeDrawers();
        });
      });
    });
  }

  function next() { rendition?.next(); }
  function prev() { rendition?.prev(); }

  function seekToPercent(fraction) {
    if (!book?.locations?.length()) return;
    const cfi = book.locations.cfiFromPercentage(fraction);
    rendition.display(cfi);
  }

  function setFontScale(scale) {
    fontScale = Math.min(2, Math.max(0.6, scale));
    rendition.themes.fontSize(`${Math.round(fontScale * 100)}%`);
    DB.update(currentRecord.id, { settings: Object.assign({}, currentRecord.settings, { fontScale }) });
    return fontScale;
  }

  function setLineSpacing(val) {
    lineSpacing = Math.min(2.2, Math.max(1.1, val));
    registerThemes();
    rendition.themes.select(currentRecord.settings?.theme || 'light');
    DB.update(currentRecord.id, { settings: Object.assign({}, currentRecord.settings, { lineSpacing }) });
    return lineSpacing;
  }

  function setTheme(name) {
    rendition.themes.select(name);
    applyThemeChrome(name);
    DB.update(currentRecord.id, { settings: Object.assign({}, currentRecord.settings, { theme: name }) });
  }

  function applyThemeChrome(name) {
    const surface = document.getElementById('reader-surface');
    surface.classList.remove('theme-light', 'theme-sepia', 'theme-dark');
    surface.classList.add(`theme-${name}`);
  }

  function destroy() {
    clearTimeout(saveTimer);
    if (book) { book.destroy(); }
    book = null; rendition = null; currentRecord = null;
  }

  function getCurrentFontScale() { return fontScale; }
  function getCurrentLineSpacing() { return lineSpacing; }

  return { open, next, prev, seekToPercent, setFontScale, setLineSpacing, setTheme, destroy, getCurrentFontScale, getCurrentLineSpacing };
})();
