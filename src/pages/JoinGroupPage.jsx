import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { sb } from '../lib/supabase.js';

/* ═══════════════════════════════════════════════
   JOIN GROUP PAGE — /join/:token
   Logged-in users redeem immediately. Logged-out users are sent
   into /studio's signup flow with the token stashed in
   sessionStorage; App.jsx redeems it once SIGNED_IN fires (see
   the pending-invite effect near its auth-state listener).
   ═══════════════════════════════════════════════ */
export default function JoinGroupPage() {
  const { token } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) { navigate('/'); return; }
    sb.auth.getSession().then(({ data }) => {
      if (data?.session?.user) {
        sessionStorage.setItem('sos_pending_invite_token', token);
        navigate('/studio');
      } else {
        sessionStorage.setItem('sos_pending_invite_token', token);
        navigate('/studio?auth=signup');
      }
    });
  }, [token, navigate]);

  return (
    <div style={{ height: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)', fontFamily: 'var(--font-ui)' }}>
      Joining group…
    </div>
  );
}
