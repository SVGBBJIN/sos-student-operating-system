import React, { useEffect, useState, useCallback } from 'react';
import { sb } from '../lib/supabase.js';
import Icon from '../lib/icons';

/* ═══════════════════════════════════════════════
   INVITE LINK MODAL — generate/copy/revoke invite links
   for a study group. Links are multi-use by design (a group
   invite, not a one-shot); revoke deletes the row outright.
   ═══════════════════════════════════════════════ */
export default function InviteLinkModal({ group, user, onClose }) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sb.from('group_invites')
      .select('id, token, expires_at, created_at')
      .eq('group_id', group.id)
      .order('created_at', { ascending: false });
    if (error) setErr(error.message);
    setInvites(data || []);
    setLoading(false);
  }, [group.id]);

  useEffect(() => { load(); }, [load]);

  async function createInvite() {
    setErr(null);
    const { error } = await sb.from('group_invites').insert({ group_id: group.id, created_by: user.id });
    if (error) { setErr(error.message); return; }
    await load();
  }

  async function revoke(id) {
    setErr(null);
    const { error } = await sb.from('group_invites').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    await load();
  }

  function linkFor(token) { return `${window.location.origin}/join/${token}`; }

  async function copy(invite) {
    try {
      await navigator.clipboard.writeText(linkFor(invite.token));
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (_) { /* clipboard unavailable — link is still visible to select/copy manually */ }
  }

  return (
    <>
      <div className="g-overlay" onClick={onClose} />
      <div className="g-modal" onClick={e => e.stopPropagation()}>
        <div className="g-modal-hdr">
          <div className="g-modal-title"><span style={{ display: 'flex', color: 'var(--accent)' }}>{Icon.link(18)}</span> Invite to {group.name}</div>
          <button className="g-modal-close" onClick={onClose}>{Icon.x(16)}</button>
        </div>

        {err && <div className="g-err" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{Icon.alertTriangle ? Icon.alertTriangle(14) : '⚠'} {err}</div>}

        <div className="g-section">
          <p className="g-note">Anyone with this link can join {group.name}. Links expire after 14 days and can be revoked any time.</p>
          <button className="g-btn" onClick={createInvite}>
            <span style={{ display: 'flex' }}>{Icon.plus(16)}</span> Generate new link
          </button>

          {loading ? (
            <div className="g-status">Loading…</div>
          ) : invites.length === 0 ? (
            <div className="g-status">No active invite links yet.</div>
          ) : (
            invites.map(inv => {
              const expired = new Date(inv.expires_at).getTime() < Date.now();
              return (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <input readOnly value={linkFor(inv.token)}
                    style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: expired ? 'var(--text-dim)' : 'var(--text)', fontSize: '0.78rem', textDecoration: expired ? 'line-through' : 'none' }} />
                  <button onClick={() => copy(inv)} disabled={expired}
                    style={{ background: 'transparent', border: '1px solid var(--border)', color: copiedId === inv.id ? 'var(--success)' : 'var(--text)', borderRadius: 8, padding: '5px 10px', fontSize: '0.76rem', fontWeight: 600, cursor: expired ? 'not-allowed' : 'pointer' }}>
                    {copiedId === inv.id ? 'Copied' : 'Copy'}
                  </button>
                  <button onClick={() => revoke(inv.id)}
                    style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 8, padding: '5px 10px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer' }}>
                    Revoke
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
