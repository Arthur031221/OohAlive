// WebGL2 flow-map renderer. The preview and the GIF export both go through
// draw(), so what you watch is what you download.

export const MAX_ARROWS = 6
export const BORDER_FADE = 0.06

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

// Every pixel sums a Gaussian pull from each arrow (distance to the arrow
// segment, so a long arrow moves a long stretch of picture), scaled down by
// the freeze mask and faded to zero at the border. Two copies of the photo
// slide along that field half a loop apart and cross-fade, which hides the
// reset of each copy. A slow sine pattern shifts the phase from place to
// place, so the cross-fade blur does not breathe over the whole picture at
// once. Everything depends on the phase only through fract(), so the loop
// closes without a jump.
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPhoto;
uniform sampler2D uFreeze;
uniform vec4 uArrows[${MAX_ARROWS}];
uniform int uCount;
uniform float uPhase;
uniform float uRadius;
uniform float uSpeed;
uniform float uStrength;
uniform vec2 uAspect;
in vec2 vUv;
out vec4 outColor;

vec2 pull(vec2 uv) {
  vec2 acc = vec2(0.0);
  float total = 0.0;
  vec2 p = uv * uAspect;
  for (int i = 0; i < ${MAX_ARROWS}; i++) {
    if (i >= uCount) break;
    vec2 a = uArrows[i].xy * uAspect;
    vec2 ab = uArrows[i].zw * uAspect - a;
    float len2 = dot(ab, ab);
    if (len2 < 1e-8) continue;
    float t = clamp(dot(p - a, ab) / len2, 0.0, 1.0);
    vec2 d = p - (a + ab * t);
    float w = exp(-0.5 * dot(d, d) / (uRadius * uRadius));
    acc += w * ab * inversesqrt(len2);
    total += w;
  }
  return acc / max(1.0, total);
}

vec3 layer(vec2 uv, vec2 field, float phase) {
  vec2 src = uv - field * (phase - 0.5) * uSpeed / uAspect;
  src = mix(src, uv, texture(uFreeze, src).r);
  return texture(uPhoto, src).rgb;
}

void main() {
  vec2 edge = min(vUv, 1.0 - vUv) * uAspect;
  float fade = smoothstep(0.0, ${BORDER_FADE.toFixed(3)}, min(edge.x, edge.y));
  vec2 field = pull(vUv) * fade * (1.0 - texture(uFreeze, vUv).r) * uStrength;
  vec2 q = vUv * uAspect;
  float shift = 0.1 * (sin(7.0 * q.x + 3.0 * q.y) + sin(5.0 * q.y - 4.0 * q.x + 1.0));
  float a = fract(uPhase + shift);
  float b = fract(uPhase + shift + 0.5);
  float weightA = 1.0 - abs(2.0 * a - 1.0);
  vec3 color = mix(layer(vUv, field, b), layer(vUv, field, a), weightA);
  outColor = vec4(color, 1.0);
}`

export class WebGLUnavailable extends Error {
  constructor() {
    super('WebGL2 is not available in this browser')
    this.name = 'WebGLUnavailable'
  }
}

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader failed to compile: ${gl.getShaderInfoLog(shader)}`)
  }
  return shader
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas
    this.photo = null
    this.freeze = null
    canvas.addEventListener('webglcontextlost', (event) => event.preventDefault())
    canvas.addEventListener('webglcontextrestored', () => {
      this.#setup()
      this.onRestore?.()
    })
    this.#setup()
  }

  #setup() {
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false })
    if (!gl) throw new WebGLUnavailable()
    this.gl = gl
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program failed to link: ${gl.getProgramInfoLog(program)}`)
    }
    gl.useProgram(program)
    this.uniforms = Object.fromEntries(
      ['uPhoto', 'uFreeze', 'uArrows', 'uCount', 'uPhase', 'uRadius', 'uSpeed', 'uStrength', 'uAspect'].map((name) => [
        name,
        gl.getUniformLocation(program, name),
      ]),
    )
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const location = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
    this.photoTexture = this.#texture(0, true)
    this.freezeTexture = this.#texture(1, false)
    gl.uniform1i(this.uniforms.uPhoto, 0)
    gl.uniform1i(this.uniforms.uFreeze, 1)
    if (this.photo) this.setPhoto(this.photo)
    this.setFreeze(this.freeze)
  }

  #texture(unit, mipmapped) {
    const { gl } = this
    const texture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  /** Any canvas or image source. The renderer keeps a reference for context restores. */
  setPhoto(source) {
    const { gl } = this
    this.photo = source
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.photoTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.generateMipmap(gl.TEXTURE_2D)
  }

  /** A canvas whose red channel is the frozen amount, or null for nothing frozen. */
  setFreeze(source) {
    const { gl } = this
    this.freeze = source
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.freezeTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    if (source) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    }
  }

  resize(width, height) {
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
  }

  /**
   * params: { arrows: [{ x0, y0, x1, y1 }] in 0..1 image coordinates,
   * radius and speed in image heights, strength 0..1 fades the motion to
   * the untouched photo }. phase is a loop position in 0..1, one full repeat
   * of the motion.
   */
  draw({ arrows, radius, speed, strength = 1 }, phase) {
    const { gl, uniforms } = this
    const { width, height } = this.canvas
    const flat = new Float32Array(MAX_ARROWS * 4)
    const used = arrows.slice(0, MAX_ARROWS)
    used.forEach((a, i) => flat.set([a.x0, a.y0, a.x1, a.y1], i * 4))
    gl.viewport(0, 0, width, height)
    gl.uniform4fv(uniforms.uArrows, flat)
    gl.uniform1i(uniforms.uCount, used.length)
    // The two copies of the photo swap places after half a cycle, so the picture
    // repeats every half cycle. Scale the phase so that 0..1 is exactly one repeat.
    gl.uniform1f(uniforms.uPhase, (phase - Math.floor(phase)) * 0.5)
    gl.uniform1f(uniforms.uRadius, radius)
    gl.uniform1f(uniforms.uSpeed, speed)
    gl.uniform1f(uniforms.uStrength, strength)
    gl.uniform2f(uniforms.uAspect, width / height, 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** RGBA pixels of the last draw, top row first. Call right after draw(). */
  read() {
    const { gl } = this
    const { width, height } = this.canvas
    const bottomUp = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp)
    const out = new Uint8ClampedArray(bottomUp.length)
    const stride = width * 4
    for (let y = 0; y < height; y++) {
      out.set(bottomUp.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride)
    }
    return out
  }
}
