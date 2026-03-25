import { motion } from 'framer-motion';

/**
 * Three-layer drifting cloud system.
 * Layer 1: far/faint, slowest drift
 * Layer 2: mid opacity, medium drift
 * Layer 3: near, fastest drift
 */

const CLOUDS = [
  // Layer 1 — far, very faint
  { id: 'c1', top: '8%',  left: '-5%',  width: 320, height: 80,  opacity: 0.12, duration: 40, blur: 18, delay: 0 },
  { id: 'c2', top: '22%', left: '55%',  width: 260, height: 60,  opacity: 0.10, duration: 45, blur: 20, delay: -12 },
  { id: 'c3', top: '60%', left: '-8%',  width: 200, height: 50,  opacity: 0.09, duration: 50, blur: 22, delay: -25 },
  // Layer 2 — mid
  { id: 'c4', top: '15%', left: '20%',  width: 280, height: 70,  opacity: 0.18, duration: 30, blur: 12, delay: -5 },
  { id: 'c5', top: '45%', left: '60%',  width: 340, height: 85,  opacity: 0.16, duration: 35, blur: 14, delay: -18 },
  { id: 'c6', top: '72%', left: '10%',  width: 220, height: 55,  opacity: 0.15, duration: 38, blur: 16, delay: -8 },
  // Layer 3 — near, most visible
  { id: 'c7', top: '5%',  left: '40%',  width: 300, height: 75,  opacity: 0.24, duration: 22, blur: 6,  delay: -3 },
  { id: 'c8', top: '35%', left: '-3%',  width: 250, height: 65,  opacity: 0.22, duration: 26, blur: 8,  delay: -15 },
  { id: 'c9', top: '80%', left: '70%',  width: 180, height: 45,  opacity: 0.20, duration: 28, blur: 10, delay: -20 },
];

function Cloud({ top, left, width, height, opacity, duration, blur, delay }) {
  return (
    <motion.div
      style={{
        position: 'absolute',
        top,
        left,
        width,
        height,
        borderRadius: '50% 60% 55% 50% / 60% 50% 60% 55%',
        background: 'rgba(255,255,255,0.85)',
        filter: `blur(${blur}px)`,
        opacity,
      }}
      animate={{ x: [0, 80, 0] }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
        repeatType: 'mirror',
      }}
    />
  );
}

export default function CloudLayer() {
  return (
    <>
      {CLOUDS.map(c => (
        <Cloud key={c.id} {...c} />
      ))}
    </>
  );
}
