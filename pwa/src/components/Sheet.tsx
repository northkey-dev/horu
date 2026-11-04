import { useEffect, useRef, type ReactNode } from 'react';

// Bottom sheet that can be pulled down to dismiss (from the handle, or from the content when it is scrolled to the top).

const CLOSE_DISTANCE = 90;

export function Sheet({ onClose, className = '', children }: { onClose: () => void; className?: string; children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let dragging = false;

    const onStart = (e: TouchEvent) => {
      startY = lastY = e.touches[0].clientY;
      lastT = e.timeStamp;
      velocity = 0;
      dragging = false;
    };
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      const dy = y - startY;
      if (!dragging && dy > 8 && node.scrollTop <= 0) {
        dragging = true;
        node.style.transition = 'none';
        node.style.animation = 'none';
      }
      if (!dragging) return;
      e.preventDefault(); // otherwise iOS scrolls/bounces the page behind the sheet
      velocity = (y - lastY) / Math.max(1, e.timeStamp - lastT);
      lastY = y;
      lastT = e.timeStamp;
      node.style.transform = `translateY(${Math.max(0, dy)}px)`;
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      const dy = lastY - startY;
      node.style.transition = 'transform 0.18s ease-out';
      if (dy > CLOSE_DISTANCE || velocity > 0.6) {
        node.style.transform = 'translateY(110%)';
        setTimeout(() => close.current(), 160);
      } else {
        node.style.transform = '';
      }
    };

    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchmove', onMove, { passive: false });
    node.addEventListener('touchend', onEnd);
    node.addEventListener('touchcancel', onEnd);
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <div className={`sheet ${className}`.trim()} role="dialog" ref={el}>
      <div className="grabber" />
      {children}
    </div>
  );
}
