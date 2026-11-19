# protótipo: "snap" dos tempos do Whisper na energia do áudio (VAD) + auto-calibração do atraso
import json, sys, numpy as np, unicodedata, re, difflib, statistics as st
def norm(w): return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFD', w.lower()).encode('ascii','ignore').decode())
a = np.fromfile('speech16k.f32', np.float32); SR = 16000; hop = 160  # 10 ms
fr = a[: len(a)//hop*hop].reshape(-1, hop); db = 20*np.log10(np.sqrt((fr**2).mean(1)) + 1e-7)
floor, speech = np.percentile(db, 10), np.percentile(db, 90); thr = max(-60, min(-18, floor + (speech-floor)*0.3))
voiced = db > thr
# fecha buracos < 80 ms (oclusivas) e remove ilhas < 50 ms
def runs(v):
    out=[]; s=None
    for i,x in enumerate(np.append(v,False)):
        if x and s is None: s=i
        if not x and s is not None: out.append([s,i]); s=None
    return out
r = runs(voiced); merged=[]
for s,e in r:
    if merged and s-merged[-1][1] < 8: merged[-1][1]=e
    else: merged.append([s,e])
speechR = [(s*0.01, e*0.01) for s,e in merged if e-s >= 5]
def onset_near(t, lo, hi):
    c = [s for s,e in speechR if t+lo <= s <= t+hi]; return min(c, key=lambda s: abs(s-t)) if c else None
def offset_near(t, lo, hi):
    c = [e for s,e in speechR if t+lo <= e <= t+hi]; return min(c, key=lambda e: abs(e-t)) if c else None
truth = json.load(open('truth.json'))['words']
for f in sys.argv[1:]:
    hyp = [dict(text=c['text'].strip(), s=c['timestamp'][0], e=c['timestamp'][1] if c['timestamp'][1] is not None else c['timestamp'][0]+0.2) for c in json.load(open(f))['chunks'] if norm(c['text'])]
    # 1) calibra atraso: palavras cujo início caiu perto de um onset de fala (depois de silêncio)
    offs = []
    for w in hyp:
        o = onset_near(w['s'], -0.45, 0.05)
        if o is not None: offs.append(w['s'] - o)
    lag = st.median(offs) if offs else 0.0
    out = []
    for i, w in enumerate(hyp):
        s, e = w['s'] - lag, w['e'] - lag
        o = onset_near(s, -0.15, 0.15);  s = o if o is not None else s     # snap início a onset
        f2 = offset_near(e, -0.25, 0.25); e = f2 if f2 is not None else e  # snap fim a offset (fim de frase)
        out.append(dict(text=w['text'], s=s, e=max(e, s+0.08)))
    for i in range(1, len(out)):
        out[i]['s'] = max(out[i]['s'], out[i-1]['s'] + 0.06); out[i]['e'] = max(out[i]['e'], out[i]['s'] + 0.06)
    for i in range(1, len(out)):  # sem sobreposição
        if out[i]['s'] < out[i-1]['e']: out[i-1]['e'] = max(out[i-1]['s']+0.05, out[i]['s'])
    T=[norm(x['text']) for x in truth]; H=[norm(x['text']) for x in out]
    sm=difflib.SequenceMatcher(a=T,b=H,autojunk=False); ds=[];de=[];ds0=[];de0=[]
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            t=truth[blk.a+k]; h=out[blk.b+k]; h0=hyp[blk.b+k]
            ds.append(h['s']-t['start']); de.append(h['e']-t['end']); ds0.append(h0['s']-t['start']); de0.append(h0['e']-t['end'])
    A=lambda xs:(st.mean(xs), st.median(xs), sorted(map(abs,xs))[int(.9*len(xs))], sum(abs(x)>0.15 for x in xs))
    print(f"{f}: estimated lag={lag:+.3f}s from {len(offs)} onsets")
    print("  raw     START mean=%+.3f med=%+.3f p90|.|=%.3f n>0.15=%d" % A(ds0), " END mean=%+.3f med=%+.3f p90|.|=%.3f n>0.15=%d" % A(de0))
    print("  refined START mean=%+.3f med=%+.3f p90|.|=%.3f n>0.15=%d" % A(ds), " END mean=%+.3f med=%+.3f p90|.|=%.3f n>0.15=%d" % A(de))
    json.dump([{'text':' '+x['text'],'timestamp':[round(x['s'],3),round(x['e'],3)]} for x in out], open(f.replace('chunks_','refined_'),'w'))
print('VAD speech runs:', len(speechR), 'thr dB', round(float(thr),1))
