/// <reference types="@webgpu/types" />
import './style.css'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="canvas-container">
    <canvas id="webgpu-canvas"></canvas>
  </div>

  <div class="ui-overlay">
    <h1>AUDIO-REACTIVO CON WEBGPU</h1>
    <input type="file" id="audio-file-input" accept="audio/*" />
    <audio id="audio-element" controls style="display: none;"></audio>
    <div id="track-info" style="font-size: 12px; color: #64748b;">Sube una pista de audio para empezar</div>

    <div class="controls-panel">
      <div class="control-row">
        <label for="particle-count-slider">Partículas: <span id="particle-count-label">180</span></label>
        <input type="range" id="particle-count-slider" min="30" max="480" step="3" value="180" />
      </div>
      <div class="control-row">
        <label for="rotation-speed-slider">Velocidad de rotación: <span id="rotation-speed-label">1.00</span></label>
        <input type="range" id="rotation-speed-slider" min="0" max="3" step="0.05" value="1" />
      </div>
      <div class="control-row">
        <label for="sensitivity-slider">Sensibilidad de audio: <span id="sensitivity-label">1.00</span></label>
        <input type="range" id="sensitivity-slider" min="0" max="3" step="0.05" value="1" />
      </div>
    </div>

    <div id="hint-text">
      Arrastra el ratón sobre el lienzo para rotar y desplazar · Rueda del ratón para zoom · Flechas para mover la cámara
    </div>
  </div>
`

// ---------- Estilos inyectados para el panel de control (estética oscura) ----------
const styleTag = document.createElement('style')
styleTag.textContent = `
  .controls-panel {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    background: rgba(15, 23, 42, 0.55);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 10px;
    backdrop-filter: blur(6px);
    max-width: 280px;
  }
  .control-row { display: flex; flex-direction: column; gap: 4px; }
  .control-row label { font-size: 11px; color: #94a3b8; letter-spacing: 0.02em; }
  .control-row input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(90deg, #38bdf8, #a855f7);
    outline: none;
  }
  .control-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #e2e8f0;
    border: 2px solid #0f172a;
    cursor: pointer;
  }
  .control-row input[type="range"]::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #e2e8f0;
    border: 2px solid #0f172a;
    cursor: pointer;
  }
  #hint-text { font-size: 11px; color: #475569; margin-top: 8px; max-width: 280px; }
  #webgpu-canvas { cursor: grab; touch-action: none; }
  #webgpu-canvas:active { cursor: grabbing; }
`
document.head.appendChild(styleTag)

const fileInput = document.getElementById('audio-file-input') as HTMLInputElement
const audioElement = document.getElementById('audio-element') as HTMLAudioElement
const trackInfo = document.getElementById('track-info') as HTMLDivElement
const canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement

const particleCountSlider = document.getElementById('particle-count-slider') as HTMLInputElement
const particleCountLabel = document.getElementById('particle-count-label') as HTMLSpanElement
const rotationSpeedSlider = document.getElementById('rotation-speed-slider') as HTMLInputElement
const rotationSpeedLabel = document.getElementById('rotation-speed-label') as HTMLSpanElement
const sensitivitySlider = document.getElementById('sensitivity-slider') as HTMLInputElement
const sensitivityLabel = document.getElementById('sensitivity-label') as HTMLSpanElement

const adapter = await navigator.gpu?.requestAdapter()

if (!adapter) {
  throw new Error("Este navegador no soporta WebGPU, comprueba si tienes esta funcion activada")
}
const device = await adapter.requestDevice()

const context = canvas.getContext('webgpu') as GPUCanvasContext
if (!context) {
  throw new Error("No se puede inicializar webGPU")
}

const format = navigator.gpu.getPreferredCanvasFormat()
context.configure({
  device: device,
  format: format,
  alphaMode: 'premultiplied'
})

// ---------- Codigo shader WGSL ----------
const shaderModule = device.createShaderModule({
  code: `
    struct Uniforms {
      bass: f32,
      mid: f32,
      treble: f32,
      time: f32,
      rotationOffset: f32,
      rotationSpeed: f32,
      audioSensitivity: f32,
      totalInstances: f32,
      panX: f32,
      panY: f32,
      zoom: f32,
      aspect: f32,
    };

    @binding(0) @group(0) var<uniform> uniforms: Uniforms;

    struct VertexOutput {
      @builtin(position) position: vec4f,
      @location(0) color: vec4f,
      @location(1) localPos: vec2f,
    };

    @vertex
    fn vs_main(
      @builtin(vertex_index) vertexIndex: u32,
      @builtin(instance_index) instanceIndex: u32
    ) -> VertexOutput {
      let f_index = f32(instanceIndex);
      let total = max(uniforms.totalInstances, 3.0);

      // Tres capas entrelazadas (graves / medios / agudos) formando anillos concéntricos
      let layer = instanceIndex % 3u;
      let layerCount = max(total / 3.0, 1.0);
      let indexInLayer = floor(f_index / 3.0);

      let angle = (indexInLayer / layerCount) * 6.2831853
        + uniforms.time * uniforms.rotationSpeed * (0.15 + f32(layer) * 0.08)
        + uniforms.rotationOffset
        + f32(layer) * 2.0943951; // separa cada capa 120 grados

      var band: f32;
      var baseRadius: f32;
      if (layer == 0u) {
        band = uniforms.bass;
        baseRadius = 0.20;
      } else if (layer == 1u) {
        band = uniforms.mid;
        baseRadius = 0.33;
      } else {
        band = uniforms.treble;
        baseRadius = 0.46;
      }

      let wobble = sin(uniforms.time * 1.5 + indexInLayer * 0.35 + f32(layer) * 1.7) * 0.03;
      let radius = (baseRadius + wobble) + band * uniforms.audioSensitivity * 0.35;

      let cx = cos(angle) * radius;
      let cy = sin(angle) * radius;

      // Quad de 2 triángulos por partícula (en vez de un único triángulo) para un glow redondeado
      let quad = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
      );
      var localPos = quad[vertexIndex];

      let particleSize = (0.006 + band * uniforms.audioSensitivity * 0.012) * uniforms.zoom;

      // corrige el aspecto para que cada partícula sea circular y no ovalada
      var correctedLocal = localPos;
      correctedLocal.x = correctedLocal.x / max(uniforms.aspect, 0.0001);

      var worldPos = vec2f(cx, cy) * uniforms.zoom + correctedLocal * particleSize
        + vec2f(uniforms.panX, uniforms.panY);

      var output: VertexOutput;
      output.position = vec4f(worldPos, 0.0, 1.0);
      output.localPos = localPos;

      var baseColor: vec3f;
      if (layer == 0u) {
        baseColor = vec3f(0.95, 0.25, 0.45); // graves: rosa/rojo
      } else if (layer == 1u) {
        baseColor = vec3f(0.25, 0.65, 0.95); // medios: azul
      } else {
        baseColor = vec3f(0.55, 0.95, 0.6); // agudos: verde
      }
      let hueShift = sin(angle * 2.0 + uniforms.time * 0.4) * 0.15;
      let color = baseColor + vec3f(hueShift, -hueShift * 0.5, hueShift * 0.3);
      let intensity = 0.5 + band * uniforms.audioSensitivity;

      output.color = vec4f(color * intensity, 1.0);
      return output;
    }

    @fragment
    fn fs_main(input: VertexOutput) -> @location(0) vec4f {
      // Caída radial suave desde el centro de cada partícula -> efecto de brillo/bloom
      let dist = length(input.localPos);
      let glow = pow(clamp(1.0 - dist, 0.0, 1.0), 2.2);
      if (glow <= 0.001) {
        discard;
      }
      return vec4f(input.color.rgb * glow, glow);
    }
  `
})

// ---------- Pipeline de renderizado (con mezcla aditiva para el glow) ----------
const pipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex: {
    module: shaderModule,
    entryPoint: 'vs_main',
  },
  fragment: {
    module: shaderModule,
    entryPoint: 'fs_main',
    targets: [{
      format: format,
      blend: {
        color: {
          srcFactor: 'src-alpha',
          dstFactor: 'one',
          operation: 'add',
        },
        alpha: {
          srcFactor: 'one',
          dstFactor: 'one',
          operation: 'add',
        },
      },
    }],
  },
  primitive: {
    topology: 'triangle-list',
  },
})

// ---------- Motor de audio ----------
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let freqData: Uint8Array<ArrayBuffer> | null = null
let sourceNode: MediaElementAudioSourceNode | null = null

function setupAudioGraph() {
  if (audioCtx) return // solo se crea una vez (el <audio> element solo puede tener una fuente)

  audioCtx = new AudioContext()
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.82 // suaviza los saltos bruscos

  freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))

  sourceNode = audioCtx.createMediaElementSource(audioElement)
  sourceNode.connect(analyser)
  analyser.connect(audioCtx.destination)
}

function averageRange(data: Uint8Array, start: number, end: number): number {
  let sum = 0
  const clampedEnd = Math.min(end, data.length)
  const count = Math.max(clampedEnd - start, 1)
  for (let i = start; i < clampedEnd; i++) sum += data[i]
  return sum / count
}

// ---------- Carga de archivo ----------
fileInput.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement
  if (!target.files || target.files.length === 0) return

  const file = target.files[0]
  const fileURL = URL.createObjectURL(file)

  audioElement.src = fileURL
  audioElement.style.display = 'block'
  audioElement.load()

  setupAudioGraph()
  if (audioCtx?.state === 'suspended') audioCtx.resume()

  audioElement.play().catch((error) => {
    console.error("Error al reproducir el audio:", error)
  })

  trackInfo.textContent = `Reproduciendo: ${file.name}`
})

// ---------- Canvas / redimension ----------
let W = 0, H = 0
const DPR = Math.min(window.devicePixelRatio || 1, 2)

function resizeCanvas() {
  W = window.innerWidth
  H = window.innerHeight
  canvas.width = W * DPR
  canvas.height = H * DPR
  canvas.style.width = `${W}px`
  canvas.style.height = `${H}px`
}
window.addEventListener('resize', resizeCanvas)
resizeCanvas()

// ---------- Estado interactivo (ratón + teclado) ----------
let particleCount = parseInt(particleCountSlider.value, 10)
let rotationSpeed = parseFloat(rotationSpeedSlider.value)
let audioSensitivity = parseFloat(sensitivitySlider.value)

let rotationOffset = 0
let panX = 0
let panY = 0
let zoom = 1.0

let isDragging = false
let lastPointerX = 0
let lastPointerY = 0

particleCountSlider.addEventListener('input', () => {
  // se mantiene múltiplo de 3 para repartir las tres capas de forma pareja
  particleCount = Math.max(3, Math.round(parseInt(particleCountSlider.value, 10) / 3) * 3)
  particleCountLabel.textContent = String(particleCount)
})

rotationSpeedSlider.addEventListener('input', () => {
  rotationSpeed = parseFloat(rotationSpeedSlider.value)
  rotationSpeedLabel.textContent = rotationSpeed.toFixed(2)
})

sensitivitySlider.addEventListener('input', () => {
  audioSensitivity = parseFloat(sensitivitySlider.value)
  sensitivityLabel.textContent = audioSensitivity.toFixed(2)
})

canvas.addEventListener('pointerdown', (e) => {
  isDragging = true
  lastPointerX = e.clientX
  lastPointerY = e.clientY
  canvas.setPointerCapture(e.pointerId)
})

canvas.addEventListener('pointermove', (e) => {
  if (!isDragging) return
  const dx = e.clientX - lastPointerX
  const dy = e.clientY - lastPointerY
  rotationOffset += dx * 0.005      // arrastre horizontal -> rota el anillo
  panY -= dy * 0.0025               // arrastre vertical -> desplaza la cámara
  lastPointerX = e.clientX
  lastPointerY = e.clientY
})

canvas.addEventListener('pointerup', (e) => {
  isDragging = false
  canvas.releasePointerCapture(e.pointerId)
})
canvas.addEventListener('pointerleave', () => { isDragging = false })

canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  zoom = Math.min(2.5, Math.max(0.4, zoom - e.deltaY * 0.001))
}, { passive: false })

window.addEventListener('keydown', (e) => {
  const panStep = 0.04
  if (e.key === 'ArrowLeft') panX -= panStep
  if (e.key === 'ArrowRight') panX += panStep
  if (e.key === 'ArrowUp') panY += panStep
  if (e.key === 'ArrowDown') panY -= panStep
})

// ---------- Buffer de uniforms ----------
// bass, mid, treble, time, rotationOffset, rotationSpeed, audioSensitivity,
// totalInstances, panX, panY, zoom, aspect  ->  12 floats = 48 bytes
const uniformBuffer = device.createBuffer({
  size: 48,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})

const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: { buffer: uniformBuffer },
    },
  ],
})

let time = 0

function drawWebGPU() {
  requestAnimationFrame(drawWebGPU)
  time += 0.016 // Incremento de tiempo por frame (~60fps)

  let bass = 0, mid = 0, treble = 0
  if (analyser && freqData) {
    analyser.getByteFrequencyData(freqData)
    bass = averageRange(freqData, 0, 12) / 255
    mid = averageRange(freqData, 12, 64) / 255
    treble = averageRange(freqData, 64, 180) / 255
  }

  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
    bass, mid, treble, time,
    rotationOffset, rotationSpeed, audioSensitivity,
    particleCount, panX, panY, zoom, W / H
  ]))

  const textureView = context.getCurrentTexture().createView()
  const colorAttachment: GPURenderPassColorAttachment = {
    view: textureView,
    clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1.0 },
    loadOp: 'clear',
    storeOp: 'store',
  }

  const commandEncoder = device.createCommandEncoder()
  const passEncoder = commandEncoder.beginRenderPass({
    colorAttachments: [colorAttachment],
  })

  passEncoder.setPipeline(pipeline)
  passEncoder.setBindGroup(0, bindGroup)

  // 6 vértices (quad) por partícula, particleCount instancias controladas por el slider
  passEncoder.draw(6, particleCount, 0, 0)
  passEncoder.end()

  device.queue.submit([commandEncoder.finish()])
}

drawWebGPU()