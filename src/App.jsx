import React from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  Command,
  Database,
  Gauge,
  GraduationCap,
  Layers,
  PlayCircle,
  Sparkles,
  Target,
  TrendingUp,
  WandSparkles
} from 'lucide-react';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08
    }
  }
};

const item = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } }
};

function TiltCard({ className = '', children }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotateX = useSpring(useTransform(y, [-100, 100], [10, -10]), { stiffness: 180, damping: 18 });
  const rotateY = useSpring(useTransform(x, [-100, 100], [-10, 10]), { stiffness: 180, damping: 18 });

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    x.set(px - rect.width / 2);
    y.set(py - rect.height / 2);
  };

  const onLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      className={className}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      whileHover={{ scale: 1.015 }}
      transition={{ type: 'spring', stiffness: 180, damping: 18 }}
    >
      {children}
    </motion.div>
  );
}

function Panel({ className = '', children }) {
  return (
    <div
      className={`rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_10px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}

export default function App() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-12">
        <motion.section variants={container} initial="hidden" animate="show" className="grid grid-cols-1 gap-8">
          <motion.div variants={item} className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <TiltCard className="lg:col-span-5">
              <Panel className="h-full bg-gradient-to-br from-white to-indigo-50/70">
                <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                  <Sparkles size={14} /> Student Operating System
                </p>
                <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
                  Your study and planning dashboard, finally organized.
                </h1>
                <p className="mt-4 max-w-xl text-slate-600">
                  A SaaS command center for students to plan classes, track deadlines, and execute deep work with calm,
                  high-performance workflows.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <button className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">
                    Start free
                  </button>
                  <button className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700">
                    Watch demo
                  </button>
                </div>
              </Panel>
            </TiltCard>

            <motion.div variants={container} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
              {[{
                icon: <TrendingUp size={18} />,
                title: 'Weekly focus',
                value: '32.4h',
                color: 'from-indigo-500/10 to-indigo-100'
              }, {
                icon: <Target size={18} />,
                title: 'Task completion',
                value: '91%',
                color: 'from-violet-500/10 to-violet-100'
              }, {
                icon: <Gauge size={18} />,
                title: 'Energy score',
                value: '8.7/10',
                color: 'from-pink-500/10 to-pink-100'
              }, {
                icon: <GraduationCap size={18} />,
                title: 'Courses on track',
                value: '6 / 7',
                color: 'from-slate-500/10 to-slate-100'
              }].map((card) => (
                <motion.div key={card.title} variants={item}>
                  <TiltCard>
                    <Panel className={`h-full bg-gradient-to-br ${card.color}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-600">{card.title}</p>
                        <span className="text-slate-700">{card.icon}</span>
                      </div>
                      <p className="mt-5 text-3xl font-bold tracking-tight">{card.value}</p>
                      <p className="mt-3 text-xs text-slate-500">Live insights from your study workspace</p>
                    </Panel>
                  </TiltCard>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>

          <motion.section variants={item} className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-12">
              <h2 className="mb-3 text-xl font-semibold">Functional Grid · Command Center</h2>
            </div>

            <TiltCard className="lg:col-span-4">
              <Panel className="h-full">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <CalendarDays size={16} /> Mini Timeline
                </div>
                <div className="space-y-2 text-sm">
                  {[
                    ['08:30', 'Calculus review'],
                    ['10:00', 'Chem lab prep'],
                    ['13:30', 'Essay writing'],
                    ['18:00', 'Flashcards sprint']
                  ].map(([time, task]) => (
                    <div key={time} className="flex items-center justify-between rounded-xl bg-slate-100/70 px-3 py-2">
                      <span className="font-medium text-slate-600">{time}</span>
                      <span className="text-slate-700">{task}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </TiltCard>

            <TiltCard className="lg:col-span-4">
              <Panel className="h-full">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <CheckCircle2 size={16} /> Checklist Status
                </div>
                <ul className="space-y-2 text-sm">
                  {[
                    ['Submit physics quiz', true],
                    ['Plan tomorrow schedule', true],
                    ['Review SAT vocab', false],
                    ['Organize notes folder', false]
                  ].map(([label, done]) => (
                    <li key={label} className="flex items-center gap-2 rounded-xl bg-slate-100/70 px-3 py-2">
                      {done ? <CheckCircle2 size={16} className="text-indigo-600" /> : <Circle size={16} className="text-slate-500" />}
                      <span className={done ? 'text-slate-500 line-through' : 'text-slate-700'}>{label}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </TiltCard>

            <TiltCard className="lg:col-span-4">
              <Panel className="h-full">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Database size={16} /> Data Visualization
                </div>
                <div className="space-y-3">
                  {[
                    ['Cloud Storage', 72],
                    ['Weekly Velocity', 84],
                    ['Goal Growth', 64]
                  ].map(([name, val]) => (
                    <div key={name}>
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                        <span>{name}</span>
                        <span>{val}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500" style={{ width: `${val}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </TiltCard>
          </motion.section>

          <motion.section variants={item} className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-12">
              <h2 className="mb-3 text-xl font-semibold">Visual Grid · Creative Studio</h2>
            </div>

            <TiltCard className="lg:col-span-8">
              <Panel className="h-full bg-gradient-to-br from-slate-900 to-slate-800 text-white">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <PlayCircle size={16} /> Hero Media Canvas
                </div>
                <div className="flex h-64 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-indigo-500/40 via-violet-500/30 to-pink-500/30">
                  <p className="text-sm text-slate-100">Video/Image placeholder for product storytelling</p>
                </div>
              </Panel>
            </TiltCard>

            <motion.div variants={container} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-4">
              {[
                { icon: <WandSparkles size={16} />, title: 'Theme Lab', detail: 'Customize dashboard mood and layout presets' },
                { icon: <Layers size={16} />, title: 'Asset Stacks', detail: 'Organize decks, docs, and snapshots' },
                { icon: <Command size={16} />, title: 'Quick Actions', detail: 'Jump to any flow with keyboard command hub' },
                { icon: <Clock3 size={16} />, title: 'Session Timer', detail: 'Launch 25/5 deep-work cycles in one click' }
              ].map((tool) => (
                <motion.div key={tool.title} variants={item}>
                  <TiltCard>
                    <Panel className="h-full">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">{tool.title}</h3>
                        <span className="text-slate-600">{tool.icon}</span>
                      </div>
                      <p className="mt-3 text-xs text-slate-600">{tool.detail}</p>
                    </Panel>
                  </TiltCard>
                </motion.div>
              ))}
            </motion.div>
          </motion.section>

          <motion.div variants={item} className="flex justify-end">
            <button className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              Explore live dashboard <ArrowUpRight size={16} />
            </button>
          </motion.div>
        </motion.section>
      </div>
    </main>
  );
}
