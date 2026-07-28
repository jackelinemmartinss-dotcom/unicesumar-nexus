/* ==========================================================================
   NEXUS DRAG & DROP - native HTML5 DnD helper for Kanban boards
   Cards need draggable="true" + data-drag-id="<id>"
   Columns need data-drop-zone="<key>"
   ========================================================================== */
window.NexusDragDrop = (function () {
  'use strict';

  function init(boardEl, onDrop) {
    if (!boardEl || boardEl.__nexusDndBound) return;
    boardEl.__nexusDndBound = true;

    boardEl.addEventListener('dragstart', (e) => {
      const card = e.target.closest('[data-drag-id]');
      if (!card) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.getAttribute('data-drag-id'));
      requestAnimationFrame(() => card.classList.add('dragging'));
    });

    boardEl.addEventListener('dragend', (e) => {
      const card = e.target.closest('[data-drag-id]');
      if (card) card.classList.remove('dragging');
      boardEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    boardEl.addEventListener('dragover', (e) => {
      const zone = e.target.closest('[data-drop-zone]');
      if (!zone) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });

    boardEl.addEventListener('dragleave', (e) => {
      const zone = e.target.closest('[data-drop-zone]');
      if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });

    boardEl.addEventListener('drop', (e) => {
      const zone = e.target.closest('[data-drop-zone]');
      if (!zone) return;
      e.preventDefault();
      zone.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const toZone = zone.getAttribute('data-drop-zone');
      if (id && toZone) onDrop(id, toZone);
    });
  }

  return { init };
})();
