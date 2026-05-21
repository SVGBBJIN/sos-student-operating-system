import React, { useMemo } from 'react';

/* Projects bar — colored-blob folder list, mirrors the landing card's
   .ld-p-folder section. Subjects are derived from tasks + events, with
   four default folders shown until real data populates them. */

const DEFAULT_PROJECTS = ['Math', 'English', 'Science', 'Social Studies'];

const SUBJECT_TONE = [
  { match: /math|calc|algebra|geometry|stat|linear/i, tone: 'math' },
  { match: /english|lit|writing|essay/i,              tone: 'english' },
  { match: /sci|bio|chem|physics/i,                   tone: 'science' },
  { match: /hist|gov|civic|econ|social/i,             tone: 'history' },
  { match: /cs|comp|code|program/i,                   tone: 'cs' },
];
function toneFor(subject) {
  for (const r of SUBJECT_TONE) if (r.match.test(subject || '')) return r.tone;
  return 'review';
}

export default function ProjectsBar({ tasks = [], events = [], notes = [], activeSubject = null, onSelectSubject }) {
  const folders = useMemo(() => {
    const counts = new Map();
    // Seed with the 4 defaults at count 0
    DEFAULT_PROJECTS.forEach(d => counts.set(d, 0));
    const add = (subj) => {
      const s = (subj || '').trim();
      if (!s) return;
      // Case-insensitive match against existing keys so "math" merges with "Math"
      const existing = [...counts.keys()].find(k => k.toLowerCase() === s.toLowerCase());
      const key = existing || s;
      counts.set(key, (counts.get(key) || 0) + 1);
    };
    tasks.forEach(t => add(t.subject));
    events.forEach(e => add(e.subject));
    notes.forEach(n => add(n.subject || n.tab_name));
    return [...counts.entries()]
      .sort((a, b) => {
        // Default projects stay in declared order; real subjects sort by count desc
        const ai = DEFAULT_PROJECTS.findIndex(d => d.toLowerCase() === a[0].toLowerCase());
        const bi = DEFAULT_PROJECTS.findIndex(d => d.toLowerCase() === b[0].toLowerCase());
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b[1] - a[1];
      })
      .slice(0, 6)
      .map(([name, count]) => ({ name, count, tone: toneFor(name) }));
  }, [tasks, events, notes]);

  return (
    <div className="projects-bar">
      <div className="pb-label">Projects</div>
      {folders.map(f => (
        <button
          key={f.name}
          className={'pb-folder' + (activeSubject === f.name ? ' active' : '')}
          data-tone={f.tone}
          onClick={() => onSelectSubject?.(activeSubject === f.name ? null : f.name)}
          title={f.count > 0 ? `${f.name} · ${f.count}` : f.name}
        >
          <span className="blob" />
          <span className="name">{f.name}</span>
          {f.count > 0 && <span className="count">{f.count}</span>}
        </button>
      ))}
    </div>
  );
}
