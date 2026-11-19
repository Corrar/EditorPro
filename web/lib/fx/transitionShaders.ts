/* =====================================================================
   Transições em shader escritas para o EditorPro (sem código de terceiros):
   3D (cubo, virar, página), máscaras de luminância (estrela, coração,
   relógio, diagonal, ruído), portas/persianas, câmera (chicotes, zoom/giro
   com desfoque, esticar), efeitos (tinta, fumaça, mosaico, pixel sort,
   glitch, queimar), luz (flash de câmera, flare)…
   u_from = quadro que sai, u_to = quadro que entra, u_progress 0..1,
   v_uv (0,0) = canto superior esquerdo. Saída opaca.
   ===================================================================== */
import { GLSL_PRECISION } from './glcore';

const HEAD = GLSL_PRECISION +
  'varying vec2 v_uv;uniform sampler2D u_from,u_to;uniform float u_progress;uniform vec2 u_res;\n' +
  'vec4 A(vec2 uv){return texture2D(u_from,clamp(uv,0.,1.));}vec4 B(vec2 uv){return texture2D(u_to,clamp(uv,0.,1.));}' +
  'bool inb(vec2 uv){return uv.x>=0.&&uv.y>=0.&&uv.x<=1.&&uv.y<=1.;}' +
  'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}' +
  'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);' +
  'return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}' +
  'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}' +
  'vec2 ASP(){return vec2(u_res.x/u_res.y,1.);}' +
  'float bell(float p){return sin(p*3.14159265);}' +
  'vec2 rot(vec2 p,float a){float s=sin(a),c=cos(a);return vec2(p.x*c-p.y*s,p.x*s+p.y*c);}\n';

const blk = 'vec4(0.,0.,0.,1.)';

/* cubo: face que sai some p/ "trás", a que entra vem da lateral (perspectiva aproximada) */
const CUBE_FN =
  'vec4 cube(vec2 uv,float p,bool flipX,bool swap){vec2 q=swap?uv.yx:uv;if(flipX)q.x=1.-q.x;' +
  'float a=p*1.5707963;float ca=cos(a),sa=sin(a);float w1=ca/(ca+sa);float z=1.-.14*sin(p*3.14159265);q=(q-.5)/z+.5;' +
  'if(q.x<0.||q.x>1.||q.y<0.||q.y>1.)return ' + blk + ';' +
  'vec2 s;float sh;bool fromFace=q.x<w1;' +
  'if(fromFace){float u=q.x/max(w1,1e-4);float d=(1.-u)*sa;s=vec2(u,(q.y-.5)*(1.+.4*d)+.5);sh=1.-.4*d;}' +
  'else{float u=(q.x-w1)/max(1.-w1,1e-4);float d=u*ca;s=vec2(u,(q.y-.5)*(1.+.4*d)+.5);sh=1.-.4*d;}' +
  'if(s.y<0.||s.y>1.)return ' + blk + ';if(flipX)s.x=1.-s.x;if(swap)s=s.yx;' +
  'vec4 c=fromFace?A(s):B(s);return vec4(c.rgb*sh,1.);}';

/* chicote direcional: borrão de movimento forte + troca no meio */
const WHIP_FN =
  'vec4 whip(vec2 d){float p=u_progress;float e=p<.5?pow(p*2.,2.)*.5:1.-pow((1.-p)*2.,2.)*.5;vec4 c=vec4(0.);' +
  'float bl=bell(p)*.18;for(int i=0;i<16;i++){float f=float(i)/15.-.5;' +
  'vec2 uv=v_uv+d*(e+f*bl);vec4 x=(e<.5)?A(fract(uv)):B(fract(uv-d));c+=x;}return c/16.;}';

const F: Record<string, string> = {
  'cube-left': CUBE_FN + 'void main(){gl_FragColor=cube(v_uv,u_progress,false,false);}',
  'cube-right': CUBE_FN + 'void main(){gl_FragColor=cube(v_uv,u_progress,true,false);}',
  'cube-up': CUBE_FN + 'void main(){gl_FragColor=cube(v_uv,u_progress,false,true);}',
  'flip-x':
    'void main(){float a=u_progress*3.14159265;float c=cos(a);float w=max(abs(c),1e-3);float x=(v_uv.x-.5)/w+.5;' +
    'float y=(v_uv.y-.5)*(1.+.35*sin(a)*(x-.5)*sign(c))+.5;float z=1.-.12*sin(a);y=(y-.5)/z+.5;x=(x-.5)/z+.5;' +
    'if(x<0.||x>1.||y<0.||y>1.){gl_FragColor=' + blk + ';return;}vec4 col=c>0.?A(vec2(x,y)):B(vec2(x,y));gl_FragColor=vec4(col.rgb*(.65+.35*w),1.);}',
  'flip-y':
    'void main(){float a=u_progress*3.14159265;float c=cos(a);float w=max(abs(c),1e-3);float y=(v_uv.y-.5)/w+.5;' +
    'float x=(v_uv.x-.5)*(1.+.35*sin(a)*(y-.5)*sign(c))+.5;float z=1.-.12*sin(a);y=(y-.5)/z+.5;x=(x-.5)/z+.5;' +
    'if(x<0.||x>1.||y<0.||y>1.){gl_FragColor=' + blk + ';return;}vec4 col=c>0.?A(vec2(x,y)):B(vec2(x,y));gl_FragColor=vec4(col.rgb*(.65+.35*w),1.);}',
  'page-curl':
    'void main(){vec2 n=vec2(.70710678);float d=dot(vec2(1.)-v_uv,n);float pos=u_progress*1.5;' +
    'if(d<pos){gl_FragColor=B(v_uv)*(1.-.35*smoothstep(.12,0.,pos-d)*(1.-u_progress));gl_FragColor.a=1.;return;}' +
    'vec2 src=v_uv+n*2.*(d-pos);if(d<2.*pos&&inb(src)){vec3 back=mix(A(src).rgb,vec3(.96),.72);float sh=.75+.25*smoothstep(0.,.25,d-pos);' +
    'gl_FragColor=vec4(back*sh,1.);return;}' +
    'float shadow=1.-.45*smoothstep(.1,0.,d-2.*pos)*step(.001,pos);gl_FragColor=vec4(A(v_uv).rgb*shadow,1.);}',
  'doors-open':
    'void main(){float e=u_progress*u_progress*(3.-2.*u_progress);if(v_uv.x<.5){float x=v_uv.x+e*.5;if(x<.5){gl_FragColor=A(vec2(x,v_uv.y));return;}}' +
    'else{float x=v_uv.x-e*.5;if(x>.5){gl_FragColor=A(vec2(x,v_uv.y));return;}}float z=.88+.12*e;gl_FragColor=B((v_uv-.5)*z+.5);}',
  'doors-close':
    'void main(){float e=u_progress*u_progress*(3.-2.*u_progress);if(v_uv.x<.5){float x=v_uv.x+(1.-e)*.5;if(x<.5){gl_FragColor=B(vec2(x,v_uv.y));return;}}' +
    'else{float x=v_uv.x-(1.-e)*.5;if(x>.5){gl_FragColor=B(vec2(x,v_uv.y));return;}}float z=1.-.12*e;gl_FragColor=A((v_uv-.5)*z+.5);}',
  'split-open':
    'void main(){float e=u_progress*u_progress*(3.-2.*u_progress);if(v_uv.y<.5){float y=v_uv.y+e*.5;if(y<.5){gl_FragColor=A(vec2(v_uv.x,y));return;}}' +
    'else{float y=v_uv.y-e*.5;if(y>.5){gl_FragColor=A(vec2(v_uv.x,y));return;}}gl_FragColor=B((v_uv-.5)*(.9+.1*e)+.5);}',
  'blinds-h':
    'void main(){float f=fract(v_uv.y*10.);float m=smoothstep(u_progress*1.1-.1,u_progress*1.1,f);gl_FragColor=mix(B(v_uv),A(v_uv),m);}',
  'blinds-v':
    'void main(){float f=fract(v_uv.x*10.);float m=smoothstep(u_progress*1.1-.1,u_progress*1.1,f);gl_FragColor=mix(B(v_uv),A(v_uv),m);}',
  'luma-star':
    'void main(){vec2 p=(v_uv-.5)*ASP();p.y=-p.y;float r=length(p);float a=atan(p.x,p.y);float sg=1.2566371;' +
    'float m=abs(mod(a+sg*.5,sg)-sg*.5)/(sg*.5);float R=mix(1.,.42,m)*.5;float s=u_progress*2.6;' +
    'float e=smoothstep(s*R,s*R+.01,r);gl_FragColor=mix(B(v_uv),A(v_uv),e);}',
  'luma-heart':
    'void main(){vec2 p=(v_uv-vec2(.5,.47))*ASP()*vec2(1.,-1.);float s=max(u_progress*2.4,1e-3);vec2 q=p/s*2.6;' +
    'float x2=q.x*q.x,y=q.y+.15*abs(q.x);float f=pow(x2+y*y-1.,3.)-x2*y*y*y;gl_FragColor=f<0.?B(v_uv):A(v_uv);}',
  'luma-diagonal':
    'void main(){float d=(v_uv.x+v_uv.y)*.5;float m=smoothstep(u_progress*1.2-.1,u_progress*1.2,d);gl_FragColor=mix(B(v_uv),A(v_uv),m);}',
  'luma-clock':
    'void main(){vec2 p=(v_uv-.5)*ASP();float a=atan(p.x,-p.y)/6.2831853+.5;float m=smoothstep(u_progress-.004,u_progress+.004,a);' +
    'gl_FragColor=mix(B(v_uv),A(v_uv),m);}',
  'noise-dissolve':
    'void main(){float n=fbm(v_uv*vec2(8.,14.))*.75+hash(floor(v_uv*u_res/2.))*.25;float m=smoothstep(u_progress*1.1-.05,u_progress*1.1,n);gl_FragColor=mix(B(v_uv),A(v_uv),m);}',
  'luma-melt':
    'void main(){float n=vnoise(vec2(v_uv.x*14.,0.))*.35+vnoise(vec2(v_uv.x*40.,3.))*.12;float sh=max(0.,u_progress*1.55-n);' +
    'float y=v_uv.y-sh;gl_FragColor=y>0.?A(vec2(v_uv.x,y)):B(v_uv);}',
  'zoom-blur':
    'void main(){float p=u_progress;vec2 c=vec2(.5);float s=bell(p)*.35;vec4 a=vec4(0.),b=vec4(0.);float za=1.+p*.7,zb=1.7-.7*p;' +
    'for(int i=0;i<16;i++){float f=1.-s*float(i)/15.;a+=A(c+(v_uv-c)/za*f);b+=B(c+(v_uv-c)/zb*f);}gl_FragColor=mix(a,b,smoothstep(.38,.62,p))/16.;}',
  'spin-blur':
    'void main(){float p=u_progress;vec2 q=(v_uv-.5)*ASP();float sp=bell(p)*.5;vec4 a=vec4(0.),b=vec4(0.);' +
    'for(int i=0;i<16;i++){float f=(float(i)/15.-.5)*sp;a+=A(rot(q,p*3.14159+f)/ASP()+.5);b+=B(rot(q,-(1.-p)*3.14159+f)/ASP()+.5);}' +
    'gl_FragColor=mix(a,b,smoothstep(.4,.6,p))/16.;}',
  stretch:
    'void main(){float p=u_progress;vec2 ua=vec2(.5+(v_uv.x-.5)/(1.+p*5.),v_uv.y);vec2 ub=vec2(.5+(v_uv.x-.5)/(1.+(1.-p)*5.),v_uv.y);' +
    'vec4 c=mix(A(ua),B(ub),smoothstep(.42,.58,p));gl_FragColor=c+vec4(vec3(.25*pow(bell(p),6.)),0.);}',
  squeeze:
    'void main(){float p=u_progress;float h=p<.5?1.-p*2.:p*2.-1.;h=max(h,1e-3);float y=(v_uv.y-.5)/h+.5;' +
    'if(y<0.||y>1.){gl_FragColor=' + blk + ';return;}gl_FragColor=p<.5?A(vec2(v_uv.x,y)):B(vec2(v_uv.x,y));}',
  ink:
    'void main(){vec2 p=(v_uv-.5)*ASP();float g=1.-length(p)*1.15+(fbm(v_uv*4.+3.)-.5)*.7;float t=1.-u_progress*1.6;' +
    'float m=smoothstep(t,t+.04,g);float edge=smoothstep(t-.06,t,g)*(1.-m);vec4 c=mix(A(v_uv),B(v_uv),m);gl_FragColor=vec4(mix(c.rgb,vec3(.02),edge*.95),1.);}',
  smoke:
    'void main(){float p=u_progress;vec2 w=vec2(fbm(v_uv*3.+p*2.),fbm(v_uv*3.+7.-p*2.))-.5;float n=fbm(v_uv*2.5+w*1.5);' +
    'float m=smoothstep(p*1.3-.2,p*1.3,n);vec4 c=mix(B(v_uv+w*.05*(1.-p)),A(v_uv+w*.08*p),m);' +
    'float smk=smoothstep(.35,0.,abs(n-(p*1.3-.1)))*bell(p);gl_FragColor=vec4(mix(c.rgb,vec3(.85),smk*.8),1.);}',
  mosaic:
    'void main(){float p=u_progress;float cs=mix(1.,48.,bell(p))*max(1.,u_res.y/1080.);vec2 cell=floor(v_uv*u_res/cs);' +
    'vec2 uv=(cell+.5)*cs/u_res;float h=hash(cell+3.);gl_FragColor=h<p?B(uv):A(uv);}',
  'pixel-sort':
    'void main(){float p=u_progress;float k=bell(p);vec4 c=vec4(0.);vec4 a=A(v_uv),b=B(v_uv);float la=dot(a.rgb,vec3(.3,.59,.11)),lb=dot(b.rgb,vec3(.3,.59,.11));' +
    'vec4 sa=A(v_uv-vec2(0.,la*k*.35)),sb=B(v_uv-vec2(0.,lb*k*.35));gl_FragColor=mix(sa,sb,smoothstep(.35,.65,p));}',
  'glitch-2':
    'void main(){float p=u_progress;float fr=floor(p*24.);vec2 cell=floor(v_uv*vec2(8.,16.));float h=hash(cell+fr*.13);' +
    'float k=bell(p);vec2 off=vec2((hash(cell+fr)-.5)*.15*k*step(.6,h),0.);vec2 uv=v_uv+off;bool useB=h<p*1.15-.05;' +
    'float s=.02*k;vec4 c=useB?vec4(B(uv+vec2(s,0.)).r,B(uv).g,B(uv-vec2(s,0.)).b,1.):vec4(A(uv+vec2(s,0.)).r,A(uv).g,A(uv-vec2(s,0.)).b,1.);' +
    'c.rgb-=step(.5,fract(v_uv.y*u_res.y*.25))*.08*k;gl_FragColor=c;}',
  'camera-flash':
    'void main(){float p=u_progress;float pk=exp(-abs(p-.5)*14.);vec4 c=p<.5?A(v_uv):B(v_uv);gl_FragColor=vec4(mix(c.rgb*(1.+pk),vec3(1.),pk),1.);}',
  shutter:
    'void main(){float p=u_progress;float h=p<.5?p*2.:2.-p*2.;h=h*h*(3.-2.*h)*.5;vec4 c=p<.5?A(v_uv):B(v_uv);' +
    'float bar=step(v_uv.y,h)+step(1.-h,v_uv.y);gl_FragColor=vec4(c.rgb*(1.-min(1.,bar)),1.);}',
  'whip-left': WHIP_FN + 'void main(){gl_FragColor=whip(vec2(1.,0.));}',
  'whip-right': WHIP_FN + 'void main(){gl_FragColor=whip(vec2(-1.,0.));}',
  'whip-up': WHIP_FN + 'void main(){gl_FragColor=whip(vec2(0.,1.));}',
  'whip-down': WHIP_FN + 'void main(){gl_FragColor=whip(vec2(0.,-1.));}',
  'uncover-left':
    'void main(){float e=u_progress*u_progress*(3.-2.*u_progress);float x=v_uv.x+e;if(x<1.){gl_FragColor=A(vec2(x,v_uv.y));return;}' +
    'gl_FragColor=vec4(B(v_uv).rgb*(.75+.25*e),1.);}',
  'uncover-up':
    'void main(){float e=u_progress*u_progress*(3.-2.*u_progress);float y=v_uv.y+e;if(y<1.){gl_FragColor=A(vec2(v_uv.x,y));return;}' +
    'gl_FragColor=vec4(B(v_uv).rgb*(.75+.25*e),1.);}',
  'iris-close':
    'void main(){vec2 p=(v_uv-.5)*ASP();float r=(1.-u_progress)*length(ASP())*.5;float m=smoothstep(r,r+.006,length(p));' +
    'float ring=exp(-abs(length(p)-r)*60.)*bell(u_progress);vec4 c=mix(A(v_uv),B(v_uv),m);gl_FragColor=vec4(c.rgb+vec3(1.,.6,.25)*ring*.6,1.);}',
  diamond:
    'void main(){vec2 p=abs((v_uv-.5)*ASP());float d=(p.x+p.y);float r=u_progress*(ASP().x*.5+.5)*1.02;gl_FragColor=mix(B(v_uv),A(v_uv),smoothstep(r,r+.006,d));}',
  wind:
    'void main(){float p=u_progress;float r=hash(vec2(floor(v_uv.y*u_res.y/3.),1.))*.35;float th=1.-(p*1.35-r);' +
    'float m=smoothstep(th-.04,th,v_uv.x);vec4 a=A(v_uv-vec2(p*.25*(1.-m),0.));gl_FragColor=mix(a,B(v_uv),m);}',
  wave:
    'void main(){float p=u_progress;float k=bell(p);vec2 o=vec2(sin(v_uv.y*20.+p*12.)*.03*k,0.);gl_FragColor=mix(A(v_uv+o),B(v_uv-o),smoothstep(.3,.7,p));}',
  'burn-2':
    'void main(){float p=u_progress;float n=fbm(v_uv*5.)*.6+(1.-length((v_uv-vec2(.3,.6))*ASP()))*.25+(1.-length((v_uv-vec2(.75,.3))*ASP()))*.2;' +
    'float t=1.-p*1.25;float m=smoothstep(t,t+.02,n);float e=smoothstep(.08,0.,abs(n-t))*(1.-step(1.,p));' +
    'vec3 fire=mix(vec3(.5,.06,0.),vec3(1.,.55,.12),smoothstep(0.,.5,e));fire=mix(fire,vec3(1.,.95,.7),smoothstep(.6,1.,e));' +
    'vec4 c=mix(A(v_uv),B(v_uv),m);gl_FragColor=vec4(mix(c.rgb,fire,e)+fire*e*.6,1.);}',
  flare:
    'void main(){float p=u_progress;float x=mix(-.3,1.3,p);float d=abs(v_uv.x-x+(v_uv.y-.5)*.3);' +
    'float g=exp(-d*12.)*bell(p);float streak=exp(-abs(v_uv.y-.42)*60.)*bell(p);vec4 c=mix(A(v_uv),B(v_uv),smoothstep(.35,.65,p));' +
    'gl_FragColor=vec4(c.rgb+vec3(1.,.82,.55)*(g*1.3+streak*.8),1.);}',
  swirl:
    'void main(){float p=u_progress;vec2 q=(v_uv-.5)*ASP();float r=length(q);float a=bell(p)*6.*max(0.,1.-r*1.4);' +
    'vec2 uv=rot(q,a)/ASP()+.5;gl_FragColor=mix(A(uv),B(uv),smoothstep(.35,.65,p));}',
  checkerboard:
    'void main(){vec2 c=floor(v_uv*vec2(8.,8.*u_res.y/u_res.x));float par=mod(c.x+c.y,2.);float th=par*.45+hash(c)*.1;' +
    'gl_FragColor=u_progress*1.8-.4>th?B(v_uv):A(v_uv);}',
  squares:
    'void main(){vec2 G=vec2(10.,10.*u_res.y/u_res.x);vec2 c=floor(v_uv*G);vec2 f=fract(v_uv*G)-.5;float h=hash(c+1.3);' +
    'float s=clamp((u_progress-h*.6)/.4,0.,1.)*.5;gl_FragColor=(abs(f.x)<s&&abs(f.y)<s)?B(v_uv):A(v_uv);}',
  polka:
    'void main(){vec2 G=vec2(12.,12.*u_res.y/u_res.x);vec2 f=fract(v_uv*G)-.5;float r=u_progress*.72;' +
    'gl_FragColor=length(f)<r?B(v_uv):A(v_uv);}',
  'film-roll':
    'void main(){float e=u_progress*u_progress*(3.-2.*u_progress);float y=v_uv.y+e*1.06;float gap=.06;vec4 c;' +
    'if(y<1.)c=A(vec2(v_uv.x,y));else if(y<1.+gap)c=vec4(vec3(.04),1.);else c=B(vec2(v_uv.x,y-1.-gap));' +
    'float b=bell(u_progress)*.012;c.rgb*=1.-.15*bell(u_progress);gl_FragColor=vec4(c.rgb,1.);}',
  'tv-off':
    'void main(){float p=u_progress;float q=p<.5?p*2.:2.-p*2.;float h=max(1.-smoothstep(0.,.7,q),.004);float w=max(1.-smoothstep(.7,1.,q),.004);' +
    'vec2 uv=(v_uv-.5)/vec2(w,h)+.5;if(!inb(uv)){gl_FragColor=' + blk + ';return;}vec4 c=p<.5?A(uv):B(uv);' +
    'float glow=smoothstep(.3,1.,q);gl_FragColor=vec4(mix(c.rgb,vec3(1.),glow),1.);}',
  kaleido:
    'void main(){float p=u_progress;float k=bell(p);vec2 q=(v_uv-.5)*ASP();float r=length(q);float a=atan(q.y,q.x);float sg=1.0471976;' +
    'float ak=abs(mod(a,sg)-sg*.5);vec2 kq=vec2(cos(ak),sin(ak))*r;vec2 uv=mix(v_uv,rot(kq,p*2.)/ASP()+.5,k);gl_FragColor=mix(A(uv),B(uv),smoothstep(.4,.6,p));}',
  dreamy:
    'void main(){float p=u_progress;float k=bell(p);vec2 o=vec2(sin(v_uv.y*10.+p*6.),cos(v_uv.x*8.+p*5.))*.012*k;vec4 a=vec4(0.),b=vec4(0.);' +
    'for(int i=0;i<8;i++){float f=float(i)*.785;vec2 d=vec2(cos(f),sin(f))*.012*k;a+=A(v_uv+o+d);b+=B(v_uv-o+d);}' +
    'vec4 c=mix(a,b,smoothstep(.3,.7,p))/8.;gl_FragColor=vec4(c.rgb+vec3(.18*k),1.);}',
  'zoom-rotate':
    'void main(){float p=u_progress;vec2 q=(v_uv-.5)*ASP();float e=p*p*(3.-2.*p);vec2 ua=rot(q/(1.+e*1.5),e*1.2)/ASP()+.5;' +
    'vec2 ub=rot(q*(1.+(1.-e)*1.5),-(1.-e)*1.2)/ASP()+.5;vec4 a=inb(ua)?A(ua):' + blk + ';vec4 b=inb(ub)?B(ub):' + blk + ';gl_FragColor=mix(a,b,smoothstep(.4,.6,p));}',
};

export const FX_SHADER_TRANSITION_KINDS = Object.keys(F);

const cache = new Map<string, string>();
/** fonte completa do shader da transição nova (null = não é desta tabela) */
export function fxTransitionFragment(kind: string): string | null {
  const body = F[kind];
  if (!body) return null;
  let src = cache.get(kind);
  if (!src) { src = HEAD + body; cache.set(kind, src); }
  return src;
}
