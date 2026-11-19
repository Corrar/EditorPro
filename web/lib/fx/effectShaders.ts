/* =====================================================================
   Efeitos por pixel em GLSL (WebGL 1 / GLSL ES 1.00). Escritos para o
   EditorPro (sem código de terceiros). Convenções:
   - u_tex chega PRÉ-MULTIPLICADA; saída também pré-multiplicada
     (use pm(cor, alfa) depois de mexer na cor "despremultiplicada" unp()).
   - v_uv: (0,0) = canto superior esquerdo.
   - u_int = intensidade 0..1; u_time = tempo × velocidade; u_angle em
     radianos; u_color = cor do efeito (0..1).
   ===================================================================== */
import type { VisualEffectKind } from '../types';
import { GLSL_PRECISION } from './glcore';

const HEAD = GLSL_PRECISION +
  'varying vec2 v_uv;uniform sampler2D u_tex;uniform vec2 u_res;uniform float u_time,u_int,u_angle;uniform vec3 u_color;\n' +
  'vec4 T(vec2 uv){return texture2D(u_tex,clamp(uv,0.,1.));}' +
  'vec4 TB(vec2 uv){return (uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)?vec4(0.):texture2D(u_tex,uv);}' +
  'vec3 unp(vec4 c){return c.a>.0001?c.rgb/c.a:vec3(0.);}' +
  'vec4 pm(vec3 c,float a){return vec4(clamp(c,0.,1.)*a,a);}' +
  'float lum(vec3 c){return dot(c,vec3(.299,.587,.114));}' +
  'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}' +
  'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);' +
  'return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}' +
  'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}' +
  'vec2 ASP(){return vec2(u_res.x/u_res.y,1.);}' +
  /* desfoque em espiral de ouro (32 amostras), raio em fração da altura */
  'vec4 spiral(vec2 uv,float r){if(r<.0005)return T(uv);vec4 a=vec4(0.);vec2 k=vec2(u_res.y/u_res.x,1.);' +
  'for(int i=0;i<32;i++){float f=float(i);float an=f*2.39996;float d=sqrt((f+.5)/32.)*r;a+=T(uv+vec2(cos(an),sin(an))*d*k);}return a/32.;}' +
  /* borda de Sobel na luminância (passo proporcional à resolução) */
  'float sobel(vec2 uv,float s){vec2 p=s*max(1.,u_res.y/720.)/u_res;' +
  'float tl=lum(T(uv-p).rgb),tc=lum(T(uv+vec2(0.,-p.y)).rgb),tr=lum(T(uv+vec2(p.x,-p.y)).rgb),' +
  'l=lum(T(uv+vec2(-p.x,0.)).rgb),r=lum(T(uv+vec2(p.x,0.)).rgb),' +
  'bl=lum(T(uv+vec2(-p.x,p.y)).rgb),bc=lum(T(uv+vec2(0.,p.y)).rgb),br=lum(T(uv+p).rgb);' +
  'float gx=tr+2.*r+br-tl-2.*l-bl;float gy=bl+2.*bc+br-tl-2.*tc-tr;return length(vec2(gx,gy));}' +
  'vec3 hrot(vec3 c,float a){vec3 k=vec3(.57735);float ca=cos(a);return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.-ca);}\n';

const B: Partial<Record<VisualEffectKind, string>> = {
  /* ---------- desfoques ---------- */
  'blur-gauss': 'gl_FragColor=spiral(v_uv,u_int*.035);',
  'blur-directional':
    'vec2 d=vec2(cos(u_angle),sin(u_angle))*u_int*.09*vec2(u_res.y/u_res.x,1.);vec4 a=vec4(0.);' +
    'for(int i=0;i<24;i++){a+=T(v_uv+d*(float(i)/23.-.5));}gl_FragColor=a/24.;',
  'blur-radial':
    'vec2 p=(v_uv-.5)*ASP();float ang=u_int*.3;vec4 a=vec4(0.);' +
    'for(int i=0;i<24;i++){float f=(float(i)/23.-.5)*ang;float s=sin(f),c=cos(f);a+=T(vec2(p.x*c-p.y*s,p.x*s+p.y*c)/ASP()+.5);}gl_FragColor=a/24.;',
  'blur-zoom':
    'vec2 c=vec2(.5);vec4 a=vec4(0.);for(int i=0;i<24;i++){float s=1.-u_int*.28*float(i)/23.;a+=T(c+(v_uv-c)*s);}gl_FragColor=a/24.;',
  'tilt-shift':
    'float d=abs(v_uv.y-.5);vec4 b=spiral(v_uv,smoothstep(.08,.42,d)*u_int*.03);vec3 c=unp(b);' +
    'c=mix(vec3(lum(c)),c,1.+.35*u_int);c=(c-.5)*(1.+.12*u_int)+.5;gl_FragColor=pm(c,b.a);',
  'focus-center':
    'float d=length((v_uv-.5)*ASP());vec4 b=spiral(v_uv,smoothstep(.16,.6,d)*u_int*.035);' +
    'gl_FragColor=pm(unp(b)*(1.-smoothstep(.3,.95,d)*.35*u_int),b.a);',
  'soft-glow':
    'vec4 c=T(v_uv);vec4 b=spiral(v_uv,.025);vec3 g=unp(b)*1.15;vec3 o=1.-(1.-unp(c))*(1.-g*.65*u_int);gl_FragColor=pm(o,c.a);',

  /* ---------- distorção ---------- */
  fisheye:
    'vec2 p=v_uv-.5;float r=length(p*ASP())/length(ASP()*.5);gl_FragColor=TB(.5+p*pow(max(r,1e-4),u_int*.9));',
  bulge:
    'vec2 pa=(v_uv-.5)*ASP();float R=.48;float r=length(pa);float k=u_int*.85*(.8+.2*sin(u_time*2.));' +
    'vec2 q=r<R?pa*pow(max(r/R,1e-4),k):pa;gl_FragColor=TB(q/ASP()+.5);',
  pinch:
    'vec2 pa=(v_uv-.5)*ASP();float R=.48;float r=length(pa);float k=u_int*.55*(.8+.2*sin(u_time*2.));' +
    'vec2 q=r<R?pa*pow(max(r/R,1e-3),-k):pa;gl_FragColor=TB(q/ASP()+.5);',
  swirl:
    'vec2 pa=(v_uv-.5)*ASP();float R=.6;float r=length(pa);vec2 q=pa;' +
    'if(r<R){float a=u_int*5.*pow(1.-r/R,2.)*(.85+.15*sin(u_time*1.5));float s=sin(a),c=cos(a);q=vec2(pa.x*c-pa.y*s,pa.x*s+pa.y*c);}' +
    'gl_FragColor=TB(q/ASP()+.5);',
  waves:
    'vec2 uv=v_uv;uv.x+=sin(uv.y*18.+u_time*4.)*.013*u_int;uv.y+=sin(uv.x*14.+u_time*3.)*.009*u_int;gl_FragColor=T(uv);',
  'heat-haze':
    'float n=fbm(vec2(v_uv.x*5.,v_uv.y*9.-u_time*1.6));float m=fbm(v_uv*7.+vec2(0.,u_time));' +
    'gl_FragColor=T(v_uv+vec2((n-.5)*.032,(m-.5)*.012)*u_int);',
  ripple:
    'vec2 p=(v_uv-.5)*ASP();float d=length(p);vec2 dir=p/max(d,1e-4);' +
    'float w=sin(d*55.-u_time*7.)*.007*u_int*(1.-smoothstep(.2,1.,d));gl_FragColor=T(v_uv+dir/ASP()*w);',
  'kaleidoscope-6':
    'vec2 p=(v_uv-.5)*ASP();float r=length(p);float a=atan(p.y,p.x)+u_time*.15;float sg=1.0471976;' +
    'a=mod(a,sg);a=abs(a-sg*.5);vec2 q=vec2(cos(a),sin(a))*r;gl_FragColor=mix(T(v_uv),T(q/ASP()+.5),u_int);',

  /* ---------- glitch ---------- */
  'glitch-digital':
    'float fr=floor(u_time*12.);float on=step(.45,hash(vec2(fr,1.7)));float k=u_int*(.25+.75*on);' +
    'vec2 b=floor(v_uv*vec2(10.,18.));float br=hash(b+fr);vec2 off=vec2((hash(b*1.3+fr)-.5)*.2,0.)*step(.82,br)*k;' +
    'float ln=floor(v_uv.y*90.);off.x+=(hash(vec2(ln,fr))-.5)*.035*k*step(.7,hash(vec2(ln*.7,fr)));' +
    'vec2 uv=v_uv+off;float s=.012*k;vec4 c=T(uv);vec4 o=vec4(T(uv+vec2(s,0.)).r,c.g,T(uv-vec2(s,0.)).b,c.a);' +
    'if(step(.94,br)*k>.4)o.rgb=o.a-o.rgb;gl_FragColor=o;',
  datamosh:
    'float fr=floor(u_time*6.);vec2 G=vec2(24.,40.);vec2 cell=floor(v_uv*G);float h=hash(cell+fr*.37);float m=step(1.-u_int*.65,h);' +
    'vec2 drift=(vec2(hash(cell+3.1),hash(cell+7.7))-.5)*.09*u_int*fract(u_time*6.)*m;vec2 uv=v_uv-drift;' +
    'vec2 q=(floor(uv*G)+.5)/G;vec4 c=mix(T(uv),T(q),m*.65);vec3 col=unp(c);col=mix(col,floor(col*6.)/6.,m*.5);gl_FragColor=pm(col,c.a);',
  'chromatic-aberration':
    'vec2 p=v_uv-.5;vec2 s=p*u_int*.04*(.35+dot(p,p)*4.);vec4 c=T(v_uv);gl_FragColor=vec4(T(v_uv+s).r,c.g,T(v_uv-s).b,c.a);',
  'rgb-wave':
    'float o=sin(v_uv.y*12.+u_time*5.)*.013*u_int;vec4 c=T(v_uv);gl_FragColor=vec4(T(v_uv+vec2(o,0.)).r,c.g,T(v_uv-vec2(o,0.)).b,c.a);',
  'pixel-sort':
    'vec4 best=T(v_uv);float bl=lum(unp(best));float thr=.78-.38*u_int;float L=.28*u_int;' +
    'for(int i=1;i<24;i++){vec4 s=T(v_uv-vec2(0.,float(i)/23.*L));float l=lum(unp(s));if(l>thr&&l>bl){best=s;bl=l;}}gl_FragColor=best;',

  /* ---------- retrô ---------- */
  crt:
    'vec2 p=v_uv-.5;vec2 uv=p*(1.+.24*u_int*dot(p,p))+.5;vec4 c=TB(uv);vec3 col=unp(c);' +
    'float sl=.5+.5*sin(uv.y*u_res.y*1.1);col*=1.-.35*u_int*(1.-sl);float m=mod(floor(v_uv.x*u_res.x/1.5),3.);' +
    'vec3 mk=vec3(m<.5?1.:.72,(m>.5&&m<1.5)?1.:.72,m>1.5?1.:.72);col*=mix(vec3(1.),mk,.6*u_int);' +
    'col*=1.-.6*u_int*smoothstep(.3,.75,length(p));col*=1.+.04*sin(u_time*50.);gl_FragColor=pm(col*(1.+.15*u_int),c.a);',
  'vhs-2':
    'float ln=floor(v_uv.y*u_res.y/3.);float tb=1.-smoothstep(0.,.05,abs(v_uv.y-fract(u_time*.13)));' +
    'float j=(vnoise(vec2(ln*.05,u_time*8.))-.5)*.012*u_int+tb*.03*u_int*(hash(vec2(ln,floor(u_time*24.)))-.5)*2.;' +
    'vec2 uv=v_uv+vec2(j,0.);vec4 c=T(uv);vec3 col=unp(c);float s=.006*u_int;' +
    'col=vec3(mix(col.r,unp(T(uv+vec2(s,0.))).r,.6),col.g,mix(col.b,unp(T(uv-vec2(s,0.))).b,.6));' +
    'col=mix(col,vec3(lum(col)),.25*u_int);col+=(hash(v_uv*u_res+fract(u_time)*91.)-.5)*.12*u_int+tb*.3*u_int*hash(vec2(v_uv.x*u_res.x,ln)+u_time);' +
    'col*=.95+.05*sin(v_uv.y*u_res.y*1.5);gl_FragColor=pm(col,c.a);',
  'film-8mm':
    'float fr=floor(u_time*18.);vec2 wv=(vec2(hash(vec2(fr,1.)),hash(vec2(fr,2.)))-.5)*.006*u_int;vec4 c=T(v_uv+wv);vec3 col=unp(c);' +
    'float l=lum(col);col=mix(col,vec3(l*1.08+.04,l*.92+.02,l*.72),.7*u_int);col*=.9+.12*hash(vec2(fr,9.));' +
    'col+=(hash(floor(v_uv*u_res*.5)+fr)-.5)*.18*u_int;' +
    'for(int i=0;i<2;i++){float sx=hash(vec2(fr,float(i)+5.));float on=step(.55,hash(vec2(fr,float(i)+11.)));' +
    'col-=on*u_int*.5*(1.-smoothstep(0.,.0016,abs(v_uv.x-sx)));}' +
    'float dust=step(.9985,hash(floor(v_uv*u_res/3.)+fr));col=mix(col,vec3(.06),dust*u_int);' +
    'col*=1.-.7*u_int*smoothstep(.35,.8,length((v_uv-.5)*vec2(1.,1.2)));gl_FragColor=pm(col,c.a);',
  'night-vision':
    'vec4 c=T(v_uv);float l=pow(lum(unp(c)),.8)*1.4;vec3 g=vec3(.12,1.,.22)*l;g+=(hash(v_uv*u_res+fract(u_time)*100.)-.5)*.25;' +
    'g*=.85+.15*sin(v_uv.y*u_res.y*.8);g*=1.-smoothstep(.3,.78,length(v_uv-.5));gl_FragColor=pm(mix(unp(c),g,u_int),c.a);',

  /* ---------- luz ---------- */
  bloom:
    'vec4 c=T(v_uv);vec4 a=vec4(0.);vec2 k=vec2(u_res.y/u_res.x,1.);float r=.03+.035*u_int;' +
    'for(int i=0;i<24;i++){float f=float(i);float an=f*2.39996;float d=sqrt((f+.5)/24.)*r;vec4 s=T(v_uv+vec2(cos(an),sin(an))*d*k);' +
    'a+=s*smoothstep(.55,.95,lum(unp(s)));}vec3 g=a.rgb/24.*2.*u_int;' +
    'float oa=max(c.a,min(1.,max(g.r,max(g.g,g.b))));gl_FragColor=vec4(min(c.rgb+g,vec3(oa)),oa);',
  'neon-glow':
    'float e=sobel(v_uv,1.);float eg=0.;for(int i=0;i<4;i++){float an=float(i)*1.5708+.785;eg+=sobel(v_uv+vec2(cos(an),sin(an))*5.*max(1.,u_res.y/720.)/u_res,1.);}' +
    'eg*=.25;vec4 c=T(v_uv);vec3 col=unp(c)*(1.-.75*u_int);col+=u_color*(smoothstep(.1,.4,e)*1.4+eg*1.3)*u_int;gl_FragColor=pm(col,c.a);',

  /* ---------- estilizar ---------- */
  cartoon:
    'vec4 c=T(v_uv);vec2 p=max(1.,u_res.y/720.)/u_res;vec3 s=(unp(c)*2.+unp(T(v_uv+vec2(p.x,0.)))+unp(T(v_uv-vec2(p.x,0.)))+unp(T(v_uv+vec2(0.,p.y)))+unp(T(v_uv-vec2(0.,p.y))))/6.;' +
    'vec3 q=floor(s*6.+.5)/6.;q=mix(vec3(lum(q)),q,1.25);q*=1.-smoothstep(.22,.5,sobel(v_uv,1.));gl_FragColor=pm(mix(unp(c),q,u_int),c.a);',
  sketch:
    'vec4 c=T(v_uv);float e=sobel(v_uv,1.);float l=lum(unp(c));vec2 px=v_uv*u_res/max(1.,u_res.y/720.);float h=0.;' +
    'if(l<.55)h+=step(.5,fract((px.x+px.y)/7.))*.22;if(l<.3)h+=step(.5,fract((px.x-px.y)/7.))*.25;' +
    'float ink=clamp(e*1.7+h,0.,1.);gl_FragColor=pm(mix(unp(c),vec3(.97,.95,.9)*(1.-ink),u_int),c.a);',
  halftone:
    'float cs=(6.+9.*u_int)*max(1.,u_res.y/1080.);vec2 px=v_uv*u_res;float ca=.7071,sa=.7071;' +
    'vec2 q=vec2(ca*px.x-sa*px.y,sa*px.x+ca*px.y);vec2 cl=(floor(q/cs)+.5)*cs;vec2 cp=vec2(ca*cl.x+sa*cl.y,-sa*cl.x+ca*cl.y);' +
    'vec4 cc=T(cp/u_res);vec3 col=unp(cc);float rad=sqrt(1.-lum(col))*cs*.62;float dt=1.-smoothstep(rad-1.,rad+1.,length(q-cl));' +
    'vec4 c=T(v_uv);gl_FragColor=pm(mix(unp(c),mix(vec3(.98,.97,.94),col*.85,dt),smoothstep(0.,.25,u_int)),c.a);',
  duotone:
    'vec4 c=T(v_uv);float l=lum(unp(c));gl_FragColor=pm(mix(unp(c),mix(vec3(.09,.05,.25),u_color,smoothstep(.05,.95,l)),u_int),c.a);',
  posterize:
    'vec4 c=T(v_uv);float n=mix(14.,3.,u_int);gl_FragColor=pm(floor(unp(c)*n+.5)/n,c.a);',
  ascii:
    'float cs=(7.+5.*(1.-u_int))*max(1.,u_res.y/720.);vec2 px=v_uv*u_res;vec2 cell=floor(px/cs);vec2 q=fract(px/cs)-.5;' +
    'vec4 cc=T((cell+.5)*cs/u_res);vec3 col=unp(cc);float l=lum(col);float g=0.;' +
    'if(l>.75)g=max(step(abs(abs(q.x)-.18),.05),step(abs(abs(q.y)-.18),.05))*step(max(abs(q.x),abs(q.y)),.42);' +
    'else if(l>.55)g=max(step(abs(q.x),.06)*step(abs(q.y),.35),step(abs(q.y),.06)*step(abs(q.x),.35));' +
    'else if(l>.35)g=max(step(length(q-vec2(0.,.18)),.1),step(length(q+vec2(0.,.18)),.1));' +
    'else if(l>.15)g=step(length(q-vec2(0.,.2)),.1);vec4 c=T(v_uv);' +
    'gl_FragColor=pm(mix(unp(c),col*g*1.5,smoothstep(0.,.3,u_int)),c.a);',
  'pixel-art':
    'float cs=(3.+13.*u_int)*max(1.,u_res.y/1080.);vec4 cc=T((floor(v_uv*u_res/cs)+.5)*cs/u_res);gl_FragColor=pm(floor(unp(cc)*5.+.5)/5.,cc.a);',
  outline:
    'float e=smoothstep(.15,.45,sobel(v_uv,1.));vec4 c=T(v_uv);gl_FragColor=pm(mix(unp(c),u_color,e*u_int),c.a);',
  thermal:
    'vec4 c=T(v_uv);float x=lum(unp(c));vec3 a=mix(vec3(0.,0.,.2),vec3(.5,0.,.8),smoothstep(0.,.25,x));' +
    'a=mix(a,vec3(1.,0.,.2),smoothstep(.25,.5,x));a=mix(a,vec3(1.,.8,0.),smoothstep(.5,.75,x));a=mix(a,vec3(1.),smoothstep(.75,1.,x));' +
    'gl_FragColor=pm(mix(unp(c),a,u_int),c.a);',
  invert: 'vec4 c=T(v_uv);vec3 col=unp(c);gl_FragColor=pm(mix(col,1.-col,u_int),c.a);',
  rainbow:
    'vec4 c=T(v_uv);vec3 col=unp(c);vec3 h=hrot(col,u_time*2.+v_uv.x*2.5+v_uv.y);h=mix(vec3(lum(h)),h,1.4);gl_FragColor=pm(mix(col,h,u_int),c.a);',
};

export const EFFECT_SHADER_KINDS = Object.keys(B) as VisualEffectKind[];

export function isGLEffect(kind: VisualEffectKind): boolean {
  return Object.prototype.hasOwnProperty.call(B, kind);
}

const cache = new Map<string, string>();
/** fonte completa do fragment shader do efeito (null = não é efeito em shader) */
export function effectFragment(kind: VisualEffectKind): string | null {
  const body = B[kind];
  if (!body) return null;
  let src = cache.get(kind);
  if (!src) { src = HEAD + 'void main(){' + body + '}'; cache.set(kind, src); }
  return src;
}
