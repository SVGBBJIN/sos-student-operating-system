export const SLASH_COMMANDS = [
  { cmd: '/task',      hint: '/task [description]',      desc: 'Add a task or assignment',             fill: '/task ' },
  { cmd: '/flashcard', hint: '/flashcard [topic]',        desc: 'Generate flashcards on a topic',       fill: '/flashcard ' },
  { cmd: '/quiz',      hint: '/quiz [topic]',             desc: 'Create a practice quiz',               fill: '/quiz ' },
  { cmd: '/timer',     hint: '/timer [minutes]',          desc: 'Start a focus timer',                  fill: '/timer ' },
  { cmd: '/remind',    hint: '/remind [time] [what]',     desc: 'Set a reminder',                       fill: '/remind ' },
  { cmd: '/calendar',  hint: '/calendar',                 desc: 'Open schedule + chat',                 fill: '/calendar' },
  { cmd: '/notes',     hint: '/notes',                    desc: 'Open notes + chat',                    fill: '/notes' },
  { cmd: '/study',     hint: '/study',                    desc: 'Switch to Study Mode',                 fill: '/study' },
  { cmd: '/upload',    hint: '/upload',                   desc: 'Upload a PDF to make study materials', fill: '/upload' },
];

export default function SlashPalette({ query, onSelect }) {
  const filtered = SLASH_COMMANDS.filter(c =>
    !query || c.cmd.slice(1).startsWith(query.toLowerCase())
  );
  if (filtered.length === 0) return null;

  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6,
      background: 'rgba(10,12,24,0.97)', border: '1px solid rgba(0,229,204,0.2)',
      borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      backdropFilter: 'blur(16px)', zIndex: 50, animation: 'fadeIn .12s ease',
    }}>
      <div style={{ padding: '6px 12px', fontSize: '0.68rem', color: 'var(--text-dim)', borderBottom: '1px solid rgba(255,255,255,0.05)', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>
        Commands
      </div>
      {filtered.map(c => (
        <button
          key={c.cmd}
          onMouseDown={e => { e.preventDefault(); onSelect(c.fill); }}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', background: 'transparent', border: 'none', padding: '9px 14px', cursor: 'pointer', textAlign: 'left', transition: 'background .1s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,229,204,0.07)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.80rem', color: 'var(--neon-cyan)', width: 90, flexShrink: 0 }}>{c.hint}</span>
          <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)' }}>{c.desc}</span>
        </button>
      ))}
    </div>
  );
}
