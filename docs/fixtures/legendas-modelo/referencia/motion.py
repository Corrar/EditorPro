import sys, subprocess, numpy as np
from PIL import Image
W,H,FPS=108,192,10
def frames(path):
    raw=subprocess.run(['ffmpeg','-loglevel','error','-i',path,'-vf',f'fps={FPS},scale={W}:{H},format=gray','-f','rawvideo','-'],capture_output=True).stdout
    a=np.frombuffer(raw,np.uint8).reshape(-1,H,W).astype(np.float32)
    return a
def warp(img,s,tx,ty):
    # escala s em torno do centro + translação (px)
    cx,cy=W/2,H/2
    im=Image.fromarray(img)
    # mapeamento inverso: saída (x,y) <- entrada ((x-cx-tx)/s+cx, ...)
    a=1/s; c=cx-(cx+tx)/s; e=1/s; f=cy-(cy+ty)/s
    return np.asarray(im.transform((W,H),Image.AFFINE,(a,0,c,0,e,f),resample=Image.BILINEAR),np.float32)
mask=np.ones((H,W),bool); mask[:int(.12*H)]=0; mask[int(.88*H):]=0; mask[:,:int(.12*W)]=0; mask[:,int(.88*W):]=0
mask[int(.64*H):int(.86*H)]=0  # região de legenda (estática) fora do cálculo
def est(A,B):
    best=(1e9,1,0,0)
    for s in np.linspace(0.97,1.06,37):
        d=np.abs(warp(A,s,0,0)-B)[mask].mean()
        if d<best[0]: best=(d,s,0,0)
    s=best[2-1]
    for tx in range(-3,4):
        for ty in range(-3,4):
            d=np.abs(warp(A,s,tx,ty)-B)[mask].mean()
            if d<best[0]: best=(d,s,tx,ty)
    return best
F=frames(sys.argv[1])
rows=[]
for i in range(len(F)-1):
    base=np.abs(F[i]-F[i+1])[mask].mean()
    d,s,tx,ty=est(F[i],F[i+1])
    rows.append((i/FPS,base,d,s,tx,ty))
# cortes: resíduo após melhor alinhamento alto
res=np.array([r[2] for r in rows]); med=np.median(res); mad=np.median(np.abs(res-med))+1e-6
cuts=[r[0]+1/FPS for r in rows if r[2]>max(25,med+8*mad)]
print('frames',len(F),'cuts',[round(c,2) for c in cuts])
# por tomada: zoom acumulado e suavidade (jerk)
bounds=[0]+cuts+[len(F)/FPS]
for a,b in zip(bounds[:-1],bounds[1:]):
    ss=[r[3] for r in rows if a<=r[0] and r[0]+1/FPS<b-1e-6]
    if not ss: continue
    v=np.log(ss)  # velocidade de zoom por passo (log)
    tot=float(np.exp(v.sum()))
    jerk=float(np.abs(np.diff(v,2)).mean()) if len(v)>2 else 0
    peak=float(np.abs(v).max()); mean=float(np.abs(v).mean())
    print(f'shot {a:5.2f}-{b:5.2f}s  zoom_total={tot:.3f}  vel/step={["%+.3f"%x for x in v]}  peak/mean={peak/max(mean,1e-6):.2f}')
