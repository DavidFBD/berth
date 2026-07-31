/**
 * <silk-shader> — generative silk field, ported verbatim from the design
 * system (silk-shader.js). Raw WebGL, no libraries.
 *
 * Attributes:
 *   colors  "#hex,#hex,#hex,#hex"  4-stop palette, dark→bright folds (c0 doubles as the quiet-zone paper)
 *   quiet   "cx,cy,rx,ry"          elliptical calm zone in uv coords (y up), omit or "none" to disable
 *   speed   float (1)              advection multiplier — keep glacial
 *   scale   float (1.5)            noise zoom
 *   glow    float (0.5)            internal luminosity in the brightest folds
 *
 * Falls back to a static CSS gradient when WebGL is unavailable; renders one
 * still frame under prefers-reduced-motion; pauses offscreen. The module is
 * SSR-safe: importing it on the server is a no-op.
 */

const VS = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
const FS = `
precision highp float;
uniform vec2 u_res;uniform float u_time;uniform float u_aspect;
uniform vec3 u_c0,u_c1,u_c2,u_c3;uniform vec4 u_quiet;
uniform float u_speed,u_scale,u_glow;
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
  vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;
  i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
  m=m*m;m=m*m;
  vec3 x=2.0*fract(p*C.www)-1.0;
  vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.0*dot(m,g);
}
float fbm(vec2 p){float v=0.0;float a=0.5;
  for(int i=0;i<5;i++){v+=a*snoise(p);p=p*2.03+vec2(17.3,9.1);a*=0.5;}
  return v*0.5+0.5;}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res;
  float t=u_time*u_speed;
  vec2 p=vec2(uv.x*u_aspect,uv.y)*u_scale;
  /* narrative: the weave is dense low, relaxes and brightens as it rises — steam leaving tea */
  p.y*=mix(1.18,0.92,uv.y);
  p+=vec2(0.012*t,-0.018*t);
  vec2 q=vec2(fbm(p+0.011*t),fbm(p+vec2(5.2,1.3)-0.008*t));
  vec2 r=vec2(fbm(p+1.7*q+vec2(1.7,9.2)+0.013*t),fbm(p+1.7*q+vec2(8.3,2.8)-0.010*t));
  float f=fbm(p+1.9*r);
  f=clamp(f+0.05*uv.y,0.0,1.0);
  vec3 col=mix(u_c0,u_c1,smoothstep(0.16,0.42,f));
  col=mix(col,u_c2,smoothstep(0.44,0.68,f));
  col=mix(col,u_c3,smoothstep(0.70,0.93,f));
  col+=u_glow*vec3(0.10,0.085,0.06)*smoothstep(0.80,0.97,f);
  if(u_quiet.z>0.0){
    vec2 d=(uv-u_quiet.xy)/u_quiet.zw;
    col=mix(col,u_c0,0.8*(1.0-smoothstep(0.55,1.15,length(d))));
  }
  col+=(hash(gl_FragCoord.xy+fract(u_time))-0.5)/255.0;
  gl_FragColor=vec4(col,1.0);
}`;

const hex = (s: string): [number, number, number] => {
  s = s.trim().replace("#", "");
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  const n = parseInt(s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

if (typeof window !== "undefined" && !customElements.get("silk-shader")) {
  class SilkShader extends HTMLElement {
    static get observedAttributes() {
      return ["colors", "quiet", "speed", "scale", "glow"];
    }
    private _fb: HTMLDivElement;
    private _canvas: HTMLCanvasElement;
    private _t0: number;
    private _visible = true;
    private _raf = 0;
    private _gl: WebGLRenderingContext | null = null;
    private _prog: WebGLProgram | null = null;
    private _u: Record<string, WebGLUniformLocation | null> = {};
    private _ro?: ResizeObserver;
    private _io?: IntersectionObserver;
    private _reduced = false;
    private _pal: [number, number, number][] = [];
    private _quiet: number[] = [0, 0, 0, 0];
    private _speed = 1;
    private _scale = 1.5;
    private _glow = 0.5;

    constructor() {
      super();
      const sh = this.attachShadow({ mode: "open" });
      sh.innerHTML = `<style>:host{display:block;position:relative;overflow:hidden;contain:strict}
.fb,canvas{position:absolute;inset:0;width:100%;height:100%}</style><div class="fb"></div><canvas></canvas>`;
      this._fb = sh.querySelector(".fb") as HTMLDivElement;
      this._canvas = sh.querySelector("canvas") as HTMLCanvasElement;
      this._t0 = performance.now() / 1000 - Math.random() * 120; // desync instances, non-repeating
    }

    connectedCallback() {
      const gl = (this._gl = this._canvas.getContext("webgl", {
        antialias: false,
        depth: false,
        stencil: false,
        alpha: false,
        preserveDrawingBuffer: true,
      }));
      this._readAttrs();
      this._paintFallback();
      if (!gl) {
        this._canvas.style.display = "none";
        return;
      }
      const mk = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
          console.error("silk-shader compile:", gl.getShaderInfoLog(s));
        return s;
      };
      const prog = (this._prog = gl.createProgram()!);
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error("silk-shader link:", gl.getProgramInfoLog(prog));
        return;
      }
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "a");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this._u = {};
      for (const n of ["u_res", "u_time", "u_aspect", "u_c0", "u_c1", "u_c2", "u_c3", "u_quiet", "u_speed", "u_scale", "u_glow"])
        this._u[n] = gl.getUniformLocation(prog, n);
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this);
      this._io = new IntersectionObserver((es) => {
        this._visible = es[0].isIntersecting;
        if (this._visible) this._start();
        else this._stop();
      });
      this._io.observe(this);
      this._reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this._resize();
      this._drawOnce();
      this._start();
    }

    disconnectedCallback() {
      this._stop();
      this._ro?.disconnect();
      this._io?.disconnect();
    }

    attributeChangedCallback() {
      this._readAttrs();
      this._paintFallback();
      if (this._gl && this._prog) this._drawOnce();
    }

    private _readAttrs() {
      const cs = (this.getAttribute("colors") || "#f4eee0,#e9dcc4,#dcd2e8,#f8f2e3").split(",");
      this._pal = [0, 1, 2, 3].map((i) => hex(cs[Math.min(i, cs.length - 1)]));
      const q = this.getAttribute("quiet");
      this._quiet = q && q !== "none" ? q.split(",").map(Number) : [0, 0, 0, 0];
      this._speed = parseFloat(this.getAttribute("speed") || "1");
      this._scale = parseFloat(this.getAttribute("scale") || "1.5");
      this._glow = parseFloat(this.getAttribute("glow") || "0.5");
    }

    private _paintFallback() {
      const c = (this.getAttribute("colors") || "#f4eee0,#e9dcc4,#dcd2e8").split(",");
      this._fb.style.background = `linear-gradient(160deg, ${c[0]}, ${c[1] || c[0]} 45%, ${c[2] || c[0]})`;
    }

    private _resize() {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      const r = this.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const w = Math.max(2, Math.round(r.width * dpr));
      const h = Math.max(2, Math.round(r.height * dpr));
      if (this._canvas.width !== w || this._canvas.height !== h) {
        this._canvas.width = w;
        this._canvas.height = h;
        this._gl?.viewport(0, 0, w, h);
      }
      if (this._reduced) this._drawOnce();
    }

    private _draw(t: number) {
      const gl = this._gl!;
      const u = this._u;
      gl.useProgram(this._prog);
      gl.uniform2f(u.u_res, this._canvas.width, this._canvas.height);
      gl.uniform1f(u.u_time, t);
      gl.uniform1f(u.u_aspect, this._canvas.width / this._canvas.height);
      gl.uniform3fv(u.u_c0, this._pal[0]);
      gl.uniform3fv(u.u_c1, this._pal[1]);
      gl.uniform3fv(u.u_c2, this._pal[2]);
      gl.uniform3fv(u.u_c3, this._pal[3]);
      gl.uniform4fv(u.u_quiet, this._quiet);
      gl.uniform1f(u.u_speed, this._speed);
      gl.uniform1f(u.u_scale, this._scale);
      gl.uniform1f(u.u_glow, this._glow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    private _drawOnce() {
      if (this._gl && this._prog)
        this._draw(this._reduced ? 90 : performance.now() / 1000 - this._t0);
    }

    private _start() {
      if (this._raf || !this._gl || !this._prog) return;
      if (this._reduced) {
        this._drawOnce();
        return;
      }
      const loop = () => {
        this._raf = 0;
        if (!this._visible || !this.isConnected) return;
        this._draw(performance.now() / 1000 - this._t0);
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    private _stop() {
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
    }
  }
  customElements.define("silk-shader", SilkShader);
}

/** Attributes the <silk-shader> element accepts from JSX. */
type SilkShaderAttributes = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  colors?: string;
  quiet?: string;
  speed?: string;
  scale?: string;
  glow?: string;
};

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- JSX augmentation requires the namespace form
  namespace JSX {
    interface IntrinsicElements {
      "silk-shader": SilkShaderAttributes;
    }
  }
}

export {};
