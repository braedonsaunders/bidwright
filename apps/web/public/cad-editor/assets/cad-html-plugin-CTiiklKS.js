import{m as Ve,y as Re,V as qt,w as Te,k as Qt,W as Ee,C as Ze,O as Oe,E as _e,N as Ne}from"./three-renderer-BWp5ZKBC.js";import{af as Ye,ag as Xe,aU as te,z as A,P as ft,R as X,aV as We,aW as D,aX as Ge,aY as Je,L as Ke,a1 as qe,Z as Qe,aZ as Vt,a7 as tn,a_ as en,a$ as nn,b0 as rn,b1 as an,b2 as on,b3 as Rt,b4 as ln,b5 as sn,b6 as cn,b7 as dn,M as un,b8 as fn,b9 as mn,ba as hn,bb as pn,bc as gn,bd as bn,be as wn,bf as yn,bg as vn,bh as xn,bi as An,bj as kn,U as V,bk as bt,bl as Le,bm as Mn,bn as wt,bo as Ln,bp as Cn,bq as zn,br as Sn}from"./cad-simple-viewer-t7YkTJp4.js";import{r as Ua,e as Ha}from"./cad-viewer-CcTaeyoX.js";const ut=2;var I=Uint8Array,S=Uint16Array,Tt=Int32Array,Et=new I([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),Zt=new I([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),ee=new I([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),Ce=function(t,e){for(var n=new S(31),r=0;r<31;++r)n[r]=e+=1<<t[r-1];for(var a=new Tt(n[30]),r=1;r<30;++r)for(var i=n[r];i<n[r+1];++i)a[i]=i-n[r]<<5|r;return{b:n,r:a}},ze=Ce(Et,2),In=ze.b,It=ze.r;In[28]=258,It[258]=28;var Pn=Ce(Zt,0),ne=Pn.r,Pt=new S(32768);for(var w=0;w<32768;++w){var W=(w&43690)>>1|(w&21845)<<1;W=(W&52428)>>2|(W&13107)<<2,W=(W&61680)>>4|(W&3855)<<4,Pt[w]=((W&65280)>>8|(W&255)<<8)>>1}var ct=function(t,e,n){for(var r=t.length,a=0,i=new S(e);a<r;++a)t[a]&&++i[t[a]-1];var o=new S(e);for(a=1;a<e;++a)o[a]=o[a-1]+i[a-1]<<1;var l;if(n){l=new S(1<<e);var s=15-e;for(a=0;a<r;++a)if(t[a])for(var c=a<<4|t[a],d=e-t[a],u=o[t[a]-1]++<<d,f=u|(1<<d)-1;u<=f;++u)l[Pt[u]>>s]=c}else for(l=new S(r),a=0;a<r;++a)t[a]&&(l[a]=Pt[o[t[a]-1]++]>>15-t[a]);return l},K=new I(288);for(var w=0;w<144;++w)K[w]=8;for(var w=144;w<256;++w)K[w]=9;for(var w=256;w<280;++w)K[w]=7;for(var w=280;w<288;++w)K[w]=8;var mt=new I(32);for(var w=0;w<32;++w)mt[w]=5;var Bn=ct(K,9,0),Fn=ct(mt,5,0),Se=function(t){return(t+7)/8|0},Ie=function(t,e,n){return(n==null||n>t.length)&&(n=t.length),new I(t.subarray(e,n))},_=function(t,e,n){n<<=e&7;var r=e/8|0;t[r]|=n,t[r+1]|=n>>8},lt=function(t,e,n){n<<=e&7;var r=e/8|0;t[r]|=n,t[r+1]|=n>>8,t[r+2]|=n>>16},Mt=function(t,e){for(var n=[],r=0;r<t.length;++r)t[r]&&n.push({s:r,f:t[r]});var a=n.length,i=n.slice();if(!a)return{t:Be,l:0};if(a==1){var o=new I(n[0].s+1);return o[n[0].s]=1,{t:o,l:1}}n.sort(function(P,j){return P.f-j.f}),n.push({s:-1,f:25001});var l=n[0],s=n[1],c=0,d=1,u=2;for(n[0]={s:-1,f:l.f+s.f,l,r:s};d!=a-1;)l=n[n[c].f<n[u].f?c++:u++],s=n[c!=d&&n[c].f<n[u].f?c++:u++],n[d++]={s:-1,f:l.f+s.f,l,r:s};for(var f=i[0].s,r=1;r<a;++r)i[r].s>f&&(f=i[r].s);var h=new S(f+1),g=Bt(n[d-1],h,0);if(g>e){var r=0,m=0,v=g-e,R=1<<v;for(i.sort(function(j,L){return h[L.s]-h[j.s]||j.f-L.f});r<a;++r){var O=i[r].s;if(h[O]>e)m+=R-(1<<g-h[O]),h[O]=e;else break}for(m>>=v;m>0;){var G=i[r].s;h[G]<e?m-=1<<e-h[G]++-1:++r}for(;r>=0&&m;--r){var F=i[r].s;h[F]==e&&(--h[F],++m)}g=e}return{t:new I(h),l:g}},Bt=function(t,e,n){return t.s==-1?Math.max(Bt(t.l,e,n+1),Bt(t.r,e,n+1)):e[t.s]=n},re=function(t){for(var e=t.length;e&&!t[--e];);for(var n=new S(++e),r=0,a=t[0],i=1,o=function(s){n[r++]=s},l=1;l<=e;++l)if(t[l]==a&&l!=e)++i;else{if(!a&&i>2){for(;i>138;i-=138)o(32754);i>2&&(o(i>10?i-11<<5|28690:i-3<<5|12305),i=0)}else if(i>3){for(o(a),--i;i>6;i-=6)o(8304);i>2&&(o(i-3<<5|8208),i=0)}for(;i--;)o(a);i=1,a=t[l]}return{c:n.subarray(0,r),n:e}},st=function(t,e){for(var n=0,r=0;r<e.length;++r)n+=t[r]*e[r];return n},Pe=function(t,e,n){var r=n.length,a=Se(e+2);t[a]=r&255,t[a+1]=r>>8,t[a+2]=t[a]^255,t[a+3]=t[a+1]^255;for(var i=0;i<r;++i)t[a+i+4]=n[i];return(a+4+r)*8},ae=function(t,e,n,r,a,i,o,l,s,c,d){_(e,d++,n),++a[256];for(var u=Mt(a,15),f=u.t,h=u.l,g=Mt(i,15),m=g.t,v=g.l,R=re(f),O=R.c,G=R.n,F=re(m),P=F.c,j=F.n,L=new S(19),b=0;b<O.length;++b)++L[O[b]&31];for(var b=0;b<P.length;++b)++L[P[b]&31];for(var p=Mt(L,7),C=p.t,q=p.l,z=19;z>4&&!C[ee[z-1]];--z);var Q=c+5<<3,$=st(a,K)+st(i,mt)+o,U=st(a,f)+st(i,m)+o+14+3*z+st(L,C)+2*L[16]+3*L[17]+7*L[18];if(s>=0&&Q<=$&&Q<=U)return Pe(e,d,t.subarray(s,s+c));var T,x,H,Y;if(_(e,d,1+(U<$)),d+=2,U<$){T=ct(f,h,0),x=f,H=ct(m,v,0),Y=m;var vt=ct(C,q,0);_(e,d,G-257),_(e,d+5,j-1),_(e,d+10,z-4),d+=14;for(var b=0;b<z;++b)_(e,d+3*b,C[ee[b]]);d+=3*z;for(var E=[O,P],ot=0;ot<2;++ot)for(var tt=E[ot],b=0;b<tt.length;++b){var Z=tt[b]&31;_(e,d,vt[Z]),d+=C[Z],Z>15&&(_(e,d,tt[b]>>5&127),d+=tt[b]>>12)}}else T=Bn,x=K,H=Fn,Y=mt;for(var b=0;b<l;++b){var k=r[b];if(k>255){var Z=k>>18&31;lt(e,d,T[Z+257]),d+=x[Z+257],Z>7&&(_(e,d,k>>23&31),d+=Et[Z]);var et=k&31;lt(e,d,H[et]),d+=Y[et],et>3&&(lt(e,d,k>>5&8191),d+=Zt[et])}else lt(e,d,T[k]),d+=x[k]}return lt(e,d,T[256]),d+x[256]},jn=new Tt([65540,131080,131088,131104,262176,1048704,1048832,2114560,2117632]),Be=new I(0),$n=function(t,e,n,r,a,i){var o=i.z||t.length,l=new I(r+o+5*(1+Math.ceil(o/7e3))+a),s=l.subarray(r,l.length-a),c=i.l,d=(i.r||0)&7;if(e){d&&(s[0]=i.r>>3);for(var u=jn[e-1],f=u>>13,h=u&8191,g=(1<<n)-1,m=i.p||new S(32768),v=i.h||new S(g+1),R=Math.ceil(n/3),O=2*R,G=function(kt){return(t[kt]^t[kt+1]<<R^t[kt+2]<<O)&g},F=new Tt(25e3),P=new S(288),j=new S(32),L=0,b=0,p=i.i||0,C=0,q=i.w||0,z=0;p+2<o;++p){var Q=G(p),$=p&32767,U=v[Q];if(m[$]=U,v[Q]=$,q<=p){var T=o-p;if((L>7e3||C>24576)&&(T>423||!c)){d=ae(t,s,0,F,P,j,b,C,z,p-z,d),C=L=b=0,z=p;for(var x=0;x<286;++x)P[x]=0;for(var x=0;x<30;++x)j[x]=0}var H=2,Y=0,vt=h,E=$-U&32767;if(T>2&&Q==G(p-E))for(var ot=Math.min(f,T)-1,tt=Math.min(32767,p),Z=Math.min(258,T);E<=tt&&--vt&&$!=U;){if(t[p+H]==t[p+H-E]){for(var k=0;k<Z&&t[p+k]==t[p+k-E];++k);if(k>H){if(H=k,Y=E,k>ot)break;for(var et=Math.min(E,k-2),Wt=0,x=0;x<et;++x){var xt=p-E+x&32767,De=m[xt],Gt=xt-De&32767;Gt>Wt&&(Wt=Gt,U=xt)}}}$=U,U=m[$],E+=$-U&32767}if(Y){F[C++]=268435456|It[H]<<18|ne[Y];var Jt=It[H]&31,Kt=ne[Y]&31;b+=Et[Jt]+Zt[Kt],++P[257+Jt],++j[Kt],q=p+H,++L}else F[C++]=t[p],++P[t[p]]}}for(p=Math.max(p,q);p<o;++p)F[C++]=t[p],++P[t[p]];d=ae(t,s,c,F,P,j,b,C,z,p-z,d),c||(i.r=d&7|s[d/8|0]<<3,d-=7,i.h=v,i.p=m,i.i=p,i.w=q)}else{for(var p=i.w||0;p<o+c;p+=65535){var At=p+65535;At>=o&&(s[d/8|0]=c,At=o),d=Pe(s,d+1,t.subarray(p,At))}i.i=o}return Ie(l,0,r+Se(d)+a)},Un=function(){for(var t=new Int32Array(256),e=0;e<256;++e){for(var n=e,r=9;--r;)n=(n&1&&-306674912)^n>>>1;t[e]=n}return t}(),Hn=function(){var t=-1;return{p:function(e){for(var n=t,r=0;r<e.length;++r)n=Un[n&255^e[r]]^n>>>8;t=n},d:function(){return~t}}},Dn=function(t,e,n,r,a){if(!a&&(a={l:1},e.dictionary)){var i=e.dictionary.subarray(-32768),o=new I(i.length+t.length);o.set(i),o.set(t,i.length),t=o,a.w=i.length}return $n(t,e.level==null?6:e.level,e.mem==null?a.l?Math.ceil(Math.max(8,Math.min(13,Math.log(t.length)))*1.5):20:12+e.mem,n,r,a)},Ft=function(t,e,n){for(;n;++e)t[e]=n,n>>>=8},Vn=function(t,e){var n=e.filename;if(t[0]=31,t[1]=139,t[2]=8,t[8]=e.level<2?4:e.level==9?2:0,t[9]=3,e.mtime!=0&&Ft(t,4,Math.floor(new Date(e.mtime||Date.now())/1e3)),n){t[3]=8;for(var r=0;r<=n.length;++r)t[r+10]=n.charCodeAt(r)}},Rn=function(t){return 10+(t.filename?t.filename.length+1:0)};function Tn(t,e){e||(e={});var n=Hn(),r=t.length;n.p(t);var a=Dn(t,e,Rn(e),8),i=a.length;return Vn(a,e),Ft(a,i-8,n.d()),Ft(a,i-4,r),a}var ie=typeof TextEncoder<"u"&&new TextEncoder,En=typeof TextDecoder<"u"&&new TextDecoder,Zn=0;try{En.decode(Be,{stream:!0}),Zn=1}catch{}function On(t,e){var n;if(ie)return ie.encode(t);for(var r=t.length,a=new I(t.length+(t.length>>1)),i=0,o=function(d){a[i++]=d},n=0;n<r;++n){if(i+5>a.length){var l=new I(i+8+(r-n<<1));l.set(a),a=l}var s=t.charCodeAt(n);s<128||e?o(s):s<2048?(o(192|s>>6),o(128|s&63)):s>55295&&s<57344?(s=65536+(s&1047552)|t.charCodeAt(++n)&1023,o(240|s>>18),o(128|s>>12&63),o(128|s>>6&63),o(128|s&63)):(o(224|s>>12),o(128|s>>6&63),o(128|s&63))}return Ie(a,0,i)}const _n=1480934209,oe=1,le=2,se=4,ce=8,de=1,ue=2,fe=4,me=8,he=16,Nn=32;function Yn(t){if(t.version!==ut)throw new Error(`Unsupported snapshot version: ${t.version}`);const e=new Jn;e.writeU32(_n),e.writeU8(ut),e.writeU8(0),e.writeU8(0),e.writeU8(0),e.writeJson(t.meta),e.writeJson(t.layers),e.writeString(t.activeLayoutBtrId),e.writeU32(t.layouts.length);for(const n of t.layouts)Xn(e,n);return e.toUint8Array()}function Xn(t,e){t.writeString(e.btrId),t.writeString(e.name),t.writeU8(e.isModelSpace?1:0),t.writeJson(e.osnap??null),t.writeU32(e.lineBatches.length);for(const n of e.lineBatches)Wn(t,n);t.writeU32(e.meshBatches.length);for(const n of e.meshBatches)Gn(t,n)}function Wn(t,e){t.writeString(e.layer),t.writeU32(e.color>>>0),t.writeF64(e.offset[0]),t.writeF64(e.offset[1]),t.writeF64(e.offset[2]),t.writeFloat32Array(e.positions);let n=0;e.indices&&e.indices.length>0&&(n|=oe),e.linePattern&&(n|=le),e.lineDistances&&e.lineDistances.length>0&&(n|=se),e.lineWidth!=null&&e.lineWidth>0&&(n|=ce),t.writeU8(n),n&oe&&t.writeUint32Array(e.indices),n&le&&t.writeJson(e.linePattern),n&se&&t.writeFloat32Array(e.lineDistances),n&ce&&t.writeF32(e.lineWidth)}function Gn(t,e){t.writeString(e.layer),t.writeU32(e.color>>>0),t.writeF64(e.offset[0]),t.writeF64(e.offset[1]),t.writeF64(e.offset[2]),t.writeFloat32Array(e.positions);let n=0;e.indices&&e.indices.length>0&&(n|=de),e.hatchPattern&&(n|=ue),e.gradientFill&&(n|=fe),e.gradientPositions&&e.gradientPositions.length>0&&(n|=me),e.side!=null&&(n|=he),e.points&&(n|=Nn),t.writeU8(n),n&de&&t.writeUint32Array(e.indices),n&ue&&t.writeJson(e.hatchPattern),n&fe&&t.writeJson(e.gradientFill),n&me&&t.writeFloat32Array(e.gradientPositions),n&he&&t.writeU8(e.side)}class Jn{constructor(){this.chunks=[],this.length=0}writeU8(e){const n=new Uint8Array(1);n[0]=e&255,this.chunks.push(n),this.length+=1}writeU32(e){const n=new Uint8Array(4);new DataView(n.buffer).setUint32(0,e>>>0,!0),this.chunks.push(n),this.length+=4}writeF32(e){const n=new Uint8Array(4);new DataView(n.buffer).setFloat32(0,e,!0),this.chunks.push(n),this.length+=4}writeF64(e){const n=new Uint8Array(8);new DataView(n.buffer).setFloat64(0,e,!0),this.chunks.push(n),this.length+=8}writeBytes(e){this.chunks.push(e),this.length+=e.length}writeString(e){const n=On(e);this.writeU32(n.length),this.writeBytes(n)}writeJson(e){this.writeString(JSON.stringify(e))}writeFloat32Array(e){const n=new Uint8Array(e.buffer,e.byteOffset,e.byteLength);this.writeU32(n.length),this.writeBytes(n)}writeUint32Array(e){const n=new Uint8Array(e.buffer,e.byteOffset,e.byteLength);this.writeU32(n.length),this.writeBytes(n)}toUint8Array(){const e=new Uint8Array(this.length);let n=0;for(const r of this.chunks)e.set(r,n),n+=r.length;return e}}const Kn="application/vnd.mlightcad.acex-snapshot+binary";function qn(t){if(t.version!==ut)throw new Error(`Unsupported snapshot version: ${t.version}`);const e=Yn(t),n=Tn(e);return tr(n)}function Qn(){return Kn}function tr(t){let e="";for(let n=0;n<t.length;n++)e+=String.fromCharCode(t[n]);return btoa(e)}function it(t,e,n){if(n<=0)return new Float32Array(0);const r=new Float32Array(n);for(let a=0;a<n;a++)r[a]=t[e+a];return r}function er(t,e,n){if(n<=0)return new Uint32Array(0);const r=new Uint32Array(n);for(let a=0;a<n;a++)r[a]=t[e+a];return r}function Fe(t,e){if(e.length===0)return{positions:t,indices:e};let n=0;for(let a=0;a<e.length;a++){const i=e[a];i>n&&(n=i)}const r=(n+1)*3;return r>=t.length?{positions:t,indices:e}:{positions:it(t,0,r),indices:e}}function pe(t,e){return t+e}const nt={x:0,y:0,z:0};function nr(t){t.updateMatrixWorld(!0);const e=t.matrixWorld.elements;return nt.x=e[12],nt.y=e[13],nt.z=e[14],[nt.x,nt.y,nt.z]}function rr(t,e){const n=e.elements,r=t.positions;if(r.length===0)return{positions:new Float32Array(0),indices:t.indices};const a=new Float32Array(r.length);for(let i=0;i<r.length;i+=3){const o=r[i],l=r[i+1],s=r[i+2];a[i]=n[0]*o+n[4]*l+n[8]*s+n[12],a[i+1]=n[1]*o+n[5]*l+n[9]*s+n[13],a[i+2]=n[2]*o+n[6]*l+n[10]*s+n[14]}return{positions:a,indices:t.indices?new Uint32Array(t.indices):void 0}}function ar(t){const e=t.positions;if(e.length<3)return{slice:t,offset:[0,0,0]};let n=1/0,r=1/0,a=1/0,i=-1/0,o=-1/0,l=-1/0;for(let d=0;d<e.length;d+=3){const u=e[d],f=e[d+1],h=e[d+2];n=Math.min(n,u),r=Math.min(r,f),a=Math.min(a,h),i=Math.max(i,u),o=Math.max(o,f),l=Math.max(l,h)}const s=[(n+i)/2,(r+o)/2,(a+l)/2],c=new Float32Array(e.length);for(let d=0;d<e.length;d+=3)c[d]=e[d]-s[0],c[d+1]=e[d+1]-s[1],c[d+2]=e[d+2]-s[2];return{slice:{positions:c,indices:t.indices?new Uint32Array(t.indices):void 0},offset:s}}function ir(t,e,n={}){t.updateMatrixWorld(!0);const r=rr(e,t.matrixWorld);return n.preserveWorldSpaceForPatternFill?{slice:r,offset:[0,0,0]}:ar(r)}function Ot(t){const e=t;if(e.isShaderMaterial===!0||t.type==="ShaderMaterial")return e}function or(t){var e;const n=Ot(t);if(!n)return;const r=n.uniforms.pattern,a=n.uniforms.patternLength;if(!r||!a)return;const i=r.value;if(!(!Array.isArray(i)||i.length===0))return{pattern:[...i],patternLength:Number(a.value),viewportScale:Number(((e=n.uniforms.u_viewportScale)==null?void 0:e.value)??1)}}function lr(t){var e;const n=Ot(t);if(!n)return;const r=n.uniforms.u_patternLines;if(!r)return;const a=r.value;if(!(!Array.isArray(a)||a.length===0))return{patternAngle:Number(((e=n.uniforms.u_patternAngle)==null?void 0:e.value)??0),patternLines:a.map(cr)}}function sr(t){var e,n,r,a,i;const o=Ot(t);if(!o||o.uniforms.u_patternLines)return;const l=(e=o.uniforms.u_startColor)==null?void 0:e.value,s=(n=o.uniforms.u_endColor)==null?void 0:n.value,c=o.uniforms.u_gradientType;if(!(!(l!=null&&l.getHex)||c==null))return{startColor:l.getHex(),endColor:((r=s==null?void 0:s.getHex)==null?void 0:r.call(s))??l.getHex(),angle:Number(((a=o.uniforms.u_angle)==null?void 0:a.value)??0),shift:Number(((i=o.uniforms.u_shift)==null?void 0:i.value)??0),gradientType:Number(c.value)}}function cr(t){return{angle:t.angle,base:[t.base.x,t.base.y],offset:[t.offset.x,t.offset.y],dashLengths:[...t.dashLengths],patternLength:t.patternLength}}function je(t){const e=t.length/3;if(e<2)return new Float32Array(0);const n=new Float32Array(e);for(let r=0;r<e;r+=2){r===0?n[r]=0:n[r]=n[r-1];const a=t[r*3],i=t[r*3+1],o=t[r*3+2]??0,l=t[(r+1)*3],s=t[(r+1)*3+1],c=t[(r+1)*3+2]??0,d=l-a,u=s-i,f=c-o;n[r+1]=n[r]+Math.sqrt(d*d+u*u+f*f)}return n}function dr(t,e){const n=t.getAttribute(e);if(!n||n.count===0)return;const r=n.itemSize;if(t.getIndex()){const d=n.array;return it(d,0,n.count*r)}const a=t.drawRange,i=n.count,o=Math.max(0,Math.min(Math.floor(a.start),i)),l=Math.max(0,i-o),s=!Number.isFinite(a.count)||a.count<=0?l:Math.min(Math.floor(a.count),l);if(s<=0)return;const c=n.array;return it(c,o*r,s*r)}function ur(t,e){const n=Math.atan2(e[1],e[0]),r=(i,o)=>[e[0]*i+e[4]*o+e[12],e[1]*i+e[5]*o+e[13]],a=(i,o)=>[e[0]*i+e[4]*o,e[1]*i+e[5]*o];return{patternAngle:t.patternAngle+n,patternLines:t.patternLines.map(i=>({angle:i.angle+n,base:r(i.base[0],i.base[1]),offset:a(i.offset[0],i.offset[1]),dashLengths:[...i.dashLengths],patternLength:i.patternLength}))}}function jt(t,e){return!Number.isFinite(t)||t<0?0:Math.min(Math.floor(t),e)}function $t(t,e,n){const r=Math.max(0,e-n);return!Number.isFinite(t)||t<=0?r:Math.min(Math.floor(t),r)}function ge(t){const e=t.getAttribute("position");if(!e)return{positions:new Float32Array(0)};const n=t.drawRange,r=e.array,a=e.itemSize,i=t.getIndex();if(i){const s=it(r,0,e.count*a),c=i.array,d=jt(n.start,i.count),u=$t(n.count,i.count,d),f=er(c,d,u);return Fe(s,f)}const o=jt(n.start,e.count),l=$t(n.count,e.count,o);return{positions:it(r,o*a,l*a)}}function Ut(t){return _e(t.flags)&&Ne(t.flags)}function _t(t,e){const n=e.getAttribute("position");if(!n)return{positions:new Float32Array(0)};const r=n.itemSize,a=n.array,i=e.getIndex(),{count:o}=t.mappingStats;if(i){const s=it(a,0,n.count*r),c=i.array,d=[];for(let u=0;u<o;u++){let f;try{f=t.getGeometryRangeAt(u)}catch{continue}const h=f.indexStart??0,g=f.indexCount??0;if(!(!Ut(f)||g<=0))for(let m=0;m<g;m++)d.push(c[h+m])}return d.length===0?{positions:new Float32Array(0)}:Fe(s,new Uint32Array(d))}const l=[];for(let s=0;s<o;s++){let c;try{c=t.getGeometryRangeAt(s)}catch{continue}if(!Ut(c)||c.vertexCount<=0)continue;const d=c.vertexStart*r,u=c.vertexCount*r;for(let f=0;f<u;f++)l.push(a[d+f])}return{positions:new Float32Array(l)}}function ht(t,e,n){t.push(e.getX(n),e.getY(n),e.getZ(n))}function fr(t,e){const n=e.getAttribute("instanceStart"),r=e.getAttribute("instanceEnd");if(!n||!r)return{positions:new Float32Array(0)};const{count:a}=t.mappingStats,i=[];for(let o=0;o<a;o++){let l;try{l=t.getGeometryRangeAt(o)}catch{continue}if(!Ut(l)||l.vertexCount<=0)continue;const s=l.vertexStart,c=s+l.vertexCount;for(let d=s;d<c;d++)ht(i,n,d),ht(i,r,d)}return{positions:new Float32Array(i)}}function mr(t,e){const n=t.instanceCount;if(Number.isFinite(n)&&n>=0)return Math.min(Math.floor(n),e);const r=t.drawRange,a=jt(r.start,e);return $t(r.count,e,a)}function hr(t){const e=t.getAttribute("instanceStart"),n=t.getAttribute("instanceEnd");if(!e||!n||e.count===0)return{positions:new Float32Array(0)};const r=mr(t,e.count);if(r<=0)return{positions:new Float32Array(0)};const a=[];for(let i=0;i<r;i++)ht(a,e,i),ht(a,n,i);return{positions:new Float32Array(a)}}function Lt(t){return Ze(t)}function $e(t){if(t instanceof en)return t.linewidth}function at(t){var e;const n=Oe(t),r=n.layer??"0",a=t;let i=a.color!=null?a.color.getHex():n.color??16777215;const o=or(t),l=lr(t),s=sr(t);if(t instanceof tn||t.type==="ShaderMaterial"){const c=(e=t.uniforms.u_color)==null?void 0:e.value;c!=null&&c.getHex?i=c.getHex():s&&(i=s.startColor)}return{color:i,layer:r,linePattern:o,hatchPattern:l,gradientFill:s,side:l||s?t.side:void 0}}function pr(t,e){if(!e)return;const n=t.userData.bakedWorldMatrix;return!n||n.length<16?e:ur(e,n)}function yt(t){return nr(t)}function Ct(t,e,n={}){const r=ir(t,e,n);return{...r.slice,offset:r.offset}}function Nt(t,e,n,r,a){const i=at(e),o=pr(n,i.hatchPattern),l=i.gradientFill?dr(t,"gradientPosition"):void 0;return{layer:i.layer,color:i.color,offset:a,hatchPattern:o,gradientFill:i.gradientFill,gradientPositions:l,side:i.side,...r}}function gr(t){const e=fr(t,t.geometry);if(e.positions.length===0)return;const{color:n,layer:r}=at(t.material),a=$e(t.material);return{layer:r,color:n,offset:yt(t),lineWidth:a,...e}}function br(t){const e=_t(t,t.geometry);if(e.positions.length===0)return;const{color:n,layer:r,linePattern:a}=at(t.material),i=a?je(e.positions):void 0;return{layer:r,color:n,offset:yt(t),linePattern:a,lineDistances:i,...e}}function wr(t){const e=_t(t,t.geometry);if(e.positions.length!==0)return Nt(t.geometry,t.material,t,e,yt(t))}function yr(t){const e=_t(t,t.geometry);if(e.positions.length!==0)return{points:!0,...Nt(t.geometry,t.material,t,e,yt(t))}}function be(t){const e=[],n=[];return t.traverse(r=>{if(!(Ve(r)||Re(r))){if(r instanceof qt){const a=br(r);a&&e.push(a);return}if(r instanceof Te){const a=gr(r);a&&e.push(a);return}if(r instanceof Qt){const a=wr(r);a&&n.push(a);return}if(r instanceof Ee){const a=yr(r);a&&n.push(a);return}if(r instanceof Ke){if(!Lt(r))return;const a=hr(r.geometry);if(a.positions.length===0)return;const i=r.material,{color:o,layer:l}=at(i),{offset:s,...c}=Ct(r,a);e.push({layer:l,color:o,offset:s,lineWidth:$e(i),...c})}else if(r instanceof qe&&!(r instanceof qt)){if(!Lt(r))return;const a=ge(r.geometry);if(a.positions.length===0)return;const i=r.material,{color:o,layer:l,linePattern:s}=at(i),{offset:c,...d}=Ct(r,a),u=s?je(d.positions):void 0;e.push({layer:l,color:o,offset:c,linePattern:s,lineDistances:u,...d})}else if(r instanceof Qe&&!(r instanceof Qt)){if(!Lt(r))return;const a=ge(r.geometry);if(a.positions.length===0)return;const i=r.material,o=at(i),{offset:l,...s}=Ct(r,a,{preserveWorldSpaceForPatternFill:!!o.hatchPattern});n.push(Nt(r.geometry,i,r,s,l))}}}),{lineBatches:e,meshBatches:n}}function we(t,e){const n=t.extmin,r=t.extmax;return{title:e==null?void 0:e.title,extents:{minX:n.x,minY:n.y,maxX:r.x,maxY:r.y},units:{insunits:t.insunits,lunits:t.lunits,luprec:t.luprec,aunits:t.aunits,auprec:t.auprec,measurement:t.measurement,ltscale:t.ltscale,angbase:t.angbase,angdir:t.angdir},background:(e==null?void 0:e.background)??0}}function Yt(t){return t.z>=0?1:-1}const vr=1e6;function y(t,e){const n=new V(e.x,e.y,e.z??0).applyMatrix4(t);return{x:n.x,y:n.y}}function xr(t){const e=t.elements;return new Vt(e[0],e[4],e[8],e[12],e[1],e[5],e[9],e[13],e[2],e[6],e[10],e[14],e[3],e[7],e[11],e[15])}function pt(t,e){return new Vt().multiplyMatrices(t,xr(e))}function Xt(t,e){const n=new V(e.x,e.y,e.z??0).transformDirection(t).normalize();return{x:n.x,y:n.y}}function Ht(t){const e=new V(t.elements[0],t.elements[1],t.elements[2]).length(),n=new V(t.elements[4],t.elements[5],t.elements[6]).length();return bt.equal(e,n,Le*Math.max(e,n,1))}function Ar(t,e){const n=t.tables.blockTable.getIdAt(e);if(n)return n;for(const a of t.tables.blockTable.newIterator())if(a.objectId===e)return a;const r=t.tables.blockTable.modelSpace;if(r.objectId===e)return r}function kr(t){if(t instanceof kn)return!0;const e=t;return(e.type==="LINE"||e.type==="Line")&&e.startPoint!=null&&e.endPoint!=null}function Mr(t,e,n,r){N(t,e,n,r.startPoint,r.endPoint)}function Ue(t,e){return t.blockTableRecord??(t.blockName?e.tables.blockTable.getAt(t.blockName):void 0)}function Lr(t,e){const n=t.dimBlockId;return n?e.tables.blockTable.getAt(n):void 0}function Cr(t,e){const n=Ue(t,e);if(n)return n;const r=t.owningBlockRecordId;return r?e.tables.blockTable.getAt(r):void 0}function He(t){return t.getFullInsertionTransform()}function zr(t){for(const e of t.newIterator())return!0;return!1}function Sr(t){return typeof t.getFullInsertionTransform=="function"&&"blockTableRecord"in t}function N(t,e,n,r,a){const i=y(n,r),o=y(n,a),l={kind:"line",layer:e,x0:i.x,y0:i.y,x1:o.x,y1:o.y};t.push(l)}function ye(t,e,n,r,a,i){const o=y(n,r),l=Xt(n,a),s=Math.hypot(l.x,l.y)||1,c=l.x/s,d=l.y/s,u=vr,f=i?o.x-c*u:o.x,h=i?o.y-d*u:o.y,g=o.x+c*u,m=o.y+d*u;t.push({kind:"line",layer:e,x0:f,y0:h,x1:g,y1:m})}function J(t,e,n,r,a){if(r.length<2)return;const i=a?r.length:r.length-1;for(let o=0;o<i;o++)N(t,e,n,r[o],r[(o+1)%r.length])}function Ir(t,e,n,r){const a=[r.startPosition];for(const i of r.segments)a.push(i.position);J(t,e,n,a,r.closed)}function Pr(t,e,n){if(n.vertices.length>=2)return n.vertices;if(n.vertices.length===0)return[];const r=n.vertices[0],a=e.lastLeaderLinePoint??e.landingPoint??t.landingPoint??t.contentBasePosition;if(!a)return n.vertices;const i=r.x-a.x,o=r.y-a.y,l=(r.z??0)-(a.z??0);return Math.hypot(i,o,l)<=Le?n.vertices:[r,a]}function Br(t,e,n,r){var a,i;for(const l of r.leaders)for(const s of l.leaderLines){const c=Pr(r,l,s);J(t,e,n,c,!1)}const o=l=>{if(!l)return;const s=y(n,l);t.push({kind:"point",layer:e,x:s.x,y:s.y})};o(r.contentBasePosition),o((a=r.mtextContent)==null?void 0:a.anchorPoint),o((i=r.blockContent)==null?void 0:i.position)}function Fr(t,e,n,r){const a=r.numberOfVertices;if(a<2)return;const i=r.elevation,o=r.closed?a:a-1;for(let l=0;l<o;l++){const s=r.getPointAt(l),c=r.getPointAt((l+1)%a),d=r.getBulgeAt(l),u={x:s.x,y:s.y,z:i},f={x:c.x,y:c.y,z:i};if(bt.isPositive(Math.abs(d))){const h=y(n,u),g=y(n,f),m=new wt(h,g,d),v=m.center;t.push({kind:"arc",layer:e,cx:v.x,cy:v.y,r:m.radius,startAngle:m.startAngle,endAngle:m.endAngle,normalSign:m.clockwise?-1:1})}else N(t,e,n,u,f)}}function jr(t,e,n,r,a,i){const o=y(n,r),l=new V(n.elements[0],n.elements[1],n.elements[2]).length(),s={kind:"circle",layer:e,cx:o.x,cy:o.y,r:a*l,normalSign:Yt(i)};t.push(s)}function $r(t,e,n,r){const a=y(n,r.center),i=new V(n.elements[0],n.elements[1],n.elements[2]).length(),o={kind:"arc",layer:e,cx:a.x,cy:a.y,r:r.radius*i,startAngle:r.startAngle,endAngle:r.endAngle,normalSign:Yt(r.normal)};t.push(o)}function zt(t,e,n,r){const a=y(n,r.center),i=r._geo,o=(i==null?void 0:i.majorAxis)??{x:1,y:0,z:0},l=Xt(n,o),s=Math.hypot(l.x,l.y)||1,c=new V(n.elements[0],n.elements[1],n.elements[2]).length(),d=new V(n.elements[4],n.elements[5],n.elements[6]).length(),u={kind:"ellipse",layer:e,cx:a.x,cy:a.y,majorX:l.x/s,majorY:l.y/s,majorR:r.majorAxisRadius*c,minorR:r.minorAxisRadius*d,startAngle:r.startAngle,endAngle:r.endAngle,closed:r.closed,normalSign:Yt(r.normal)};t.push(u)}function Ur(t,e,n,r){var a,i;const o=r._geo;if(!((a=o==null?void 0:o.controlPoints)!=null&&a.length))return;const l=[];for(const c of o.controlPoints){const d=y(n,c);l.push(d.x,d.y)}const s={kind:"spline",layer:e,controlPoints:l,degree:o.degree??3,knots:[...o.knots??[]],weights:[...o.weights??[]],closed:o.closed??!1};if((i=o.fitPoints)!=null&&i.length){s.fitPoints=[];for(const c of o.fitPoints){const d=y(n,c);s.fitPoints.push(d.x,d.y)}}t.push(s)}function Hr(t,e,n,r){var a;const i=(a=r._geo)==null?void 0:a.vertices,o=i&&i.length>1?i.map(c=>({x:c.x,y:c.y,bulge:c.bulge})):Array.from({length:r.numberOfVertices},(c,d)=>{const u=r.getPoint2dAt(d);return{x:u.x,y:u.y,bulge:0}}),l=o.length;if(l<2)return;const s=r.closed?l:l-1;for(let c=0;c<s;c++){const d=o[c],u=o[(c+1)%l],f=d.bulge??0;if(bt.isPositive(Math.abs(f))){const h=y(n,{x:d.x,y:d.y,z:0}),g=y(n,{x:u.x,y:u.y,z:0}),m=new wt(h,g,f),v=m.center;t.push({kind:"arc",layer:e,cx:v.x,cy:v.y,r:m.radius,startAngle:m.startAngle,endAngle:m.endAngle,normalSign:m.clockwise?-1:1})}else N(t,e,n,{x:d.x,y:d.y,z:0},{x:u.x,y:u.y,z:0})}}function Dr(t,e,n,r,a){if(Ht(n)){const i=y(n,{x:r.center.x,y:r.center.y,z:a}),o=new V(n.elements[0],n.elements[1],n.elements[2]).length();t.push({kind:"arc",layer:e,cx:i.x,cy:i.y,r:r.radius*o,startAngle:r.startAngle,endAngle:r.endAngle,normalSign:r.clockwise?-1:1});return}N(t,e,n,{x:r.startPoint.x,y:r.startPoint.y,z:a},{x:r.endPoint.x,y:r.endPoint.y,z:a})}function Vr(t,e,n,r,a){const i=y(n,{x:r.center.x,y:r.center.y,z:a}),o=Xt(n,{x:Math.cos(r.rotation),y:Math.sin(r.rotation),z:0}),l=Math.hypot(o.x,o.y)||1,s=new V(n.elements[0],n.elements[1],n.elements[2]).length(),c=new V(n.elements[4],n.elements[5],n.elements[6]).length();t.push({kind:"ellipse",layer:e,cx:i.x,cy:i.y,majorX:o.x/l,majorY:o.y/l,majorR:r.majorAxisRadius*s,minorR:r.minorAxisRadius*c,startAngle:r.startAngle,endAngle:r.endAngle,closed:!1,normalSign:r.clockwise?-1:1})}function Rr(t,e,n,r,a){var i;const o=r.numberOfVertices;if(o<2)return;const l=r.closed?o:o-1;for(let s=0;s<l;s++){const c=r.getPointAt(s),d=r.getPointAt((s+1)%o),u=((i=r.vertices[s])==null?void 0:i.bulge)??0,f={x:c.x,y:c.y,z:a},h={x:d.x,y:d.y,z:a};if(bt.isPositive(Math.abs(u))){const g=y(n,f),m=y(n,h),v=new wt(g,m,u),R=v.center;t.push({kind:"arc",layer:e,cx:R.x,cy:R.y,r:v.radius,startAngle:v.startAngle,endAngle:v.endAngle,normalSign:v.clockwise?-1:1})}else N(t,e,n,f,h)}}function Tr(t,e,n,r,a){if(r instanceof Ln){Rr(t,e,n,r,a);return}if(r instanceof Cn)for(const i of r.curves)i instanceof zn?N(t,e,n,{x:i.startPoint.x,y:i.startPoint.y,z:a},{x:i.endPoint.x,y:i.endPoint.y,z:a}):i instanceof wt?Dr(t,e,n,i,a):i instanceof Sn&&Vr(t,e,n,i,a)}function Er(t,e,n,r){var a;const i=(a=r._geo)==null?void 0:a.loops;if(!(i!=null&&i.length))return;const o=r.elevation;for(const l of i)Tr(t,e,n,l,o)}function Zr(t,e,n,r){const a=pt(n,He(r)),i=[0];for(let c=0;c<r.numColumns;c++)i.push(i[c]+r.columnWidth(c));const o=[0];for(let c=0;c<r.numRows;c++)o.push(o[c]-r.rowHeight(c));const l=i[i.length-1],s=o[o.length-1];for(const c of o)N(t,e,a,{x:0,y:c,z:0},{x:l,y:c,z:0});for(const c of i)N(t,e,a,{x:c,y:0,z:0},{x:c,y:s,z:0})}function Or(t,e,n,r,a,i,o){const l=Dt(t.layer,n);if(o&&!o(l))return;const s=Cr(t,i);if(s&&!a.has(s.objectId)&&zr(s)){a.add(s.objectId);const d=pt(e,He(t));gt(s,d,l,r,a,i,o),a.delete(s.objectId);return}Zr(r,l,e,t);const c=y(e,t.position);r.push({kind:"point",layer:l,x:c.x,y:c.y})}function _r(t,e,n,r){let a=r.boundaryPath();if(a.length>1){const o=a[0],l=a[a.length-1];o.x===l.x&&o.y===l.y&&(o.z??0)===(l.z??0)&&(a=a.slice(0,-1))}a.length>=2&&J(t,e,n,a,!0);const i=y(n,r.position);t.push({kind:"point",layer:e,x:i.x,y:i.y})}function Dt(t,e){return t==="0"?e:t}function Nr(t,e,n,r,a,i,o){if(!t.visibility)return;const l=Dt(t.layer,n);if(!(o&&!o(l))){if(t instanceof nn){Or(t,e,n,r,a,i,o);return}if(Sr(t)){const s=Ue(t,i);if(!s||a.has(s.objectId))return;a.add(s.objectId);const c=pt(e,t.getFullInsertionTransform()),d=Dt(t.layer,n);gt(s,c,d,r,a,i,o),a.delete(s.objectId);return}if(t instanceof rn){const s=t,c=Lr(s,i);if(!c||a.has(c.objectId))return;a.add(c.objectId);const d=pt(e,s.getFullDimBlockTransform());gt(c,d,l,r,a,i,o),a.delete(c.objectId);return}if(kr(t)){Mr(r,l,e,t);return}if(t instanceof an){Ht(e)?jr(r,l,e,t.center,t.radius,t.normal):zt(r,l,e,Yr(t));return}if(t instanceof on){Ht(e)?$r(r,l,e,t):zt(r,l,e,Xr(t));return}if(t instanceof Rt){zt(r,l,e,t);return}if(t instanceof ln){Ur(r,l,e,t);return}if(t instanceof sn){Hr(r,l,e,t);return}if(t instanceof cn){Fr(r,l,e,t);return}if(t instanceof dn){const s=[];for(let c=0;c<t.numberOfVertices;c++)s.push(t.getPointAt(c));J(r,l,e,s,t.closed);return}if(t instanceof un){Er(r,l,e,t);return}if(t instanceof fn){ye(r,l,e,t.basePoint,t.unitDir,!1);return}if(t instanceof mn){ye(r,l,e,t.basePoint,t.unitDir,!0);return}if(t instanceof hn){const s=[t.getPointAt(0),t.getPointAt(1),t.getPointAt(2),t.getPointAt(3)];J(r,l,e,s,!0);return}if(t instanceof pn){const s=t.subGetGripPoints();s.length>=2&&J(r,l,e,s,s.length>=3);return}if(t instanceof gn){const s=t.vertices;s.length>=2&&J(r,l,e,s,!1);return}if(t instanceof bn){Ir(r,l,e,t);return}if(t instanceof wn){Br(r,l,e,t);return}if(t instanceof yn){const s=y(e,t.position);r.push({kind:"point",layer:l,x:s.x,y:s.y});return}if(t instanceof vn){const s=y(e,t.location);r.push({kind:"point",layer:l,x:s.x,y:s.y});return}if(t instanceof xn){_r(r,l,e,t);return}if(t instanceof An){const s=y(e,t.position);r.push({kind:"point",layer:l,x:s.x,y:s.y})}}}function gt(t,e,n,r,a,i,o){for(const l of t.newIterator())Nr(l,e,n,r,a,i,o)}function Yr(t){return new Rt(t.center,t.normal,{x:1,y:0,z:0},t.radius,t.radius,0,Mn)}function Xr(t){return new Rt(t.center,t.normal,{x:1,y:0,z:0},t.radius,t.radius,t.startAngle,t.endAngle)}function ve(t,e,n={}){const r=Ar(t,e);if(!r)return{primitives:[]};const a=[],i=new Vt;return gt(r,i,"0",a,new Set,t,n.includeLayer),{primitives:a}}function Wr(t){if(t==null||t==="")return null;const e=t.toLowerCase().replace("_","-");return e==="en"||e.startsWith("en-")?"en":e==="zh"||e.startsWith("zh")?"zh":null}const Gr='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M9.3333 14.125 5.875 10.6667V14.125H9.3333Zm4.7917-3.4583-3.4583 3.4583H14.125V10.6667ZM10.6667 5.875 14.125 9.3333V5.875H10.6667ZM5.875 9.3333 9.3333 5.875H5.875V9.3333Zm9.2083 5.475c1.2333-1.3 1.9083-3.0333 1.9083-4.825-.0083-3.325-2.35-6.1833-5.6083-6.8417C8.125 2.4833 4.85 4.2 3.55 7.2583c-1.3 3.0583-.275 6.6083 2.4583 8.5 2.725 1.8917 6.4167 1.6 8.8167-.6917.0917-.0833.175-.175.2583-.2583Zm1.2583.5917 2.575 2.575c-.3167.3167-.625.625-.9417.9417-.8583-.8583-1.7167-1.7167-2.575-2.575-3.4083 2.9-8.4917 2.5917-11.525-.6917S.9417 7.275 4.1083 4.1083C7.2667.9417 12.3667.8417 15.65 3.875s3.5917 8.1167.6917 11.525Z"/></svg>',Jr='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M3.75 9.25h12.5v1.5H3.75v-1.5ZM2.25 6.5h1.5v7h-1.5v-7ZM16.25 6.5h1.5v7h-1.5v-7Z"/></svg>',Kr='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><polygon fill="currentColor" points="5.74 7.13 7 9.5 4.15 7.72 3.2 7.12 3 7 7 4.5 6.17 6.05 5.67 7 5.74 7.13"/><polygon fill="currentColor" points="16 12.5 13.5 16.5 12.66 15.15 11.92 13.97 11 12.5 12 13.03 12.98 13.55 13.5 13.83 16 12.5"/><rect fill="currentColor" x="2" y="2.5" width="1" height="15"/><rect fill="currentColor" x="3" y="16.5" width="15" height="1"/><path fill="currentColor" d="M14,13c0,.18,0,.37,0,.55v0a6.82,6.82,0,0,1-.32,1.57l-.74-1.18L13,13.5c0-.14,0-.31,0-.47v0a6,6,0,0,0-6-6,6.74,6.74,0,0,0-1.26.13l-.29.07a5.61,5.61,0,0,0-1.3.52l-1-.6a7.07,7.07,0,0,1,2-.88,6.78,6.78,0,0,1,1-.19A7.7,7.7,0,0,1,7,6a7,7,0,0,1,7,7Z"/></svg>',qr='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><rect fill="currentColor" x="2" y="16" width="2" height="2"/><rect fill="currentColor" x="16" y="2" width="2" height="2"/><rect fill="currentColor" x="6.1" y="6.11" width="2" height="2"/><path fill="currentColor" d="M4.99,9.11c-1.15,1.74-1.94,3.74-2.24,5.89h.81c.32-2.18,1.16-4.18,2.39-5.89h-.96Z"/><path fill="currentColor" d="M9.1,5v.96c1.71-1.23,3.72-2.07,5.9-2.4v-.81c-2.16,.3-4.16,1.09-5.9,2.24Z"/></svg>',Qr='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M4 4h12v12H4V4Zm1.5 1.5v9h9v-9h-9Z"/><circle fill="currentColor" cx="4" cy="4" r="1.5"/><circle fill="currentColor" cx="16" cy="4" r="1.5"/><circle fill="currentColor" cx="4" cy="16" r="1.5"/><circle fill="currentColor" cx="16" cy="16" r="1.5"/></svg>',ta='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M9.25 2h1.5v5.25H16v1.5h-5.25V16h-1.5v-7.25H4v-1.5h5.25V2Z"/><circle fill="currentColor" cx="10" cy="10" r="1.75"/></svg>',ea='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>',na='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="m434.8 137.65-149.36-68.1c-16.19-7.4-42.69-7.4-58.88 0L77.3 137.65c-17.6 8-17.6 21.09 0 29.09l148 67.5c16.89 7.7 44.69 7.7 61.58 0l148-67.5c17.52-8 17.52-21.1-.08-29.09M160 308.52l-82.7 37.11c-17.6 8-17.6 21.1 0 29.1l148 67.5c16.89 7.69 44.69 7.69 61.58 0l148-67.5c17.6-8 17.6-21.1 0-29.1l-79.94-38.47"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="m160 204.48-82.8 37.16c-17.6 8-17.6 21.1 0 29.1l148 67.49c16.89 7.7 44.69 7.7 61.58 0l148-67.49c17.7-8 17.7-21.1.1-29.1L352 204.48"/></svg>',ra='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10.09 3.53 16.09 6.97 10.09 10.29 4.18 7 10.09 3.56M10.09 2.4 2.17 7 3.31 7.65 10.09 11.45 17 7.62 18.17 7 10.08 2.37 10.09 2.4Z"/><path fill="currentColor" d="M10.25 14.83 18.17 10.22 17 9.57 10.22 13.57 3.32 9.59 2.17 10.22 10.25 14.83Z"/><path fill="currentColor" d="M10.25 17.63 18.17 13 17 12.37 10.22 16.37 3.32 12.38 2.17 13 10.25 17.63Z"/></svg>',aa='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10.09 5.15 16.09 8.59 10.09 11.91 4.18 8.59 10.09 5.15ZM10.09 4 2.17 8.61 3.31 9.25 10.09 13.06 17 9.24 18.16 8.61 10.08 4 10.09 4Z"/><path fill="currentColor" d="M10.25 16.46 18.17 11.85 17 11.2 10.22 15.2 3.32 11.21 2.17 11.85 10.25 16.46Z"/><path fill="currentColor" d="M3.5 3.5 16.5 16.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',ia='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m18.5 10 4.4 11h-2.155l-1.201-3h-4.09l-1.199 3h-2.154L16.5 10h2zM10 2v2h6v2h-1.968a18.222 18.222 0 0 1-3.62 6.301 14.864 14.864 0 0 0 2.336 1.707l-.751 1.878A17.015 17.015 0 0 1 9 13.725 16.676 16.676 0 0 1 3.524 17.273l-.536-1.929a14.7 14.7 0 0 0 5.327-3.042A18.078 18.078 0 0 1 4.767 8h2.24A16.032 16.032 0 0 0 9 10.877 16.165 16.165 0 0 0 11.91 6.001L2 6V4h6V2h2zm7.5 10.885L16.253 16h2.492L17.5 12.885z"/></svg>',oa='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" aria-hidden="true"><path fill="currentColor" d="M600.704 64a32 32 0 0 1 30.464 22.208l35.2 109.376c14.784 7.232 28.928 15.36 42.432 24.512l112.384-24.192a32 32 0 0 1 34.432 15.36L944.32 364.8a32 32 0 0 1-4.032 37.504l-77.12 85.12a357 357 0 0 1 0 49.024l77.12 85.248a32 32 0 0 1 4.032 37.504l-88.704 153.6a32 32 0 0 1-34.432 15.296L708.8 803.904c-13.44 9.088-27.648 17.28-42.368 24.512l-35.264 109.376A32 32 0 0 1 600.704 960H423.296a32 32 0 0 1-30.464-22.208L357.696 828.48a352 352 0 0 1-42.56-24.64l-112.32 24.256a32 32 0 0 1-34.432-15.36L79.68 659.2a32 32 0 0 1 4.032-37.504l77.12-85.248a357 357 0 0 1 0-48.896l-77.12-85.248A32 32 0 0 1 79.68 364.8l88.704-153.6a32 32 0 0 1 34.432-15.296l112.32 24.256c13.568-9.152 27.776-17.408 42.56-24.64l35.2-109.312A32 32 0 0 1 423.232 64H600.64zm-23.424 64H446.72l-36.352 113.088l-24.512 11.968a294 294 0 0 0-34.816 20.096l-22.656 15.36l-116.224-25.088l-65.28 113.152l79.68 88.192l-1.92 27.136a293 293 0 0 0 0 40.192l1.92 27.136l-79.808 88.192l65.344 113.152l116.224-25.024l22.656 15.296a294 294 0 0 0 34.816 20.096l24.512 11.968L446.72 896h130.688l36.48-113.152l24.448-11.904a288 288 0 0 0 34.752-20.096l22.592-15.296l116.288 25.024l65.28-113.152l-79.744-88.192l1.92-27.136a293 293 0 0 0 0-40.256l-1.92-27.136l79.808-88.128l-65.344-113.152l-116.288 24.96l-22.592-15.232a288 288 0 0 0-34.752-20.096l-24.448-11.904L577.344 128zM512 320a192 192 0 1 1 0 384a192 192 0 0 1 0-384m0 64a128 128 0 1 0 0 256a128 128 0 0 0 0-256"/></svg>',la='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M3 2H2v16h16v-1H8v-5H3V2zm0 11v4h4v-4H3z"/></svg>',sa='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M16.98 11L18.5 11L18.5 10L16.98 10C16.86 8.13 16.05 6.44 14.8 5.2L16.88 2.83L16.12 2.17L14.05 4.54C12.79 3.57 11.21 3 9.5 3C5.36 3 2 6.36 2 10.5C2 14.64 5.36 18 9.5 18C13.47 18 16.73 14.91 16.98 11ZM15.98 10C15.86 8.43 15.18 7.01 14.14 5.95L10.6 10L15.98 10ZM13.39 5.29L8.4 11L15.98 11C15.73 14.36 12.92 17 9.5 17C5.91 17 3 14.09 3 10.5C3 6.91 5.91 4 9.5 4C10.96 4 12.31 4.48 13.39 5.29Z"/></svg>',ca='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e75958" d="M22 12H12l5 8.66A10 10 0 0 0 22 12Z"/><path fill="#814dff" d="M17 20.66 12 12 7 20.66A10 10 0 0 0 17 20.66Z"/><path fill="#13b0ce" d="M7 20.66 12 12H2A10 10 0 0 0 7 20.66Z"/><path fill="#4ecd83" d="M2 12H12L7 3.34A10 10 0 0 0 2 12Z"/><path fill="#ffc33f" d="M7 3.34 12 12l5-8.66A10 10 0 0 0 7 3.34Z"/><path fill="#ff9543" d="M17 3.34 12 12H22A10 10 0 0 0 17 3.34Z"/></svg>',da='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 6.5 5.5 11h9L10 6.5Z"/></svg>',M={zoomExtent:Gr,measureDistance:Jr,measureAngle:Kr,measureArc:qr,measureArea:Qr,measureCoordinate:ta,clearMeasurements:ea,layer:na,layerOn:ra,layerOff:aa,language:ia,setting:oa,orthoMode:la,polarTracking:sa,color:ca,chevronUp:da};function B(t,e,n){const r=Object.entries(n).map(([a,i])=>`${a}="${St(i)}"`).join(" ");return`<button type="button" class="mlcad-tool-btn" title="${St(e)}" aria-label="${St(e)}" ${r}>${t}</button>`}function St(t){return t.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}const ua=583902,fa=[90,45,30,23,18,10,5];function ma(t){return`#${t.toString(16).padStart(6,"0")}`}function ha(){const t=fa.map(e=>`<button type="button" class="mlcad-tool-btn mlcad-settings-option-btn mlcad-polar-angle-btn" data-polar-ang="${e}" title="${e}°" aria-label="${e}°"><span class="mlcad-settings-option-indicator" aria-hidden="true"></span><span class="mlcad-settings-option-text">${e}°</span></button>`).join("");return`
      <div id="mlcad-settings-wrap" hidden>
        <div id="mlcad-settings-strip" role="toolbar" data-i18n-attr="aria-label" data-i18n-key="settings.toolbar" aria-label="Measure settings">
          <button type="button" class="mlcad-tool-btn mlcad-color-btn" id="mlcad-measure-color-btn" data-i18n-key="settings.measureColor" data-i18n-attr="title aria-label" title="Measure color" aria-label="Measure color">
            ${M.color}
          </button>
          <input type="color" id="mlcad-measure-color-input" class="mlcad-color-input" value="${ma(ua)}" tabindex="-1" aria-hidden="true" />
          ${B(M.orthoMode,"Orthogonal mode",{id:"mlcad-ortho-btn","data-toggle":"ortho","data-i18n-key":"settings.ortho","data-i18n-attr":"title aria-label"})}
          ${B(M.polarTracking,"Polar tracking",{id:"mlcad-polar-btn","data-toggle":"polar","data-i18n-key":"settings.polar","data-i18n-attr":"title aria-label"})}
          <button type="button" class="mlcad-tool-btn mlcad-lang-btn" id="mlcad-lang-btn" data-i18n-key="toolbar.languageSwitch" data-i18n-attr="title aria-label" title="Switch language" aria-label="Switch language">
            ${M.language}
            <span class="mlcad-lang-badge" id="mlcad-lang-badge">EN</span>
          </button>
        </div>
        <div id="mlcad-polar-angles" role="group" data-i18n-attr="aria-label" data-i18n-key="settings.polarAngles" aria-label="Polar tracking angles" hidden>
          ${t}
        </div>
      </div>`}const pa=`
  :root {
    --mlcad-ui-bg: rgba(24, 26, 30, 0.94);
    --mlcad-ui-bg-elevated: rgba(32, 35, 40, 0.98);
    --mlcad-ui-border: rgba(255, 255, 255, 0.1);
    --mlcad-ui-text: #e8eaed;
    --mlcad-ui-muted: #9aa0a6;
    --mlcad-accent: #08e8de;
    --mlcad-accent-active: #1a8cff;
    --mlcad-measure-accent: #08e8de;
    --mlcad-measure-accent-border: rgba(8, 232, 222, 0.45);
    --mlcad-measure-accent-fill: rgba(8, 232, 222, 0.2);
    --mlcad-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    --mlcad-toolbar-width: 44px;
    --mlcad-drawer-width: 220px;
    --mlcad-drawer-gap: 8px;
    --mlcad-ui-inset: 12px;
    --mlcad-z-chrome: 7;
    --mlcad-z-measure: 5;
  }
  html, body {
    margin: 0; height: 100%; overflow: hidden;
    background: #121418;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    color: var(--mlcad-ui-text);
  }
  #mlcad-root { position: relative; width: 100%; height: 100%; }
  #mlcad-root canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }

  #mlcad-sidebar {
    position: absolute;
    left: var(--mlcad-ui-inset);
    top: 50%;
    z-index: var(--mlcad-z-chrome);
    transform: translateY(-50%);
    display: flex;
    align-items: flex-start;
    gap: var(--mlcad-drawer-gap);
    max-width: calc(100% - 2 * var(--mlcad-ui-inset));
    box-sizing: border-box;
    pointer-events: none;
  }
  #mlcad-sidebar > * { pointer-events: auto; }

  #mlcad-toolbar {
    flex-shrink: 0;
    display: flex; flex-direction: column; gap: 4px;
    padding: 6px;
    background: var(--mlcad-ui-bg);
    border: 1px solid var(--mlcad-ui-border);
    border-radius: 8px;
    box-shadow: var(--mlcad-shadow);
    backdrop-filter: blur(12px);
  }
  .mlcad-tool-btn {
    display: flex; align-items: center; justify-content: center;
    width: var(--mlcad-toolbar-width); height: var(--mlcad-toolbar-width);
    margin: 0; padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--mlcad-ui-text);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .mlcad-tool-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--mlcad-ui-border);
  }
  .mlcad-tool-btn.active {
    background: rgba(26, 140, 255, 0.22);
    border-color: rgba(26, 140, 255, 0.55);
    color: #fff;
  }
  .mlcad-tool-btn svg {
    width: 20px; height: 20px; display: block; flex-shrink: 0;
  }
  #mlcad-toolbar-toggle {
    height: calc(var(--mlcad-toolbar-width) / 2);
    margin-top: -4px;
    margin-bottom: -4px;
    border-radius: 4px;
  }
  #mlcad-toolbar-toggle svg {
    width: calc(var(--mlcad-toolbar-width) / 2);
    height: calc(var(--mlcad-toolbar-width) / 2);
  }
  #mlcad-toolbar > .mlcad-tool-separator:last-of-type {
    margin-top: 0;
    margin-bottom: 0;
  }
  .mlcad-lang-btn { position: relative; }
  .mlcad-lang-badge {
    position: absolute; right: 3px; bottom: 3px;
    min-width: 14px; height: 14px; padding: 0 3px;
    border-radius: 3px;
    background: rgba(8, 232, 222, 0.2);
    border: 1px solid rgba(8, 232, 222, 0.45);
    color: var(--mlcad-accent);
    font-size: 9px; font-weight: 700; line-height: 12px;
    letter-spacing: -0.02em;
    pointer-events: none;
  }

  #mlcad-layer-drawer {
    flex-shrink: 1;
    min-width: 0;
    width: var(--mlcad-drawer-width);
    max-height: min(420px, calc(100vh - 48px));
    display: flex; flex-direction: column;
    background: var(--mlcad-ui-bg-elevated);
    border: 1px solid var(--mlcad-ui-border);
    border-radius: 8px;
    box-shadow: var(--mlcad-shadow);
    backdrop-filter: blur(12px);
    overflow: hidden;
  }
  #mlcad-layer-drawer[hidden] { display: none; }

  .mlcad-drawer-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: 6px; padding: 8px 10px;
    border-bottom: 1px solid var(--mlcad-ui-border);
    font-size: 13px; font-weight: 600;
  }
  .mlcad-drawer-close {
    width: 28px; height: 28px; padding: 0;
    border: none; border-radius: 4px;
    background: transparent; color: var(--mlcad-ui-muted);
    cursor: pointer; font-size: 18px; line-height: 1;
  }
  .mlcad-drawer-close:hover {
    background: rgba(255, 255, 255, 0.08); color: var(--mlcad-ui-text);
  }

  .mlcad-layer-actions {
    display: flex; gap: 4px; padding: 6px 8px;
    border-bottom: 1px solid var(--mlcad-ui-border);
  }
  .mlcad-layer-action-btn {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 30px; padding: 4px 8px;
    border: 1px solid var(--mlcad-ui-border);
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.04);
    color: var(--mlcad-ui-text);
    font-size: 12px; cursor: pointer;
  }
  .mlcad-layer-action-btn:hover { background: rgba(255, 255, 255, 0.1); }
  .mlcad-layer-action-btn svg { width: 14px; height: 14px; flex-shrink: 0; }

  #mlcad-layer-list {
    flex: 1; overflow: auto; padding: 4px 0;
  }
  .mlcad-layer-item {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    align-items: center; gap: 6px;
    padding: 5px 8px;
    font-size: 12px; cursor: pointer;
  }
  .mlcad-layer-item:hover { background: rgba(255, 255, 255, 0.05); }
  .mlcad-layer-item input { margin: 0; cursor: pointer; }
  .mlcad-layer-swatch {
    width: 12px; height: 12px; border-radius: 2px;
    border: 1px solid rgba(255, 255, 255, 0.28);
  }
  .mlcad-layer-name {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .mlcad-layer-zoom {
    display: flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; padding: 0;
    border: 1px solid transparent; border-radius: 4px;
    background: transparent; color: var(--mlcad-ui-muted);
    cursor: pointer;
  }
  .mlcad-layer-zoom svg {
    width: 14px; height: 14px; display: block;
  }
  .mlcad-layer-zoom:hover:not(:disabled) {
    color: var(--mlcad-accent);
    border-color: var(--mlcad-ui-border);
    background: rgba(255, 255, 255, 0.06);
  }
  .mlcad-layer-zoom:disabled { opacity: 0.35; cursor: not-allowed; }

  #mlcad-status-bar {
    position: absolute; left: 12px; right: 12px; bottom: 10px; z-index: var(--mlcad-z-chrome);
    display: flex; align-items: center; min-height: 28px; padding: 0 12px;
    border: 1px solid var(--mlcad-ui-border);
    border-radius: 6px;
    background: var(--mlcad-ui-bg);
    color: var(--mlcad-ui-muted);
    font-size: 12px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(10px);
    pointer-events: none;
  }
  .mlcad-tool-separator {
    height: 1px;
    margin: 4px 8px;
    background: var(--mlcad-ui-border);
  }

  #mlcad-sidebar.mlcad-sidebar--collapsed #mlcad-settings-wrap,
  #mlcad-sidebar.mlcad-sidebar--collapsed #mlcad-layer-drawer {
    display: none !important;
  }
  #mlcad-sidebar.mlcad-sidebar--collapsed #mlcad-toolbar .mlcad-tool-btn:not(#mlcad-toolbar-toggle),
  #mlcad-sidebar.mlcad-sidebar--collapsed #mlcad-toolbar .mlcad-tool-separator {
    display: none;
  }

  #mlcad-settings-wrap {
    flex-shrink: 0;
    min-width: 0;
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: var(--mlcad-drawer-gap);
  }
  #mlcad-settings-wrap[hidden] { display: none; }

  #mlcad-settings-strip {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 6px;
    background: var(--mlcad-ui-bg);
    border: 1px solid var(--mlcad-ui-border);
    border-radius: 8px;
    box-shadow: var(--mlcad-shadow);
    backdrop-filter: blur(12px);
  }

  #mlcad-polar-angles {
    flex-shrink: 0;
    display: inline-flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 6px;
    max-width: min(280px, calc(100vw - 2 * var(--mlcad-ui-inset) - 3 * var(--mlcad-toolbar-width) - 3 * var(--mlcad-drawer-gap)));
    background: var(--mlcad-ui-bg);
    border: 1px solid var(--mlcad-ui-border);
    border-radius: 8px;
    box-shadow: var(--mlcad-shadow);
    backdrop-filter: blur(12px);
  }
  #mlcad-polar-angles[hidden] { display: none; }

  .mlcad-color-input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }
  .mlcad-settings-option-btn {
    width: 100%;
    box-sizing: border-box;
    height: var(--mlcad-toolbar-width);
    justify-content: flex-start;
    gap: 8px;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 500;
  }
  .mlcad-settings-option-indicator {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border: 1px solid var(--mlcad-ui-muted);
    border-radius: 2px;
    box-sizing: border-box;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .mlcad-settings-option-btn.active .mlcad-settings-option-indicator {
    background: var(--mlcad-accent);
    border-color: var(--mlcad-accent);
  }
  .mlcad-settings-option-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
    line-height: 1.2;
  }

  #mlcad-measure-overlays {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: var(--mlcad-z-measure);
    overflow: hidden;
  }
  .mlcad-measure-canvas {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }
  .mlcad-measure-dot {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--mlcad-measure-accent);
    border: 2px solid rgba(255, 255, 255, 0.9);
    box-sizing: border-box;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .mlcad-measure-badge {
    position: absolute;
    padding: 3px 10px;
    border-radius: 14px;
    background: var(--mlcad-ui-bg-elevated);
    border: 1px solid var(--mlcad-measure-accent-border);
    color: var(--mlcad-measure-accent);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    transform: translate(-50%, -50%);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  .mlcad-measure-badge--coordinate {
    transform: translate(-50%, calc(-50% - 16px));
  }
  .mlcad-measure-dot.mlcad-measure-selected {
    border-color: #ffd54f;
    box-shadow: 0 0 0 2px rgba(255, 213, 79, 0.55);
  }
  .mlcad-measure-badge.mlcad-measure-selected {
    border-color: rgba(255, 213, 79, 0.75);
    color: #ffd54f;
  }
  .mlcad-measure-canvas.mlcad-measure-selected {
    filter: drop-shadow(0 0 3px #ffd54f);
  }
  .mlcad-measure-live-label {
    position: absolute;
    pointer-events: none;
    color: var(--mlcad-measure-accent);
    font-size: 12px;
    font-weight: 600;
    text-shadow: 0 0 4px #000, 0 1px 3px #000;
    transform: translate(-50%, -120%);
    display: none;
  }
  #mlcad-loading {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    background: #121418;
    transition: opacity 0.35s ease, visibility 0.35s ease;
  }
  #mlcad-loading.mlcad-loading--done {
    opacity: 0; visibility: hidden; pointer-events: none;
  }
  .mlcad-loading-spinner {
    width: 48px; height: 48px; box-sizing: border-box;
    border: 3px solid rgba(255, 255, 255, 0.12);
    border-top-color: var(--mlcad-accent);
    border-radius: 50%;
    animation: mlcad-spin 0.85s linear infinite;
  }
  @keyframes mlcad-spin { to { transform: rotate(360deg); } }

  @media (max-width: 600px) {
    :root {
      --mlcad-drawer-width: min(200px, calc(100vw - 2 * var(--mlcad-ui-inset) - var(--mlcad-toolbar-width) - var(--mlcad-drawer-gap)));
      --mlcad-ui-inset: 8px;
    }
    #mlcad-sidebar {
      left: var(--mlcad-ui-inset);
      right: var(--mlcad-ui-inset);
      width: auto;
    }
    #mlcad-layer-drawer {
      margin-left: auto;
      max-width: calc(100vw - 2 * var(--mlcad-ui-inset) - var(--mlcad-toolbar-width) - var(--mlcad-drawer-gap));
    }
    .mlcad-layer-action-btn {
      min-height: 28px;
      padding: 3px 6px;
      font-size: 11px;
      gap: 4px;
    }
    .mlcad-layer-action-btn svg { width: 12px; height: 12px; }
    .mlcad-layer-zoom {
      width: 20px;
      height: 20px;
    }
    .mlcad-layer-zoom svg {
      width: 12px;
      height: 12px;
    }
  }
`;function ga(t){return`
  <div id="mlcad-loading" aria-hidden="true" style="background:${t}">
    <div class="mlcad-loading-spinner"></div>
  </div>
  <div id="mlcad-root">
    <aside id="mlcad-sidebar">
      <nav id="mlcad-toolbar" data-i18n-attr="aria-label" data-i18n-key="toolbar.viewerTools" aria-label="Viewer tools">
        ${B(M.zoomExtent,"Zoom extents",{"data-action":"fit","data-i18n-key":"toolbar.zoomExtents","data-i18n-attr":"title aria-label"})}
        ${B(M.measureDistance,"Measure distance",{"data-action":"measure","data-measure-mode":"distance","data-i18n-key":"toolbar.measureDistance","data-i18n-attr":"title aria-label"})}
        ${B(M.measureAngle,"Measure angle",{"data-action":"measure","data-measure-mode":"angle","data-i18n-key":"toolbar.measureAngle","data-i18n-attr":"title aria-label"})}
        ${B(M.measureArc,"Measure arc length",{"data-action":"measure","data-measure-mode":"arc","data-i18n-key":"toolbar.measureArc","data-i18n-attr":"title aria-label"})}
        ${B(M.measureArea,"Measure area",{"data-action":"measure","data-measure-mode":"area","data-i18n-key":"toolbar.measureArea","data-i18n-attr":"title aria-label"})}
        ${B(M.measureCoordinate,"Measure coordinates",{"data-action":"measure","data-measure-mode":"coordinate","data-i18n-key":"toolbar.measureCoordinate","data-i18n-attr":"title aria-label"})}
        ${B(M.clearMeasurements,"Clear measurements",{"data-action":"clear-measurements","data-i18n-key":"toolbar.clearMeasurements","data-i18n-attr":"title aria-label"})}
        <div class="mlcad-tool-separator" aria-hidden="true"></div>
        ${B(M.layer,"Layers",{id:"mlcad-layers-btn","aria-haspopup":"dialog","aria-expanded":"false","data-i18n-key":"toolbar.layers","data-i18n-attr":"title aria-label"})}
        ${B(M.setting,"Measure settings",{id:"mlcad-settings-btn","aria-haspopup":"true","aria-expanded":"false","data-i18n-key":"toolbar.settings","data-i18n-attr":"title aria-label"})}
        <div class="mlcad-tool-separator" aria-hidden="true"></div>
        ${B(M.chevronUp,"Collapse toolbar",{id:"mlcad-toolbar-toggle","aria-expanded":"true","data-i18n-key":"toolbar.collapse","data-i18n-attr":"title aria-label"})}
      </nav>
      ${ha()}
      <div id="mlcad-layer-drawer" role="dialog" data-i18n-attr="aria-label" data-i18n-key="layers.title" aria-label="Layers" hidden>
        <div class="mlcad-drawer-header">
          <span data-i18n-key="layers.title" data-i18n-text>Layers</span>
          <button type="button" class="mlcad-drawer-close" id="mlcad-layer-close" data-i18n-key="layers.close" data-i18n-attr="aria-label" aria-label="Close layers">×</button>
        </div>
        <div class="mlcad-layer-actions">
          <button type="button" class="mlcad-layer-action-btn" id="mlcad-layer-show-all">
            ${M.layerOn}<span data-i18n-key="layers.showAll" data-i18n-text>Show all</span>
          </button>
          <button type="button" class="mlcad-layer-action-btn" id="mlcad-layer-hide-all">
            ${M.layerOff}<span data-i18n-key="layers.hideAll" data-i18n-text>Hide all</span>
          </button>
        </div>
        <div id="mlcad-layer-list"></div>
      </div>
    </aside>
    <footer id="mlcad-status-bar" aria-live="polite"></footer>
  </div>`}function xe(t,e){const n=e.title??t.meta.title??"CAD Drawing",r=qn(t),a=e.viewerRuntime,i=Qn(),o=`#${t.meta.background.toString(16).padStart(6,"0")}`;return`<!DOCTYPE html>
<html lang="${Wr(t.meta.locale)??"en"}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="generator" content="mlightcad-cad-html-plugin" />
  <title>${ba(n)}</title>
  <style>${pa}</style>
</head>
<body>
${ga(o)}
  <script id="mlcad-snapshot" type="${i}+gzip;base64">${r}<\/script>
  <script>${wa(a)}<\/script>
</body>
</html>`}function ba(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function wa(t){return t.replace(/<\/script/gi,"<\\/script")}const ya=400;function dt(t={}){return{exportInvisibleLayers:t.exportInvisibleLayers!==!1,initialView:t.initialView??"fit"}}function va(t){const e=t.activeLayoutView,n=e.center,r=e.trCamera.zoom,a=Math.max(e.height,1),i=r*(2*ya)/a;return{centerX:n.x,centerY:n.y,zoom:i}}function xa(){return{minX:0,minY:0,maxX:0,maxY:0,valid:!1}}function Aa(t,e,n){if(e.length<3)return;const r=n[0],a=n[1];for(let i=0;i+2<e.length;i+=3){const o=pe(e[i],r),l=pe(e[i+1],a);t.valid?(o<t.minX&&(t.minX=o),o>t.maxX&&(t.maxX=o),l<t.minY&&(t.minY=l),l>t.maxY&&(t.maxY=l)):(t.minX=t.maxX=o,t.minY=t.maxY=l,t.valid=!0)}}function Ae(t,e){Aa(t,e.positions,e.offset)}function ka(t){return t.valid?{minX:t.minX,minY:t.minY,maxX:t.maxX,maxY:t.maxY}:null}function Ma(t,e){const n=xa();for(const r of t)Ae(n,r);for(const r of e)Ae(n,r);return ka(n)}class La{build(e,n,r={}){return this.buildSync(e,n,r)}async buildAsync(e,n,r={}){await D();const a=r.exportInvisibleLayers!==!1,i=a?void 0:c=>rt(e,c,a),o=we(n,{title:r.title,background:r.background}),l=[];e.layers.forEach(c=>{rt(e,c.name,a)&&l.push({name:c.name,color:c.color.RGB??16777215,visible:!c.isOff&&!c.isFrozen})});const s=[];for(const[c,d]of e.layouts){const u=[],f=[];for(const[,h]of d.layers){if(!rt(e,h.name,a))continue;const g=be(h.internalObject);u.push(...g.lineBatches),f.push(...g.meshBatches),await D()}s.push({btrId:c,name:Me(n,c),isModelSpace:c===e.modelSpaceBtrId,lineBatches:u,meshBatches:f,osnap:ve(n,c,{includeLayer:i})}),await D()}return{version:ut,meta:ke(o,r,s,e.activeLayoutBtrId||e.modelSpaceBtrId),layers:l,layouts:s,activeLayoutBtrId:e.activeLayoutBtrId||e.modelSpaceBtrId}}buildSync(e,n,r){const a=r.exportInvisibleLayers!==!1,i=a?void 0:c=>rt(e,c,a),o=we(n,{title:r.title,background:r.background}),l=[];e.layers.forEach(c=>{rt(e,c.name,a)&&l.push({name:c.name,color:c.color.RGB??16777215,visible:!c.isOff&&!c.isFrozen})});const s=[];return e.layouts.forEach((c,d)=>{const u=[],f=[];for(const[,h]of c.layers){if(!rt(e,h.name,a))continue;const g=be(h.internalObject);u.push(...g.lineBatches),f.push(...g.meshBatches)}s.push({btrId:d,name:Me(n,d),isModelSpace:d===e.modelSpaceBtrId,lineBatches:u,meshBatches:f,osnap:ve(n,d,{includeLayer:i})})}),{version:ut,meta:ke(o,r,s,e.activeLayoutBtrId||e.modelSpaceBtrId),layers:l,layouts:s,activeLayoutBtrId:e.activeLayoutBtrId||e.modelSpaceBtrId}}}function ke(t,e,n,r){const a=n.find(l=>l.btrId===r)??n[0],i=a?Ma(a.lineBatches,a.meshBatches):null,o=e.initialView??"fit";return{title:t.title,createdAt:new Date().toISOString(),extents:t.extents,viewExtents:i??void 0,units:t.units,background:t.background,locale:e.locale??A.currentLocale,initialView:o,viewState:o==="current"?e.viewState:void 0}}function rt(t,e,n){if(n)return!0;const r=t.layers.get(e);return r?!r.isOff&&!r.isFrozen:!0}function Me(t,e){for(const n of t.tables.blockTable.newIterator())if(n.objectId===e)return n.name;return e}const Ca="./viewer-runtime.iife.js";class za{constructor(){this._snapshotBuilder=new La}async prepareAcTrView2dForHtmlExport(e,n={}){if(!e||!("cadScene"in e)||!e.cadScene)throw new Error("CAD scene is not available. Open a drawing before exporting to HTML.");if(!(e instanceof We))throw new Error("HTML export requires a 2D CAD view. Open a drawing before exporting.");const r=dt(n);return await e.ensureEntitiesConvertedForExport({includeInvisibleLayers:r.exportInvisibleLayers}),await D(),e}async convert(e,n={},r){const a=ft.instance,i=dt(n);a.showBusyIndicator();try{await D();const o=a.curDocument,l=await this.prepareAcTrView2dForHtmlExport(r??a.curView,i),s=e||o.fileName||o.docTitle,c=await this._snapshotBuilder.buildAsync(l.cadScene,o.database,{title:Ge(s),background:l.backgroundColor,exportInvisibleLayers:i.exportInvisibleLayers,initialView:i.initialView,viewState:i.initialView==="current"?va(l):void 0});await D();const d=await this.loadViewerRuntime(a.htmlViewerRuntimeUrl);await D();const u=xe(c,{title:c.meta.title,viewerRuntime:d});await D(),this.downloadHtml(u,Je(s,"html"))}finally{a.hideBusyIndicator()}}async packSnapshot(e,n){const r=ft.instance;r.showBusyIndicator();try{await D();const a=await this.loadViewerRuntime(r.htmlViewerRuntimeUrl);await D();const i=xe(e,{title:e.meta.title,viewerRuntime:a});await D(),this.downloadHtml(i,n)}finally{r.hideBusyIndicator()}}async loadViewerRuntime(e){const n=e!=null?String(e):Ca,r=await fetch(n);if(!r.ok)throw new Error(`Failed to load HTML viewer runtime from "${n}" (${r.status}). Build @mlightcad/cad-html-plugin and copy viewer-runtime.iife.js to your app assets.`);return r.text()}downloadHtml(e,n){const r=new Blob([e],{type:"text/html;charset=utf-8"}),a=URL.createObjectURL(r),i=document.createElement("a");i.href=a,i.download=n,document.body.appendChild(i),i.click(),document.body.removeChild(i),window.setTimeout(()=>URL.revokeObjectURL(a),6e4)}}class Sa extends Xe{async execute(e){const n=await this.promptOptions();n&&await new za().convert(e.doc.fileName||e.doc.docTitle,n,e.view)}async promptOptions(){const e=await this.promptExportInvisibleLayers();if(e===void 0)return;const n=await this.promptInitialView();if(n!==void 0)return dt({exportInvisibleLayers:e,initialView:n})}async promptExportInvisibleLayers(){const e=dt(),n=e.exportInvisibleLayers?"Yes":"No",r=new te(`${A.t("jig.chtml.exportInvisibleLayers")} <${n}>`);r.allowNone=!0;const a=r.keywords.add(A.t("jig.chtml.keywords.yes.display"),A.t("jig.chtml.keywords.yes.global"),A.t("jig.chtml.keywords.yes.local")),i=r.keywords.add(A.t("jig.chtml.keywords.no.display"),A.t("jig.chtml.keywords.no.global"),A.t("jig.chtml.keywords.no.local"));r.keywords.default=e.exportInvisibleLayers?a:i;const o=await ft.instance.editor.getKeywords(r);if(o.status!==X.Cancel){if(o.status===X.None)return e.exportInvisibleLayers;if(o.status===X.OK||o.status===X.Keyword)return o.stringResult?o.stringResult==="Yes":e.exportInvisibleLayers}}async promptInitialView(){const e=dt(),n=e.initialView==="current"?A.t("jig.chtml.keywords.current.global"):A.t("jig.chtml.keywords.extents.global"),r=new te(`${A.t("jig.chtml.initialView")} <${n}>`);r.allowNone=!0;const a=r.keywords.add(A.t("jig.chtml.keywords.extents.display"),A.t("jig.chtml.keywords.extents.global"),A.t("jig.chtml.keywords.extents.local")),i=r.keywords.add(A.t("jig.chtml.keywords.current.display"),A.t("jig.chtml.keywords.current.global"),A.t("jig.chtml.keywords.current.local"));r.keywords.default=e.initialView==="current"?i:a;const o=await ft.instance.editor.getKeywords(r);if(o.status!==X.Cancel){if(o.status===X.None)return e.initialView;if(o.status===X.OK||o.status===X.Keyword)return o.stringResult?o.stringResult==="Current"?"current":"fit":e.initialView}}}class Ia{constructor(){this.name="HtmlPlugin",this.version="1.0.0",this.description="HTML export (chtml) command",this.registeredCommands=[]}onLoad(e,n){const r=Ye.SYSTEMT_COMMAND_GROUP_NAME;n.addCommand(r,"chtml","chtml",new Sa),this.registeredCommands.push({group:r,name:"chtml"})}onUnload(e,n){for(const r of this.registeredCommands)n.removeCmd(r.group,r.name);this.registeredCommands=[]}}async function Fa(){return new Ia}export{ut as ACEX_SNAPSHOT_VERSION,Sa as AcApExportHtmlCmd,za as AcApHtmlConvertor,La as AcApHtmlSnapshotBuilder,Ua as HTML_PLUGIN_NAME,Ha as HTML_PLUGIN_TRIGGERS,ve as buildOsnapCatalog,we as buildViewerMetadata,va as captureAcApHtmlViewState,be as collectBatchesFromObject3D,Fa as createHtmlPlugin,qn as encodeSnapshot,Yn as encodeSnapshotBinary,fr as exportActiveBatchedLine2Slice,_t as exportActiveBatchedSlice,ge as exportBufferGeometrySlice,xe as packHtml,dt as resolveAcApHtmlExportOptions,Wr as resolveAcExHtmlLocale,Qn as snapshotMimeType};
