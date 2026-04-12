import { useEffect } from 'react';

export default function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, padding: '10px 20px', borderRadius: 14,
      background: 'linear-gradient(135deg,var(--success),#1db954)', color: '#fff',
      fontWeight: 600, fontSize: '0.88rem',
      boxShadow: '0 4px 24px rgba(46,213,115,0.4),0 0 40px rgba(46,213,115,0.1)',
      animation: 'toastIn .3s cubic-bezier(0.16,1,0.3,1), toastOut .3s ease 2.1s forwards',
      backdropFilter: 'blur(8px)',
    }}>
      {message}
    </div>
  );
}
