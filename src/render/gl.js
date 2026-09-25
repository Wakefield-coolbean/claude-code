// WebGL2 helpers
export function compileShader(gl, type, src, name) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(`Shader compile error (${name}):\n${log}\n${numbered}`);
  }
  return sh;
}

export class Program {
  constructor(gl, vs, fs, name = 'program') {
    this.gl = gl;
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs, name + '.vs'));
    gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs, name + '.fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Link error (${name}): ${gl.getProgramInfoLog(p)}`);
    this.p = p;
    this.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const nm = info.name.replace(/\[0\]$/, '');
      this.u[nm] = gl.getUniformLocation(p, info.name);
    }
  }
  use() { this.gl.useProgram(this.p); return this; }
}

// Shared index buffer for quads (0,1,2, 0,2,3 ...)
export function createQuadIndexBuffer(gl, maxQuads) {
  const idx = new Uint32Array(maxQuads * 6);
  for (let q = 0; q < maxQuads; q++) {
    const b = q * 4, o = q * 6;
    idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
    idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  return buf;
}
