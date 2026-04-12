import { useState, useEffect } from 'react';
import { getPerfTier, setPerfOverride } from '../lib/perfAdjuster';

export default function PerfPill() {
  const [tier, setTier] = useState(() => getPerfTier());

  useEffect(() => {
    function onTier(e) { setTier(e.detail.tier); }
    window.addEventListener('sos:perf-tier', onTier);
    return () => window.removeEventListener('sos:perf-tier', onTier);
  }, []);

  const labels = { full: 'Full', mid: 'Mid', low: 'Lite' };
  const cycle = () => {
    const tiers = ['full', 'mid', 'low'];
    const next = tiers[(tiers.indexOf(tier) + 1) % 3];
    setPerfOverride(next);
    setTier(next);
  };

  const pillClass = 'perf-pill' + (tier === 'full' ? ' tier-full' : tier === 'mid' ? ' tier-mid' : '');
  return (
    <button className={pillClass} onClick={cycle} title={`Performance: ${labels[tier]}. Click to cycle.`}>
      {tier === 'full' ? '✦' : '⚡'} {labels[tier]}
    </button>
  );
}
