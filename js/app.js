/* ===========================================================
   APP — view routing, chrome behavior, gesture handling
   =========================================================== */
const App = (() => {
  const viewLibrary = document.getElementById('view-library');
  const viewReader = document.getElementById('view-reader');
  const readerSurface = document.getElementById('reader-surface');
  const topbar = document.getElementById('reader-topbar');
  const bottombar = document.getElementById('reader-bottombar');
  const tocDrawer = document.getElementById('toc-drawer');
  const settingsDrawer = document.getElementById('settings-drawer');
  const scrim = document.getElementById('drawer-scrim');
  const readerTitle = document.getElementById('reader-title');

  let currentRecord = null;
  let currentFormat = null;
  let chromeVisible = true;

  // ---------- library wiring ----------
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', async (e) => {
    await Library.importFiles(e.target.files);
    e.target.value = '';
  });

  document.getElementById('library-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.book-card');
    if (!card) return;
    openBook(card.dataset.id);
  });

  // long-press to remove a book
  let pressTimer = null;
  document.getElementById('library-grid').addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.book-card');
    if (!card) return;
    pressTimer = setTimeout(() => showCardMenu(card, e.clientX, e.clientY), 500);
  });
  ['pointerup', 'pointerleave', 'pointermove'].forEach(evt =>
    document.getElementById('library-grid').addEventListener(evt, () => clearTimeout(pressTimer))
  );

  function showCardMenu(card, x, y) {
    const menu = document.getElementById('card-menu');
    menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 60)}px`;
    menu.classList.remove('hidden');
    menu.dataset.id = card.dataset.id;
  }
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('card-menu');
    if (!menu.contains(e.target)) menu.classList.add('hidden');
  });
  document.getElementById('card-menu-delete').addEventListener('click', async () => {
    const menu = document.getElementById('card-menu');
    const id = menu.dataset.id;
    if (id) { await DB.delete(id); await Library.render(); }
    menu.classList.add('hidden');
  });

  // ---------- opening a book ----------
  async function openBook(id) {
    const record = await DB.get(id);
    if (!record) return;
    currentRecord = record;
    currentFormat = record.format;

    viewLibrary.classList.remove('view--active');
    viewReader.classList.add('view--active');
    readerTitle.textContent = record.title;

    document.getElementById('epub-viewer').classList.remove('active');
    document.getElementById('pdf-viewer').classList.remove('active');
    document.getElementById('settings-epub-only').classList.toggle('hidden', record.format !== 'epub');
    document.getElementById('settings-pdf-only').classList.toggle('hidden', record.format !== 'pdf');

    if (record.format === 'epub') {
      document.getElementById('epub-viewer').classList.add('active');
      await EpubReader.open(record);
      syncEpubSettingsUI();
    } else {
      document.getElementById('pdf-viewer').classList.add('active');
      await PdfReader.open(record);
      syncPdfSettingsUI();
    }
    syncThemeUI(record.settings?.theme || 'light');
    showChrome();
  }

  document.getElementById('btn-back').addEventListener('click', async () => {
    if (currentFormat === 'epub') EpubReader.destroy();
    if (currentFormat === 'pdf') PdfReader.destroy();
    viewReader.classList.remove('view--active');
    viewLibrary.classList.add('view--active');
    closeDrawers();
    await Library.render();
  });

  // ---------- chrome show/hide ----------
  function showChrome() {
    chromeVisible = true;
    topbar.classList.remove('hide');
    bottombar.classList.remove('hide');
  }
  function hideChrome() {
    chromeVisible = false;
    topbar.classList.add('hide');
    bottombar.classList.add('hide');
  }
  function toggleChrome() { chromeVisible ? hideChrome() : showChrome(); }

  // ---------- tap zones ----------
  document.getElementById('tap-toggle').addEventListener('click', toggleChrome);
  document.getElementById('tap-prev').addEventListener('click', () => {
    if (currentFormat === 'epub') EpubReader.prev();
    else PdfReader.goPhysicalLeft();
  });
  document.getElementById('tap-next').addEventListener('click', () => {
    if (currentFormat === 'epub') EpubReader.next();
    else PdfReader.goPhysicalRight();
  });

  // swipe support (touch) on the reader surface, in addition to tap zones
  let touchStartX = null, touchStartY = null, touchStartT = 0;
  readerSurface.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartT = Date.now();
  }, { passive: true });
  readerSurface.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const dt = Date.now() - touchStartT;
    touchStartX = null;
    if (dt > 600 || Math.abs(dx) < 60 || Math.abs(dy) > 80) return; // not a horizontal swipe
    if (dx < 0) {
      // swiped left -> physically moving content left -> "next" in LTR
      if (currentFormat === 'epub') EpubReader.next(); else PdfReader.goPhysicalLeft();
    } else {
      if (currentFormat === 'epub') EpubReader.prev(); else PdfReader.goPhysicalRight();
    }
  }, { passive: true });

  // ---------- progress slider ----------
  const slider = document.getElementById('progress-slider');
  slider.addEventListener('input', () => {
    if (currentFormat === 'epub') {
      EpubReader.seekToPercent(Number(slider.value) / 1000);
    } else {
      PdfReader.seekToPage(Number(slider.value));
    }
  });

  // ---------- drawers ----------
  document.getElementById('btn-toc').addEventListener('click', () => openDrawer(tocDrawer));
  document.getElementById('btn-toc-close').addEventListener('click', closeDrawers);
  document.getElementById('btn-settings').addEventListener('click', () => openDrawer(settingsDrawer));
  document.getElementById('btn-settings-close').addEventListener('click', closeDrawers);
  scrim.addEventListener('click', closeDrawers);

  function openDrawer(drawerEl) {
    closeDrawers();
    drawerEl.classList.add('open');
    scrim.classList.add('show');
  }
  function closeDrawers() {
    tocDrawer.classList.remove('open');
    settingsDrawer.classList.remove('open');
    scrim.classList.remove('show');
  }

  // ---------- settings: font size / line spacing (epub) ----------
  document.getElementById('font-dec').addEventListener('click', () => {
    const s = EpubReader.setFontScale(EpubReader.getCurrentFontScale() - 0.1);
    document.getElementById('font-size-label').textContent = `${Math.round(s * 100)}%`;
  });
  document.getElementById('font-inc').addEventListener('click', () => {
    const s = EpubReader.setFontScale(EpubReader.getCurrentFontScale() + 0.1);
    document.getElementById('font-size-label').textContent = `${Math.round(s * 100)}%`;
  });
  document.getElementById('line-dec').addEventListener('click', () => {
    const s = EpubReader.setLineSpacing(EpubReader.getCurrentLineSpacing() - 0.1);
    document.getElementById('line-spacing-label').textContent = s.toFixed(1);
  });
  document.getElementById('line-inc').addEventListener('click', () => {
    const s = EpubReader.setLineSpacing(EpubReader.getCurrentLineSpacing() + 0.1);
    document.getElementById('line-spacing-label').textContent = s.toFixed(1);
  });
  function syncEpubSettingsUI() {
    document.getElementById('font-size-label').textContent = `${Math.round(EpubReader.getCurrentFontScale() * 100)}%`;
    document.getElementById('line-spacing-label').textContent = EpubReader.getCurrentLineSpacing().toFixed(1);
  }

  // ---------- settings: theme (both formats) ----------
  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      if (currentFormat === 'epub') {
        EpubReader.setTheme(theme);
      } else {
        readerSurface.classList.remove('theme-light', 'theme-sepia', 'theme-dark');
        readerSurface.classList.add(`theme-${theme}`);
        PdfReader.setInvert(theme === 'dark');
        DB.update(currentRecord.id, { settings: Object.assign({}, currentRecord.settings, { theme }) });
      }
      syncThemeUI(theme);
    });
  });
  function syncThemeUI(theme) {
    document.querySelectorAll('.theme-swatch').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  }

  // ---------- settings: pdf fit / spread / direction ----------
  document.querySelectorAll('#fit-mode-group .segmented__btn').forEach(btn => {
    btn.addEventListener('click', () => { PdfReader.setFit(btn.dataset.fit); syncPdfSettingsUI(); });
  });
  document.querySelectorAll('#spread-mode-group .segmented__btn').forEach(btn => {
    btn.addEventListener('click', () => { PdfReader.setSpread(btn.dataset.spread); syncPdfSettingsUI(); });
  });
  document.querySelectorAll('#direction-group .segmented__btn').forEach(btn => {
    btn.addEventListener('click', () => { PdfReader.setDirection(btn.dataset.dir); syncPdfSettingsUI(); });
  });
  function syncPdfSettingsUI() {
    const s = PdfReader.getSettings();
    document.querySelectorAll('#fit-mode-group .segmented__btn').forEach(b => b.classList.toggle('active', b.dataset.fit === s.fit));
    document.querySelectorAll('#spread-mode-group .segmented__btn').forEach(b => b.classList.toggle('active', b.dataset.spread === s.spread));
    document.querySelectorAll('#direction-group .segmented__btn').forEach(b => b.classList.toggle('active', b.dataset.dir === s.direction));
  }

  // re-render pdf pages on rotation/resize
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (currentFormat !== 'pdf') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => PdfReader.renderCurrent(), 200);
  });

  // ---------- init ----------
  Library.render();

  return { closeDrawers };
})();

// register service worker for offline installability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
