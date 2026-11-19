import { interpolateTransform, ease } from '/home/user/ep-int/web/lib/engine/easing';
import { effectGeometry } from '/home/user/ep-int/web/lib/engine/effects';
import { punchKeyframes } from '/home/user/ep-int/web/lib/ai/demo';
import type { Keyframe } from '/home/user/ep-int/web/lib/types';

const T0 = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
function seq(fn: (t: number) => number, t0: number, t1: number, fps: number) {
  const out: number[] = [];
  for (let i = 0; t0 + i / fps <= t1 + 1e-9; i++) out.push(fn(t0 + i / fps));
  return out;
}
function stats(name: string, s: number[], fps: number, W = 1080) {
  // per-frame scale delta -> edge displacement in px at 1080 wide (edge moves dScale*W/2)
  const d = s.slice(1).map((v, i) => v - s[i]);
  const px = d.map((x) => Math.abs(x) * W / 2);
  const maxPx = Math.max(...px);
  const acc = d.slice(1).map((v, i) => v - d[i]);
  const maxAccPx = Math.max(...acc.map((a) => Math.abs(a) * W / 2));
  const vel = d.map((x) => x * fps); // scale/s
  console.log(`${name.padEnd(46)} fps=${fps} frames=${s.length} range=[${Math.min(...s).toFixed(3)},${Math.max(...s).toFixed(3)}] maxEdgeJump=${maxPx.toFixed(1)}px/frame maxEdgeAccel(jerk)=${maxAccPx.toFixed(1)}px/frame² peakVel=${Math.max(...vel.map(Math.abs)).toFixed(2)} scale/s`);
}
const kfScale = (kfs: Keyframe[]) => (t: number) => interpolateTransform(T0, kfs, t).scale;

// (a) slow zoom 1.0->1.2 over 3s easeInOut
const a: Keyframe[] = [{ t: 0, transform: { scale: 1 } }, { t: 3, transform: { scale: 1.2 }, easing: 'easeInOut' }];
const aL: Keyframe[] = [{ t: 0, transform: { scale: 1 } }, { t: 3, transform: { scale: 1.2 } }];
for (const fps of [30, 60]) { stats('(a) kf 1.0->1.2 3s easeInOut', seq(kfScale(a), 0, 3, fps), fps); }
stats('(a2) kf 1.0->1.2 3s linear (Claude omits easing)', seq(kfScale(aL), 0, 3.3, 30), 30);
// linear: velocity discontinuity at start/end
{
  const s = seq(kfScale(aL), -0.2, 3.2, 30); const d = s.slice(1).map((v, i) => v - s[i]);
  console.log('   linear per-frame dScale around start:', d.slice(4, 9).map((x) => x.toFixed(4)).join(' '), ' around end:', d.slice(94, 100).map((x) => x.toFixed(4)).join(' '));
}
// (b) emphasis zoom as built by features.emphasisZoomOps (t0=1, hold 0.8)
const t0 = 1, hold = 0.8, t3 = t0 + 0.15 + hold + 0.25, sc = 1.18;
const emph: Keyframe[] = [
  { t: t0 - 0.01, transform: { scale: 1 } },
  { t: t0 + 0.15, transform: { scale: sc }, easing: 'easeOut' },
  { t: Math.min(t3 - 0.25, t0 + 0.15 + hold), transform: { scale: sc } },
  { t: t3, transform: { scale: 1 }, easing: 'easeInOut' }];
for (const fps of [30, 60]) stats('(b1) emphasisZoom 1->1.18 in 0.16s easeOut', seq(kfScale(emph), 0.5, 3, fps), fps);
{ const s = seq(kfScale(emph), 0.9, 1.4, 30); console.log('   emphasis scale @30fps from 0.9s:', s.map((x) => x.toFixed(3)).join(' ')); }
const hook: Keyframe[] = [{ t: 0, transform: { scale: 1.25 } }, { t: 0.5, transform: { scale: 1 }, easing: 'easeOut' }];
for (const fps of [30, 60]) stats('(b2) hookZoom 1.25->1 0.5s easeOut', seq(kfScale(hook), 0, 1, fps), fps);
{ const s = seq(kfScale(hook), 0, 0.6, 30); console.log('   hook scale @30fps:', s.map((x) => x.toFixed(3)).join(' ')); }
const pk = punchKeyframes(8, 2.8, 1.1);
stats('(b3) demo punchKeyframes(8s,2.8,1.1)', seq(kfScale(pk), 0, 8, 30), 30);
{ const s = seq(kfScale(pk), 2.7, 3.1, 30); console.log('   punch scale @30fps 2.7..3.1:', s.map((x) => x.toFixed(3)).join(' ')); }
const pkS = punchKeyframes(8, 2, 1.16);
stats('(b4) demo punchKeyframes strong(8s,2,1.16)', seq(kfScale(pkS), 0, 8, 30), 30);
// (c) effects
const eff = (kind: string, intensity = 0.5, speed = 1) => (t: number) => effectGeometry([{ kind, intensity, speed } as never], t).scale;
const effX = (kind: string, intensity = 0.5) => (t: number) => effectGeometry([{ kind, intensity } as never], t).dx;
for (const fps of [30, 60]) stats('(c1) zoom-punch effect i=0.5', seq(eff('zoom-punch'), 0, 3, fps), fps);
{ const s = seq(eff('zoom-punch', 0.5), 0.4, 0.75, 60); console.log('   zoom-punch scale @60fps 0.40..0.75:', s.map((x) => x.toFixed(3)).join(' ')); }
stats('(c2) zoom-pulse i=0.5', seq(eff('zoom-pulse'), 0, 3, 30), 30);
stats('(c3) beat-pulse i=0.5', seq(eff('beat-pulse'), 0, 3, 30), 30);
stats('(c4) zoom-slow i=0.5', seq(eff('zoom-slow'), 0, 6, 30), 30);
stats('(c5) handheld i=0.5 (scale)', seq(eff('handheld'), 0, 6, 30), 30);
stats('(c6) shake i=0.5 dx(×W) ', seq(effX('shake'), 0, 3, 60), 60);
{ const s = seq(effX('shake'), 0, 0.2, 60); console.log('   shake dx @60fps (stair-steps at 24Hz):', s.map((x) => (x * 1080).toFixed(1)).join(' ')); }
stats('(c7) handheld dx(×W)', seq(effX('handheld'), 0, 6, 30), 30);
// zoom-pulse discontinuity
{ const s = seq(eff('zoom-pulse'), 0.45, 0.55, 60); console.log('   zoom-pulse @60fps 0.45..0.55 (sawtooth reset):', s.map((x) => x.toFixed(3)).join(' ')); }
console.log('ease easeOut(1/4.8)=', ease('easeOut', 1 / 4.8).toFixed(3), ' easeInOut slope max=', ((ease('easeInOut', 0.5001) - ease('easeInOut', 0.4999)) / 0.0002).toFixed(2));
