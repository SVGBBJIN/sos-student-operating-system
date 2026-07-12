import React, { useEffect, useState, useCallback } from 'react';
import { sb } from '../lib/supabase.js';
import Icon from '../lib/icons';
import InviteLinkModal from './InviteLinkModal.jsx';
import { groupSharedItemsByDeadline } from '../lib/peerComparison.js';

/* ═══════════════════════════════════════════════
   GROUP DETAIL — members, shared deadlines with peer-comparison
   badges, and a picker to opt a task/event into the group.
   ═══════════════════════════════════════════════ */
export default function GroupDetail({ user, group, onBack }) {
  const [members, setMembers] = useState([]);
  const [sharedItems, setSharedItems] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [myEvents, setMyEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, s, t, e] = await Promise.all([
      sb.from('group_members').select('user_id, role, joined_at').eq('group_id', group.id),
      sb.from('group_shared_items').select('*').eq('group_id', group.id).order('due_date', { ascending: true }),
      sb.from('tasks').select('id, title, due_date, subject, status').eq('user_id', user.id).neq('status', 'done'),
      sb.from('events').select('id, title, event_date, date, subject, status').eq('user_id', user.id).neq('status', 'cancelled'),
    ]);
    if (m.error) setErr(m.error.message);
    setMembers(m.data || []);
    setSharedItems(s.data || []);
    setMyTasks(t.data || []);
    setMyEvents(e.data || []);
    setLoading(false);
  }, [group.id, user.id]);

  useEffect(() => { load(); }, [load]);

  const myShared = new Set(sharedItems.filter(i => i.user_id === user.id).map(i => `${i.item_type}:${i.item_id}`));

  async function shareItem(item, itemType) {
    setErr(null);
    const dueDate = itemType === 'task' ? item.due_date : (item.event_date || item.date || null);
    const { error } = await sb.from('group_shared_items').insert({
      group_id: group.id, user_id: user.id, item_type: itemType, item_id: String(item.id),
      title: item.title, due_date: dueDate, subject: item.subject || null,
    });
    if (error) { setErr(error.message); return; }
    await load();
  }

  async function unshareItem(item) {
    setErr(null);
    const { error } = await sb.from('group_shared_items').delete().eq('id', item.id).eq('user_id', user.id);
    if (error) { setErr(error.message); return; }
    await load();
  }

  const deadlineBuckets = groupSharedItemsByDeadline(sharedItems);
  const seenKeys = new Set();
  const deadlineRows = [];
  for (const item of sharedItems) {
    const key = [item.item_type, (item.title || '').trim().toLowerCase(), item.due_date || ''].join('|');
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const bucket = deadlineBuckets.get(key);
    deadlineRows.push({ ...item, peerCount: bucket.userIds.size, mine: bucket.userIds.has(user.id) });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--background)', overflowY: 'auto' }}>
      <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', display: 'flex' }}>{Icon.arrowLeft ? Icon.arrowLeft(16) : '←'}</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--foreground)', fontFamily: 'var(--font-heading)' }}>{group.name}</div>
          {group.subject && <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{group.subject}</div>}
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{members.length} member{members.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowInvite(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--foreground)', borderRadius: 8, fontSize: 13, fontWeight: 600, padding: '6px 12px', cursor: 'pointer' }}>
          {Icon.link(14)} Invite
        </button>
        <button onClick={() => setSharePickerOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, padding: '6px 12px', cursor: 'pointer' }}>
          {Icon.plus(14)} Share a deadline
        </button>
      </div>

      {err && <div style={{ color: 'var(--error,hsl(0,72%,51%))', fontSize: 13, padding: '10px 24px 0' }}>{err}</div>}

      {sharePickerOpen && (
        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Your tasks</div>
          {myTasks.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 8 }}>No open tasks.</div>}
          {myTasks.map(t => {
            const shared = myShared.has(`task:${t.id}`);
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--foreground)' }}>{t.title} {t.due_date && <span style={{ color: 'var(--muted-foreground)' }}>· {t.due_date}</span>}</span>
                <button onClick={() => shared ? unshareItem(sharedItems.find(i => i.item_type === 'task' && i.item_id === String(t.id) && i.user_id === user.id)) : shareItem(t, 'task')}
                  style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, border: `1px solid ${shared ? 'var(--primary)' : 'var(--border)'}`, background: shared ? 'var(--muted)' : 'transparent', color: shared ? 'var(--primary)' : 'var(--muted-foreground)', cursor: 'pointer' }}>
                  {shared ? 'Shared ✓' : 'Share'}
                </button>
              </div>
            );
          })}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '12px 0 8px' }}>Your events</div>
          {myEvents.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>No upcoming events.</div>}
          {myEvents.map(ev => {
            const shared = myShared.has(`event:${ev.id}`);
            return (
              <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--foreground)' }}>{ev.title} {(ev.event_date || ev.date) && <span style={{ color: 'var(--muted-foreground)' }}>· {ev.event_date || ev.date}</span>}</span>
                <button onClick={() => shared ? unshareItem(sharedItems.find(i => i.item_type === 'event' && i.item_id === String(ev.id) && i.user_id === user.id)) : shareItem(ev, 'event')}
                  style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, border: `1px solid ${shared ? 'var(--primary)' : 'var(--border)'}`, background: shared ? 'var(--muted)' : 'transparent', color: shared ? 'var(--primary)' : 'var(--muted-foreground)', cursor: 'pointer' }}>
                  {shared ? 'Shared ✓' : 'Share'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ flex: 1, padding: '14px 24px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Shared deadlines</div>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>Loading…</div>
        ) : deadlineRows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 14 }}>Nothing shared yet. Opt a task or event in above to see who else in the group has it too.</div>
        ) : (
          deadlineRows.map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 'var(--radius)', marginBottom: 6, background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>{item.title}</div>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{item.due_date || 'No date'} · {item.item_type}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: 'var(--muted)', color: 'var(--primary)' }}>
                {item.peerCount} of {members.length} have this due
              </span>
            </div>
          ))
        )}
      </div>

      {showInvite && <InviteLinkModal group={group} user={user} onClose={() => setShowInvite(false)} />}
    </div>
  );
}
