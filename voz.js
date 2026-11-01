// Neural voices (pt-BR) in a worker: espeak-ng phonemes → ONNX model in ONNX Runtime → PCM.
// Two kinds of model: Piper (VITS) and Kokoro-82M (StyleTTS2, more natural, heavier).
// Everything is downloaded once and kept in Cache Storage, so it also works offline afterwards.
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
const PH = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/';
const RH = ['https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/', 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'];
const rhasspy = v => RH.map(h => `${h}pt/pt_BR/${v}/medium/pt_BR-${v}-medium.onnx`);
const ovos = v => [`https://huggingface.co/OpenVoiceOS/pipertts_pt-BR_${v}/resolve/main/${v}_pt-BR.onnx`];
const KOKORO = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/';
const VOICES = {
  faber: { kind: 'piper', urls: rhasspy('faber') }, cadu: { kind: 'piper', urls: rhasspy('cadu') }, jeff: { kind: 'piper', urls: rhasspy('jeff') },
  dii: { kind: 'piper', urls: ovos('dii') }, miro: { kind: 'piper', urls: ovos('miro') },
  dora: { kind: 'kokoro', style: 'pf_dora' }, alex: { kind: 'kokoro', style: 'pm_alex' }, santa: { kind: 'kokoro', style: 'pm_santa' }
};
const CACHE = 'cj2027-voz';
let runtime = null, ready = null, current = null, session = null, cfg = null, phUrls = null;
let kokoro = null, kokoroVocab = null, kokoroStyle = null;

async function get(url, onBytes) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url);
  if (hit) { const b = await hit.arrayBuffer(); onBytes && onBytes(b.byteLength); return b; }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(resp.status + ' ' + url);
  const reader = resp.body.getReader(), parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); onBytes && onBytes(value.length);
  }
  const buf = await new Blob(parts).arrayBuffer();
  await cache.put(url, new Response(buf, { headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/octet-stream' } }));
  return buf;
}
async function getAny(urls, onBytes) {
  let err;
  for (const u of urls) { try { return await get(u, onBytes); } catch (e) { err = e; } }
  throw err;
}
const blobUrl = (buf, type) => URL.createObjectURL(new Blob([buf], { type }));
const json = buf => JSON.parse(new TextDecoder().decode(buf));

function loadRuntime(tick) {
  if (runtime) return runtime;
  runtime = (async () => {
    const [ortJs, ortWasm, phJs, phWasm, phData] = await Promise.all([
      get(ORT + 'ort.wasm.min.js', tick), get(ORT + 'ort-wasm-simd.wasm', tick),
      get(PH + 'piper_phonemize.js', tick), get(PH + 'piper_phonemize.wasm', tick), get(PH + 'piper_phonemize.data', tick)
    ]);
    importScripts(blobUrl(ortJs, 'text/javascript'), blobUrl(phJs, 'text/javascript'));
    phUrls = { wasm: blobUrl(phWasm, 'application/wasm'), data: blobUrl(phData, 'application/octet-stream') };
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { 'ort-wasm-simd.wasm': blobUrl(ortWasm, 'application/wasm') };
  })();
  runtime.catch(() => { runtime = null; });
  return runtime;
}

function load(voice) {
  if (ready && current === voice) return ready;
  const v = VOICES[voice];
  if (!v) return Promise.reject(new Error('voz desconhecida: ' + voice));
  const total = (v.kind === 'kokoro' ? (kokoro ? 0.6e6 : 93e6) : 64e6) + (runtime ? 0 : 29.6e6);
  let loaded = 0, last = 0;
  const tick = n => {
    loaded += n;
    if (loaded - last > 5e5 || loaded >= total) { last = loaded; postMessage({ type: 'progress', voice, loaded: Math.min(loaded, total), total }); }
  };
  current = voice;
  ready = (async () => {
    if (v.kind === 'kokoro') {
      const [style] = await Promise.all([get(KOKORO + `voices/${v.style}.bin`, tick), loadRuntime(tick), loadKokoro(tick)]);
      kokoroStyle = new Float32Array(style);
      cfg = { espeak: { voice: 'pt-br' }, audio: { sample_rate: 24000 }, kind: 'kokoro' };
      return;
    }
    if (session) { const s = session; session = null; await s.release().catch(() => {}); }
    const [model, conf] = await Promise.all([getAny(v.urls, tick), getAny(v.urls.map(u => u + '.json')), loadRuntime(tick)]);
    cfg = json(conf);
    session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
  })();
  ready.catch(() => { if (current === voice) ready = null; });
  return ready;
}

function loadKokoro(tick) {
  if (kokoro) return kokoro;
  kokoro = (async () => {
    const [model, tok] = await Promise.all([get(KOKORO + 'onnx/model_quantized.onnx', tick), get(KOKORO + 'tokenizer.json', tick), loadRuntime(tick)]);
    kokoroVocab = json(tok).model.vocab;
    return ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
  })();
  kokoro.catch(() => { kokoro = null; });
  return kokoro;
}

function phonemize(text) {
  return new Promise((resolve, reject) => {
    createPiperPhonemize({
      print: out => { try { resolve(JSON.parse(out).phonemes.flat().join('')); } catch (e) { reject(e); } },
      printErr: m => reject(new Error(m)),
      locateFile: f => f.endsWith('.wasm') ? phUrls.wasm : f.endsWith('.data') ? phUrls.data : f
    }).then(m => m.callMain(['-l', cfg.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']), reject);
  });
}

function piperIds(ipa) {
  const map = cfg.phoneme_id_map, ids = [...map['^'], ...map['_']];
  for (const p of [...ipa]) if (map[p]) ids.push(...map[p], ...map['_']);
  ids.push(...map['$']);
  return ids;
}
function kokoroIds(ipa) {
  const ids = [...ipa.replace(/dʒ/g, 'ʤ').replace(/tʃ/g, 'ʧ')].map(c => kokoroVocab[c]).filter(i => i !== undefined).slice(0, 510);
  return [0, ...ids, 0];
}

function loud(pcm) {
  let m = 0;
  for (const v of pcm) m = Math.max(m, Math.abs(v));
  if (m > 0 && m < 0.8) for (let i = 0; i < pcm.length; i++) pcm[i] *= 0.8 / m;
  return pcm;
}
function smooth(pcm, sr) {
  if (pcm.length < 3) return pcm;
  const rc = 1 / (2 * Math.PI * 7500), dt = 1 / sr, a = dt / (rc + dt);
  let prev = pcm[0];
  for (let i = 1; i < pcm.length; i++) { prev = prev + a * (pcm[i] - prev); pcm[i] = prev; }
  return pcm;
}
const i64 = a => BigInt64Array.from(a.map(BigInt));
async function say(text, rate) {
  const ipa = await phonemize(text);
  if (cfg.kind === 'kokoro') {
    const ids = kokoroIds(ipa), at = 256 * Math.min(Math.max(ids.length - 2, 0), 509);
    const { waveform } = await (await kokoro).run({
      input_ids: new ort.Tensor('int64', i64(ids), [1, ids.length]),
      style: new ort.Tensor('float32', kokoroStyle.slice(at, at + 256), [1, 256]),
      speed: new ort.Tensor('float32', Float32Array.from([rate || 1]), [1])
    });
    return waveform.data;
  }
  const ids = piperIds(ipa), inf = cfg.inference;
  const ns = Math.min(inf.noise_scale, 0.4), nw = Math.min(inf.noise_w, 0.5);
  const feeds = {
    input: new ort.Tensor('int64', i64(ids), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', i64([ids.length]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([ns, inf.length_scale / (rate || 1), nw]), [3])
  };
  if (cfg.num_speakers > 1) feeds.sid = new ort.Tensor('int64', i64([0]), [1]);
  const { output } = await session.run(feeds);
  return output.data;
}

onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'load') { await load(m.voice); postMessage({ type: 'ready', id: m.id, voice: m.voice }); }
    if (m.type === 'say') {
      await load(m.voice);
      let pcm = await say(m.text, m.rate);
      const sr = cfg.audio.sample_rate;
      if (cfg.kind !== 'kokoro') pcm = smooth(pcm, sr);
      pcm = loud(pcm);
      postMessage({ type: 'audio', id: m.id, pcm, rate: sr }, [pcm.buffer]);
    }
  } catch (e) {
    postMessage({ type: 'error', id: m.id, msg: String(e && e.message || e) });
  }
};
