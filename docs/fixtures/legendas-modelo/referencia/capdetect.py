import sys, subprocess, numpy as np
W,H,FPS=135,240,10
raw=subprocess.run(['ffmpeg','-loglevel','error','-i',sys.argv[1],'-vf',f'fps={FPS},scale={W}:{H}','-pix_fmt','rgb24','-f','rawvideo','-'],capture_output=True).stdout
F=np.frombuffer(raw,np.uint8).reshape(-1,H,W,3).astype(np.float32)
g=F.mean(-1)
# gradiente espacial por quadro
gx=np.abs(np.diff(g,axis=2,prepend=g[:,:,:1])); gy=np.abs(np.diff(g,axis=1,prepend=g[:,:1,:]))
edge=(gx+gy)
# janelas curtas (dentro de uma tomada ~1 s): estático + com borda = texto queimado
win=8; score=np.zeros((H,W))
for s in range(0,len(F)-win,win):
    seg=g[s:s+win]; st=seg.std(0); e=edge[s:s+win].mean(0)
    score+=((st<6)&(e>40)).astype(float)
score/=max(1,(len(F)-win)//win)
rows=score.mean(1)
band=np.where(rows>rows.max()*0.35)[0]
print('rows with static text energy (y/H):', round(band.min()/H,3), '-', round(band.max()/H,3)) if len(band) else print('none')
y0,y1=band.min(),band.max()+1
cols=np.where(score[y0:y1].mean(0)>0.1)[0]
x0,x1=cols.min(),cols.max()+1
print('box x:',round(x0/W,3),'-',round(x1/W,3),' center y:',round((y0+y1)/2/H,3),' text height px@1920:',round((y1-y0)/H*1920))
reg=F[:,y0:y1,x0:x1].reshape(-1,3)
lum=reg.mean(1); sat=(reg.max(1)-reg.min(1))/(reg.max(1)+1)
bright=reg[(lum>120)&(sat>0.4)]; dark=reg[lum<50]
hexs=lambda c:'#%02X%02X%02X'%tuple(int(x) for x in c)
print('text color ~',hexs(np.median(bright,0)) if len(bright) else '?','frac',round(len(bright)/len(reg),2),' box color ~',hexs(np.median(dark,0)) if len(dark) else '?','frac',round(len(dark)/len(reg),2))
