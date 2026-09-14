/// <reference types="@webgpu/types" />
import './style.css'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="canvas-container">
    <canvas id="webgpu-canvas"></canvas>
  </div>

  <div class="ui-overlay">
    <h1>ARTE GENERATIVO AUDIO-REACTIVO</h1>
    <input type="file" id="audio-file-input" accept="audio/*" />
    <audio id="audio-element" controls style="display: none;"></audio>
    <div id="track-info" style="font-size: 12px; color: #64748b;">Sube una pista de audio para empezar</div>
  </div>
`

const fileInput = document.getElementById('audio-file-input') as HTMLInputElement;
const audioElement = document.getElementById('audio-element') as HTMLAudioElement;
const trackInfo = document.getElementById('track-info') as HTMLDivElement;
const canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
const adapter = await navigator.gpu?.requestAdapter();

if (!adapter){
  throw new Error("Este navegador no soporta WebGPU, comprueba si tienes esta funcion activada");
}
const device = await adapter.requestDevice();

const context = canvas.getContext('webgpu') as GPUCanvasContext;
if (!context) {
  throw new Error("No se puede inicializar webGPU");
}

const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device: device,
  format: format,
  alphaMode: 'premultiplied'
})

// ---------- Codigo shader WSGL ----------
const shaderModule = device.createShaderModule({
  code: `
    struct Uniforms {
      bass: f32,
      time: f32,
    };

    @binding(0) @group(0) var<uniform> uniforms: Uniforms;

    struct VertexOutput {
      @builtin(position) position: vec4f,
      @location(0) color: vec4f,
    };

    @vertex
    fn vs_main(
      @builtin(vertex_index) vertexIndex: u32,
      @builtin(instance_index) instanceIndex: u32
    ) -> VertexOutput {
      // Convertir el índice de instancia en un ángulo único para formar un anillo o espiral
      let f_index = f32(instanceIndex);
      let total_instances = 100.0;
      let angle = (f_index / total_instances) * 6.2831853; // 2 * PI

      // Radio afectado por el tiempo y los graves de la música
      let base_radius = 0.3 + sin(uniforms.time * 1.5 + f_index * 0.1) * 0.1;
      let radius = base_radius + uniforms.bass * 0.4;

      let x = cos(angle + uniforms.time * 0.2) * radius;
      let y = sin(angle + uniforms.time * 0.2) * radius;

      // Forma base de cada partícula (un pequeño triángulo o punto desplazado)
      var pos = array<vec2f, 3>(
          vec2f(0.0, 0.02),
          vec2f(-0.015, -0.015),
          vec2f(0.015, -0.015)
      );

      let p = pos[vertexIndex] + vec2f(x, y);

      var output: VertexOutput;
      output.position = vec4f(p, 0.0, 1.0);
      
      // Color dinámico basado en la posición y la música
      output.color = vec4f(0.23 + f_index/total_instances * 0.5, 0.5, 1.0 - uniforms.bass, 0.9);
      return output;
    }

    @fragment
    fn fs_main(input: VertexOutput) -> @location(0) vec4f {
        return input.color;
    }
  `
});

// ---------- Pipeline de renderizado ----------
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
    }],
  },
  primitive: {
    topology: 'triangle-list',
  },
});

// ---------- Motor de audio ----------
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let freqData: Uint8Array<ArrayBuffer> | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;

function setupAudioGraph() {
  if (audioCtx) return; // solo se crea una vez (el <audio> element solo puede tener una fuente)

  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.82; // suaviza los saltos bruscos

  freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

  sourceNode = audioCtx.createMediaElementSource(audioElement);
  sourceNode.connect(analyser);
  analyser.connect(audioCtx.destination);
}

// ---------- Carga de archivo ----------
fileInput.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;

  const file = target.files[0];
  const fileURL = URL.createObjectURL(file);

  audioElement.src = fileURL;
  audioElement.style.display = 'block';
  audioElement.load();

  setupAudioGraph();
  if (audioCtx?.state === 'suspended') audioCtx.resume();

  audioElement.play().catch((error) => {
    console.error("Error al reproducir el audio:", error);
  });

  trackInfo.textContent = `Reproduciendo: ${file.name}`;
});

// ---------- Canvas / redimension ----------
let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

function resizeCanvas() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const uniformBuffer = device.createBuffer({
  size: 8,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: { buffer: uniformBuffer },
    },
  ],
});

let time = 0;

function drawWebGPU() {
  requestAnimationFrame(drawWebGPU);
  time += 0.016; // Incremento de tiempo por frame (~60fps)

  let bass = 0;
  if (analyser && freqData) {
    analyser.getByteFrequencyData(freqData);
    const bassBins = freqData.slice(0, 12);
    bass = bassBins.reduce((a, b) => a + b, 0) / bassBins.length / 255;
  }

  // Enviar [bass, time] empaquetados en Float32Array al buffer de la GPU
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([bass, time]));

  const textureView = context.getCurrentTexture().createView();
  const colorAttachment: GPURenderPassColorAttachment = {
    view: textureView,
    clearValue: { r: 0.07, g: 0.08, b: 0.1, a: 1.0 },
    loadOp: 'clear',
    storeOp: 'store',
  };

  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginRenderPass({
    colorAttachments: [colorAttachment],
  });

  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  
  // Dibuja 3 vértices por partícula, con un total de 100 instancias simultáneas
  passEncoder.draw(3, 100, 0, 0); 
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
}

drawWebGPU();

