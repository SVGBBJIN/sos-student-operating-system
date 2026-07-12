import React, { useEffect, useState, useCallback } from 'react';
import { sb } from '../lib/supabase.js';
import Icon from '../lib/icons';
import GroupDetail from './GroupDetail.jsx';

/* ═══════════════════════════════════════════════
   GROUPS PANEL — study groups list + create, master-detail
   with GroupDetail. Self-contained: manages its own fetch of
   the user's groups, independent of ProjectsPage's subject list.
   ═══════════════════════════════════════════════ */
export default function GroupsPanel({ user }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await sb
      .from('group_members')
      .select('role, group_id, study_groups(id, name, subject, owner_id, created_at)')
      .eq('user_id', user.id);
    if (error) { setErr(error.message); setLoading(false); return; }
    const rows = (data || [])
      .filter(r => r.study_groups)
      .map(r => ({ ...r.study_groups, role: r.role }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    setGroups(rows);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function createGroup() {
    const name = newName.trim();
    if (!name || !user) return;
    setErr(null);
    const { data, error } = await sb.from('study_groups')
      .insert({ owner_id: user.id, name, subject: newSubject.trim() || null })
      .select('id').single();
    if (error) { setErr(error.message); return; }
    const { error: memberErr } = await sb.from('group_members')
      .insert({ group_id: data.id, user_id: user.id, role: 'owner' });
    if (memberErr) { setErr(memberErr.message); return; }
    setNewName(''); setNewSubject(''); setCreating(false);
    await load();
    setSelectedId(data.id);
  }

  const selected = groups.find(g => g.id === selectedId);

  if (selected) {
    return <GroupDetail user={user} group={selected} onBack={() => { setSelectedId(null); load(); }} />;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--background)', overflowY: 'auto', padding: '14px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--foreground)', fontFamily: 'var(--font-heading)', flex: 1 }}>Study Groups</span>
        <button
          onClick={() => setCreating(c => !c)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 'var(--radius)', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, padding: '6px 14px', cursor: 'pointer' }}
        >
          {Icon.plus(14)} New group
        </button>
      </div>

      {err && <div style={{ color: 'var(--error,hsl(0,72%,51%))', fontSize: 13, marginBottom: 10 }}>{err}</div>}

      {creating && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            type="text" value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Group name (e.g. AP Bio Study Group)"
            style={{ flex: '1 1 240px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--foreground)', fontSize: 13 }}
          />
          <input
            type="text" value={newSubject} onChange={e => setNewSubject(e.target.value)}
            placeholder="Subject (optional)"
            style={{ flex: '0 1 160px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--foreground)', fontSize: 13 }}
          />
          <button onClick={createGroup} disabled={!newName.trim()}
            style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, padding: '8px 16px', cursor: newName.trim() ? 'pointer' : 'not-allowed', opacity: newName.trim() ? 1 : 0.6 }}>
            Create
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 14 }}>
          No study groups yet. Create one, or ask a friend for an invite link.
        </div>
      ) : (
        groups.map(g => (
          <div
            key={g.id}
            onClick={() => setSelectedId(g.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 'var(--radius)', marginBottom: 6, cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)' }}>{g.name}</div>
              {g.subject && <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{g.subject}</div>}
            </div>
            {g.role === 'owner' && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Owner</span>}
          </div>
        ))
      )}
    </div>
  );
}
