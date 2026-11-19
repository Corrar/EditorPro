import subprocess,sys,math
def ease(k,x):
    x=min(1,max(0,x))
    if k=='easeOut': return 1-(1-x)**3
    if k=='easeInOut': return 4*x**3 if x<.5 else 1-(-2*x+2)**3/2
    return x
def width_series(f):
    info=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=r_frame_rate,nb_frames','-of','csv=p=0',f],capture_output=True,text=True).stdout.strip()
    raw=subprocess.run(['ffmpeg','-v','error','-i',f,'-vf','format=gray,crop=1080:2:0:960','-f','rawvideo','-'],capture_output=True).stdout
    n=len(raw)//2160; out=[]
    for i in range(n):
        row=raw[i*2160:i*2160+1080]
        out.append(sum(row)/255.0)
    return info,out
for f,fps,ideal in [('exp_A.mp4',30,lambda t: 1+0.2*ease('easeInOut',(t-0.5)/3)),('exp_A60.mp4',60,lambda t: 1+0.2*ease('easeInOut',(t-0.5)/3)),('exp_B1.mp4',30,None),('exp_C.mp4',30,None)]:
    info,w=width_series(f)
    s=[x/400 for x in w]
    print(f'\n{f}: ffprobe {info}; frames={len(s)}')
    d=[b-a for a,b in zip(s,s[1:])]
    edge=[abs(x)*540 for x in d]
    print('  scale range %.4f..%.4f ; max edge step %.2f px/frame'%(min(s),max(s),max(edge)))
    if ideal:
        err=[abs(s[i]-ideal(i/fps)) for i in range(len(s))]
        # check for duplicated / skipped frames: d should be smooth; second difference
        dd=[b-a for a,b in zip(d,d[1:])]
        mid=[(i,d[i]) for i in range(len(d)) if 1.5<i/fps<2.5]
        print('  max |measured-ideal| scale %.4f (=%.2f px edge) ; mid-ramp per-frame dScale min %.5f max %.5f ; max |2nd diff| (edge px) %.3f'%(max(err),max(err)*540,min(x for _,x in mid),max(x for _,x in mid),max(abs(x) for x in dd)*540))
        zeros=sum(1 for i in range(len(d)) if 0.6<i/fps<3.4 and abs(d[i])<1e-4)
        print('  frames with no motion inside the ramp (dup frames):',zeros)
    else:
        print('  per-frame scale:',' '.join('%.3f'%x for x in s[:80]))
