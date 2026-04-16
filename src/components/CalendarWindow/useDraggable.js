import { useEffect, useRef, useCallback } from 'react';

const STORAGE_KEY = 'sos_cal_pos';
const SNAP_THRESHOLD = 32; // px from edge to trigger snap

/**
 * useDraggable — attaches drag-to-move + edge-snap behaviour to a header element.
 *
 * @param {React.RefObject} headerRef  — ref for the drag handle element
 * @param {React.RefObject} containerRef — ref for the element being moved
 * @param {string} size  — current CalendarWindow size ('fullscreen' disables drag)
 */
export function useDraggable(headerRef, containerRef, size) {
  const offsetRef = useRef({ x: 0, y: 0 });
  const posRef    = useRef({ x: 0, y: 0 });
  const dragging  = useRef(false);

  // Restore last saved position on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        posRef.current = saved;
        applyTransform(containerRef.current, saved.x, saved.y);
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset transform when switching to fullscreen
  useEffect(() => {
    if (size === 'fullscreen' && containerRef.current) {
      containerRef.current.style.transform = '';
    }
  }, [size, containerRef]);

  const handleMouseDown = useCallback((e) => {
    if (size === 'fullscreen') return;
    if (!containerRef.current) return;

    dragging.current = true;
    const rect = containerRef.current.getBoundingClientRect();
    offsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    headerRef.current.style.cursor = 'grabbing';
    e.preventDefault();
  }, [size, containerRef, headerRef]);

  const handleMouseMove = useCallback((e) => {
    if (!dragging.current || !containerRef.current) return;
    const x = e.clientX - offsetRef.current.x;
    const y = e.clientY - offsetRef.current.y;
    posRef.current = { x, y };
    applyTransform(containerRef.current, x, y);
  }, [containerRef]);

  const handleMouseUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    if (headerRef.current) headerRef.current.style.cursor = 'grab';

    // Edge snap
    if (containerRef.current) {
      const el = containerRef.current;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let { x, y } = posRef.current;
      let snapped = false;

      if (rect.left < SNAP_THRESHOLD)          { x = 0; snapped = true; }
      else if (rect.right > vw - SNAP_THRESHOLD) { x = vw - rect.width; snapped = true; }
      if (rect.top < SNAP_THRESHOLD)             { y = 0; snapped = true; }
      else if (rect.bottom > vh - SNAP_THRESHOLD) { y = vh - rect.height; snapped = true; }

      if (snapped) {
        el.style.transition = 'transform 0.2s ease-out';
        applyTransform(el, x, y);
        posRef.current = { x, y };
        setTimeout(() => { if (el) el.style.transition = ''; }, 220);
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(posRef.current));
    }
  }, [containerRef, headerRef]);

  // Attach / detach event listeners
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    header.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup',   handleMouseUp);

    return () => {
      header.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup',   handleMouseUp);
    };
  }, [headerRef, handleMouseDown, handleMouseMove, handleMouseUp]);
}

function applyTransform(el, x, y) {
  if (el) el.style.transform = `translate(${x}px, ${y}px)`;
}
