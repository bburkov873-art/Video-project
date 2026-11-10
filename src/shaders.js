// GLSL sources. Planet surfaces are baked once into equirect textures (BAKE_FS),
// so per-frame shading stays cheap enough for software WebGL.

export const NOISE = /* glsl */ `
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
vec3 hash33(vec3 p){ p = fract(p*vec3(.1031,.1030,.0973)); p += dot(p, p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float vnoise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<7;i++){ s+=a*vnoise(p); p=p*2.03+vec3(17.1,3.7,9.2); a*=.5; } return s; }
float craters(vec3 p, float scale){
  vec3 q=p*scale, i=floor(q), f=fract(q); float res=0.;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
    vec3 g=vec3(float(x),float(y),float(z)); vec3 o=hash33(i+g);
    float on=step(0.45,hash13(i+g+3.3));
    float r=0.14+0.3*hash13(i+g+7.7);
    float d=length(g+o-f)/r;
    res += on*(smoothstep(1.35,1.0,d)*smoothstep(0.7,1.0,d)*0.5 - smoothstep(0.95,0.3,d)*0.28);
  }
  return res;
}
`;

export const RING = /* glsl */ `
float h11(float n){ return fract(sin(n*127.1)*43758.5453); }
float rn(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(h11(i),h11(i+1.),f); }
// kind 1: Saturn (C, B, Cassini division, A, Encke gap, F), kind 2: Uranus (thin dark rings)
float ringDensity(float t, float fw, float kind){
  if(t<0.||t>1.) return 0.;
  if(kind>1.5){
    float d=0.;
    for(int k=0;k<5;k++){ float tk=0.12+0.17*float(k); d+=0.26*smoothstep(0.014+fw,0.,abs(t-tk)); }
    d+=0.5*smoothstep(0.024+fw,0.,abs(t-0.95));
    return clamp(d,0.,0.9);
  }
  float base=mix(0.10,0.24,smoothstep(0.0,0.22,t));
  base=mix(base,0.92,smoothstep(0.20,0.25,t));
  base=mix(base,0.03,smoothstep(0.595,0.61,t));
  base=mix(base,0.62,smoothstep(0.655,0.67,t));
  base*=1.-0.92*(smoothstep(0.872,0.878,t)*smoothstep(0.892,0.886,t));
  base*=smoothstep(0.962,0.948,t);
  base+=0.35*smoothstep(0.004+fw,0.0,abs(t-0.985));
  float n=0., a=0.5, f=24.;
  for(int i=0;i<7;i++){ float w=clamp(1.-fw*f*2.,0.,1.); n+=a*w*(rn(t*f+float(i)*13.7)-0.5); f*=2.6; a*=0.74; }
  return clamp(base*(1.+1.2*n),0.,0.97)*smoothstep(0.,0.012,t);
}
vec3 ringColor(float t, float kind, float fw){
  if(kind>1.5) return vec3(0.45,0.6,0.75);
  vec3 c=mix(vec3(0.50,0.39,0.26), vec3(0.98,0.86,0.66), smoothstep(0.08,0.5,t));
  c=mix(c, vec3(0.82,0.75,0.64), smoothstep(0.62,0.9,t));
  return c*(0.72+0.56*rn(t*70.))*(0.86+0.28*rn(t*420.)*clamp(1.-fw*840.,0.,1.));
}
`;

export const BAKE_VS = /* glsl */ `
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }
`;

export const BAKE_FS = /* glsl */ `
varying vec2 vUv;
uniform vec3 uA; // per-type direction parameter (spot centre / galactic normal)
uniform vec3 uB;

float spot(vec3 p, vec3 c, float rx, float ry, out float ang){
  vec3 e=normalize(cross(vec3(0.,1.,0.),c)); vec3 nn=cross(c,e);
  float dx=dot(p,e)/rx, dy=dot(p,nn)/ry; ang=atan(dy,dx);
  return dot(p,c)>0. ? sqrt(dx*dx+dy*dy) : 99.;
}

#if TYPE==2 || TYPE==3
void earthBase(vec3 p, out float land, out float ice, out float cl, out float h){
  h = fbm(p*1.7+vec3(3.1,1.7,5.3)) + 0.25*(fbm(p*6.+2.)-0.5);
  land = smoothstep(0.55,0.562,h);
  ice = smoothstep(0.80,0.88, abs(p.y)+0.1*(fbm(p*6.+7.)-0.5));
  vec3 w = vec3(fbm(p*2.5+5.), fbm(p*2.5+9.), fbm(p*2.5+13.));
  cl = smoothstep(0.52,0.75, fbm(p*3.2 + 2.2*w));
}
#endif

vec4 surf(vec3 p){
#if TYPE==0 // Mercury
  float n=fbm(p*4.);
  float c=craters(p,5.)+0.7*craters(p,11.)+0.45*craters(p,25.);
  float v=0.36+0.34*(n-0.5)+0.36*c;
  return vec4(vec3(v)*vec3(1.0,0.94,0.86),1.);
#elif TYPE==1 // Venus
  vec3 q=vec3(p.x,p.y*2.6,p.z);
  float n=fbm(q*1.4 + 1.6*vec3(fbm(q*2.+3.), fbm(q*2.+11.), fbm(q*2.+17.)));
  vec3 col=mix(vec3(0.70,0.40,0.11), vec3(1.0,0.82,0.44), smoothstep(0.28,0.72,n));
  col*=0.9+0.2*fbm(q*9.);
  return vec4(col,1.);
#elif TYPE==2 // Earth day; alpha = ocean specular mask
  float land,ice,cl,h; earthBase(p,land,ice,cl,h);
  vec3 ocean=mix(vec3(0.008,0.04,0.17), vec3(0.03,0.2,0.38), smoothstep(0.45,0.55,h));
  float dry=smoothstep(0.60,0.74,h+0.12*(fbm(p*9.)-.5)) ;
  vec3 landc=mix(vec3(0.035,0.14,0.035), vec3(0.33,0.26,0.13), dry);
  landc=mix(landc, vec3(0.42,0.33,0.18), smoothstep(0.16,0.04,abs(abs(p.y)-0.36))*0.4); // desert belts
  vec3 col=mix(ocean,landc,land);
  col=mix(col,vec3(0.9,0.93,0.97),ice);
  col=mix(col,vec3(1.),cl*0.85);
  return vec4(col,(1.-land)*(1.-ice)*(1.-cl));
#elif TYPE==3 // Earth city lights
  float land,ice,cl,h; earthBase(p,land,ice,cl,h);
  // metro areas (low frequency) broken into street-scale dots, plus a thin coastal fringe
  float metro=smoothstep(0.55,0.68,fbm(p*10.+40.));
  float dots=smoothstep(0.74,0.9,vnoise(p*170.));
  float coast=smoothstep(0.60,0.565,h)*smoothstep(0.45,0.6,fbm(p*10.+3.));
  float l=land*(1.-ice)*(metro*(0.012+dots)+0.6*coast*dots)*(1.-0.75*cl);
  return vec4(vec3(1.0,0.5,0.16)*l,1.);
#elif TYPE==4 // Moon
  float maria=smoothstep(0.5,0.6,fbm(p*1.6+8.));
  float c=craters(p,4.)+0.7*craters(p,9.)+0.4*craters(p,21.);
  float v=0.55-0.24*maria+0.2*(fbm(p*6.)-.5)+0.3*c;
  return vec4(vec3(v)*vec3(0.98,0.97,1.0),1.);
#elif TYPE==5 // Mars
  float n=fbm(p*2.5+4.);
  vec3 col=mix(vec3(0.50,0.19,0.07), vec3(0.88,0.47,0.23), clamp(n*1.5-0.25,0.,1.));
  float dark=smoothstep(0.52,0.68,fbm(p*1.8+20.));
  col*=1.-0.5*dark;
  col*=0.85+0.3*fbm(p*14.);
  col+=0.12*craters(p,8.)+0.08*craters(p,19.);
  float cap=smoothstep(0.88,0.94,abs(p.y)+0.06*(fbm(p*7.)-.5));
  col=mix(col,vec3(0.95,0.93,0.9),cap);
  return vec4(col,1.);
#elif TYPE==6 // Jupiter
  float ang; float d=spot(p,normalize(uA),0.2,0.115,ang);
  float warp=fbm(vec3(p.x*3.,p.y*9.,p.z*3.)+2.)-0.5;
  float fine=fbm(vec3(p.x*11.,p.y*24.,p.z*11.)+4.*warp)-0.5;
  float y=p.y+0.055*warp+0.024*fine;
  y+=0.05*exp(-d*d*0.35)*sign(p.y-normalize(uA).y); // bands bend around the spot
  float band=0.5+0.5*sin(y*23.+1.6*sin(y*7.));
  vec3 zone=vec3(0.84,0.76,0.61), belt=vec3(0.54,0.30,0.15);
  vec3 col=mix(belt,zone,smoothstep(0.25,0.75,band));
  col=mix(col,vec3(0.50,0.24,0.12),0.55*smoothstep(0.5,0.1,band)*smoothstep(0.42,0.1,abs(y)));
  col*=0.86+0.3*fbm(vec3(p.x*2.,p.y*34.,p.z*2.));
  col*=0.9+0.35*fine;
  col=mix(col,vec3(0.40,0.42,0.5),smoothstep(0.68,0.96,abs(p.y)));
  float sw=vnoise(vec3(ang*1.5+d*7., d*5., 1.));
  vec3 grs=vec3(0.74,0.24,0.10)*(0.8+0.4*sw);
  col=mix(col,vec3(0.95,0.88,0.76),0.55*smoothstep(1.5,1.1,d)*smoothstep(0.9,1.1,d));
  col=mix(col,grs,smoothstep(1.05,0.75,d));
  return vec4(col,1.);
#elif TYPE==7 // Saturn
  float y=p.y+0.012*(fbm(vec3(p.x*3.,p.y*8.,p.z*3.))-.5);
  float band=0.5+0.5*sin(y*30.+2.*sin(y*9.));
  vec3 col=mix(vec3(0.58,0.44,0.25), vec3(0.84,0.71,0.47), 0.55*band+0.45*fbm(vec3(p.x,p.y*14.,p.z)));
  col*=0.92+0.16*fbm(vec3(p.x*6.,p.y*40.,p.z*6.));
  col=mix(col,vec3(0.5,0.58,0.62),smoothstep(0.72,0.97,abs(p.y)));
  return vec4(col,1.);
#elif TYPE==8 // Uranus
  vec3 col=vec3(0.50,0.84,0.90)*(0.95+0.06*sin(p.y*13.+fbm(p*3.)));
  col=mix(col,vec3(0.72,0.93,0.95),smoothstep(0.55,0.95,p.y)*0.5);
  return vec4(col,1.);
#elif TYPE==9 // Neptune
  float ang; float d=spot(p,normalize(uA),0.2,0.11,ang);
  vec3 col=vec3(0.10,0.24,0.78)*(0.8+0.4*fbm(vec3(p.x*2.,p.y*10.,p.z*2.)));
  col=mix(col,vec3(0.06,0.42,0.85),0.35*(0.5+0.5*sin(p.y*9.)));
  float w=smoothstep(0.66,0.8,fbm(vec3(p.x*4.,p.y*24.,p.z*4.)+9.));
  col=mix(col,vec3(0.8,0.9,1.),w*0.55);
  col=mix(col,vec3(0.03,0.08,0.38),smoothstep(1.,0.6,d)*0.8);
  col=mix(col,vec3(0.85,0.93,1.),0.6*smoothstep(1.5,1.1,d)*smoothstep(0.9,1.1,d)*step(0.,sin(ang)));
  return vec4(col,1.);
#else // Milky Way sky, linear HDR
  vec3 g=normalize(uA), core=normalize(uB);
  float d=dot(p,g);
  float n=fbm(p*3.+1.), n2=fbm(p*7.+n*2.);
  float band=exp(-d*d*16.);
  float dust=smoothstep(0.44,0.68,fbm(p*5.+vec3(4.)+1.6*n))*exp(-d*d*50.);
  vec3 col=vec3(0.0022,0.0050,0.0165)+vec3(0.000,0.0035,0.011)*n;
  float cg=exp(-(1.-dot(p,core))*5.);
  vec3 glow=mix(vec3(0.07,0.13,0.40), vec3(0.30,0.24,0.46), n);
  glow=mix(glow, vec3(0.50,0.40,0.42), cg*0.7);
  col+=band*(0.25+2.0*n2*n2)*(0.55+1.3*cg)*glow*0.20;
  col*=1.-0.8*dust;
  float neb=smoothstep(0.58,0.85,fbm(p*2.1+30.));
  float neb2=smoothstep(0.6,0.86,fbm(p*2.6+71.));
  col+=neb*vec3(0.008,0.028,0.075)*(0.5+fbm(p*9.));
  col+=neb2*vec3(0.03,0.010,0.055)*(0.5+fbm(p*8.+5.));
  return vec4(col,1.);
#endif
}

void main(){
  float phi=vUv.x*6.28318530718, th=(1.-vUv.y)*3.14159265359;
  vec3 p=vec3(-cos(phi)*sin(th), cos(th), sin(phi)*sin(th));
  vec4 c=surf(p);
#if TYPE<10
  c.rgb=sqrt(clamp(c.rgb,0.,1.)); // gamma 2 keeps 8-bit darks smooth; decoded in PLANET_FS
#endif
  gl_FragColor=c;
}
`;

export const WORLD_VS = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec2 vUv; varying vec3 vO;
void main(){
  vUv=uv; vO=position;
  vN=normalize(mat3(modelMatrix)*normal);
  vec4 wp=modelMatrix*vec4(position,1.); vP=wp.xyz;
  gl_Position=projectionMatrix*viewMatrix*wp;
}
`;

// The sun sits at the world origin, so the light direction is -vP.
export const PLANET_FS = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec2 vUv;
uniform sampler2D map; uniform sampler2D nightMap;
uniform float hasNight, spec, atmPow, atmStr, ringKind, ringIn, ringOut;
uniform vec3 atmColor, center, ringN;
void main(){
  vec3 N=normalize(vN), L=normalize(-vP), V=normalize(cameraPosition-vP);
  vec4 tex=texture2D(map,vUv); tex.rgb*=tex.rgb;
  float ndl=dot(N,L);
  float lit=smoothstep(-0.1,1.0,ndl);
  float sh=1.;
  if(ringKind>0.5){
    float dn=dot(L,ringN); vec3 rel=vP-center;
    float tt=-dot(rel,ringN)/dn;
    if(tt>0.){ float r=length(rel+L*tt); sh=1.-0.82*ringDensity((r-ringIn)/(ringOut-ringIn),0.004,ringKind); }
  }
  vec3 col=tex.rgb*lit*sh*0.95;
  col+=texture2D(nightMap,vUv).rgb*smoothstep(0.08,-0.22,ndl)*1.25*hasNight;
  vec3 Hh=normalize(L+V);
  col+=vec3(1.,0.95,0.85)*pow(max(dot(N,Hh),0.),70.)*spec*tex.a*lit;
  float fr=pow(1.-max(dot(N,V),0.),atmPow);
  col+=atmColor*fr*atmStr*smoothstep(-0.3,0.5,ndl);
  col+=tex.rgb*vec3(0.004,0.008,0.02);
  gl_FragColor=vec4(col,1.);
}
`;

export const ATMO_FS = /* glsl */ `
varying vec3 vN; varying vec3 vP;
uniform vec3 color; uniform float str, muL;
void main(){
  vec3 N=normalize(vN), L=normalize(-vP), V=normalize(cameraPosition-vP);
  float mu=max(dot(N,V),0.);
  float a = mu<muL ? pow(smoothstep(0.,muL,mu),1.6) : pow(clamp((1.-mu)/(1.-muL),0.,1.),5.);
  a*=smoothstep(-0.4,0.45,dot(N,L));
  gl_FragColor=vec4(color*a*str,1.);
}
`;

export const RING_VS = /* glsl */ `
varying vec2 vL; varying vec3 vP;
void main(){ vL=position.xy; vec4 wp=modelMatrix*vec4(position,1.); vP=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }
`;

export const RING_FS = /* glsl */ `
varying vec2 vL; varying vec3 vP;
uniform float ringKind, ringIn, ringOut, planetR;
uniform vec3 center, ringN;
void main(){
  float t=(length(vL)-ringIn)/(ringOut-ringIn);
  float dens=ringDensity(t,fwidth(t),ringKind);
  vec3 L=normalize(-vP), V=normalize(cameraPosition-vP);
  vec3 oc=vP-center; float b=dot(oc,L);
  float dmin=sqrt(max(dot(oc,oc)-b*b,0.));
  float sh = b<0. ? smoothstep(planetR*0.965,planetR*1.035,dmin) : 1.;
  float sunSide=dot(L,ringN), camSide=dot(V,ringN);
  float bright = sunSide*camSide>0. ? 1. : 0.3*(1.-dens)+0.05;
  // forward-scattering sparkle toward the sun
  bright*=1.+0.25*pow(max(dot(-V,L),0.),6.);
  vec3 col=ringColor(t,ringKind,fwidth(t))*(bright*sh*0.72*mix(0.35,1.,dens)+0.012);
  float a=1.-pow(1.-dens,1./max(abs(camSide),0.22));
  gl_FragColor=vec4(col,a);
}
`;

export const SUN_FS = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec3 vO;
uniform float uTime;
void main(){
  vec3 V=normalize(cameraPosition-vP);
  float mu=max(dot(normalize(vN),V),0.);
  float n=fbm(vO*0.4+uTime*0.04);
  vec3 c=mix(vec3(1.,.5,.18),vec3(1.,.9,.68),pow(mu,0.6))*(1.3+1.2*n);
  gl_FragColor=vec4(c,1.);
}
`;

export const UV_VS = /* glsl */ `
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }
`;

export const GLOW_FS = /* glsl */ `
varying vec2 vUv;
uniform vec3 color; uniform vec3 core; uniform float uI, uA, uB;
void main(){
  float r=length(vUv-.5)*2.;
  float g=exp(-r*uA); float c=exp(-r*r*uB);
  float e=1.-smoothstep(0.7,1.,r);
  gl_FragColor=vec4((color*g+core*c)*uI*e,1.);
}
`;

export const TAIL_FS = /* glsl */ `
varying vec2 vUv;
uniform vec3 color; uniform float uI, uW0, uW1, uSeed;
void main(){
  float u=vUv.x, v=vUv.y-.5;
  float w=mix(uW0,uW1,pow(u,0.8));
  float a=exp(-(v*v)/(w*w))*pow(1.-u,1.7)*smoothstep(0.,0.015,u);
  a*=0.72+0.5*vnoise(vec3(v/w*5.+uSeed, u*3., uSeed));
  a*=1.-smoothstep(0.38,0.5,abs(v));
  gl_FragColor=vec4(color*a*uI,1.);
}
`;

export const STREAK_FS = /* glsl */ `
varying vec2 vUv;
uniform float uI;
void main(){
  float u=vUv.x, v=(vUv.y-.5)*2.;
  float a=pow(u,3.)*exp(-v*v*7.)*(1.-smoothstep(0.96,1.,u));
  a+=exp(-((u-0.965)*(u-0.965))*2500.-v*v*3.)*1.5;
  gl_FragColor=vec4(vec3(0.75,0.88,1.)*a*uI,1.);
}
`;

export const SKY_FS = /* glsl */ `
varying vec2 vUv; uniform sampler2D map; uniform float uI;
void main(){ gl_FragColor=vec4(texture2D(map,vUv).rgb*uI,1.); }
`;

export const STAR_VS = /* glsl */ `
attribute float aSize; attribute vec3 aColor; attribute float aPhase;
uniform float uScale, uTime; varying vec3 vC;
void main(){
  float px=aSize*uScale;
  // sub-pixel stars keep their energy by dimming instead of shrinking
  vC=aColor*(0.82+0.18*sin(uTime*(0.6+aPhase*0.5)+aPhase*40.))*min(px/1.6,1.);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
  gl_PointSize=max(px,1.6);
}
`;

export const STAR_FS = /* glsl */ `
varying vec3 vC;
void main(){
  float r=length(gl_PointCoord-.5)*2.;
  float a=exp(-r*r*4.5)*(1.-smoothstep(0.8,1.,r));
  gl_FragColor=vec4(vC*a,1.);
}
`;

export const GRADE_FS = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse; uniform float uTime, uFade; uniform vec2 uRes;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }
float h21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec3 c=texture2D(tDiffuse,vUv).rgb;
  c*=vec3(0.90,0.98,1.14);
  c+=vec3(0.0012,0.0035,0.011);
  c=aces(c*0.95);
  float l=dot(c,vec3(0.2126,0.7152,0.0722));
  c=mix(c, c*vec3(0.82,0.95,1.2), 0.45*(1.-smoothstep(0.,0.5,l))); // blue shadows
  vec2 q=(vUv-.5)*vec2(0.85,1.);
  c*=mix(0.5,1.,smoothstep(1.0,0.25,length(q)*1.5));
  c=pow(c,vec3(1./2.2));
  // 1920-referenced grain doubles as dithering for the dark gradients
  vec2 gp=floor(vUv*uRes*(1920./uRes.y));
  c+=(h21(gp+fract(uTime*7.31)*913.)-.5)*0.03;
  gl_FragColor=vec4(max(c,0.)*uFade,1.);
}
`;
