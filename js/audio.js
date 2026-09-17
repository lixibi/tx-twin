/* ============================================================
   节目音频模拟器
   直接播放随仓库分发的本地音频：从 B 站新闻/资讯视频里截取的 30s 真实语音，
   6 个节目一一对应 6 段语音（不再随机、不再依赖外网 CDN）。
   本地音频缺失或解码失败时，自动降级为 WebAudio 合成的"广播风格"音源，
   保证任何环境（离线演示、内网投屏）都有声音可用。
   ============================================================ */
import { SERVICES } from './config.js';

/* ------------------------------------------------------------
   本地 30s 语音音源（web/assets/audio/*.mp3）
   · 全部为真人语音，取自 B 站公开视频，每段正好 30s、单声道、128kbps
   · 与 6 个节目【一一对应】，按 sid 固定映射
   · 源视频与截取时间点见 assets/audio/SOURCES.md
   ------------------------------------------------------------ */
export const AUDIO_BASE = new URL('../assets/audio/', import.meta.url);

export const CLIP_MAP = {
  101: [{ file: 'cnr_3001.mp3',  title: '全球气候变暖 海洋性冰川冰崩已常态化', at: 30  }],
  102: [{ file: 'cnr_3002.mp3',  title: '全球气候变暖 海洋性冰川冰崩已常态化', at: 100 }],
  103: [{ file: 'cnr_3003.mp3',  title: '全球气候变暖 海洋性冰川冰崩已常态化', at: 155 }],
  104: [{ file: 'glrt_3004.mp3', title: '秋季尝“鲜”，警惕长得“花里胡哨”的海鲜！', at: 55  }],
  105: [{ file: 'glrt_3005.mp3', title: 'だから僕は音楽を辞めた（器乐段）',     at: 60  }],
  106: [{ file: 'test_3006.mp3', title: 'だから僕は音楽を辞めた（器乐段）',     at: 200 }],
};

/* 按 sid 生成可播放 URL 列表（本地文件，直接可用 file:// 打开） */
export function buildOnlineSources(services){
  const map = {};
  (services || SERVICES).forEach(sv=>{
    const clips = CLIP_MAP[sv.sid] || [];
    map[sv.sid] = clips.map(c => new URL(c.file, AUDIO_BASE).href);
  });
  return map;
}

/* 本次会话的本地音源表 */
const ONLINE_SOURCES = buildOnlineSources(SERVICES);

/* 取某节目对应的语音说明（用于界面提示） */
export function clipInfo(sid){
  const c = (CLIP_MAP[sid] || [])[0];
  return c ? { file: c.file, title: c.title, at: c.at, label: `${c.title}｜${c.at}s 起 30 秒` } : null;
}

const SCALES = {
  101: [262, 294, 330, 349, 392, 349, 330, 294],
  102: [330, 392, 440, 494, 523, 494, 440, 392],
  103: [392, 349, 330, 294, 262, 294, 330, 349],
  104: [440, 466, 523, 466, 440, 415, 392, 415],
  105: [494, 523, 587, 523, 494, 466, 440, 466],
  106: [523, 523, 523, 523, 659, 659, 523, 523],
};

export class AudioSim {
  constructor(){
    this.ctx = null;
    this.current = null;
    this.vol = 70;
    this.mode = 'synth';     /* synth | online */
    this.el = null;          /* <audio> 元素 */
    this.timer = null;
    this.step = 0;
    this.onState = null;     /* 状态回调 (mode, label) */
  }

  ensure(){
    if(!this.ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.vol/100 * 0.34;
      this.master.connect(this.ctx.destination);
    }
    if(this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /* ---- 播放某一节目 ----
     prefer: 'online' 优先本地 30s 语音，'synth' 直接用合成音          */
  play(sid, name, prefer='online'){
    const sv = SERVICES.find(s => s.sid === sid) || { sid, name };
    if(prefer === 'online' && ONLINE_SOURCES[sid]?.length){
      this.playOnline(sid, name, sv);
    } else {
      this.playSynth(sid, name);
    }
    return true;
  }

  /* ---- 本地 30s 真实语音 ---- */
  playOnline(sid, name, sv){
    const urls = ONLINE_SOURCES[sid] || [];
    const el = this.el || (this.el = new Audio());
    el.loop = true;
    el.volume = this.vol/100 * 0.85;
    let idx = 0;
    const info = clipInfo(sid);
    const tryNext = ()=>{
      if(idx >= urls.length){ /* 全部失败 → 降级合成音 */
        this.mode = 'synth';
        this.emit('synth', `${name}（离线合成音，本地语音缺失）`);
        this.playSynth(sid, name);
        return;
      }
      const url = urls[idx++];
      el.src = url;
      const p = el.play();
      if(p && p.catch) p.catch(()=>tryNext());
    };
    el.onerror = ()=>tryNext();
    el.onplaying = ()=>{
      this.mode = 'online';
      this.emit('online', `${name}｜30s 语音：${info ? info.title : '本地语音'}`);
    };
    this.stop(true);
    this.el = el;
    tryNext();
  }

  /* ---- WebAudio 合成音（离线兜底） ---- */
  playSynth(sid, name){
    const ctx = this.ensure(); if(!ctx) return;
    this.stop(true);
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = 'triangle'; osc2.type = 'sine';
    filter.type = 'lowpass'; filter.frequency.value = 3200;
    g.gain.value = 0.0001;
    /* 轻微颤音，听感更像广播中继信号 */
    const lfo = ctx.createOscillator(); const lfoG = ctx.createGain();
    lfo.frequency.value = 4.6; lfoG.gain.value = 3.2;
    lfo.connect(lfoG); lfoG.connect(osc.frequency); lfo.start();
    osc.connect(filter); osc2.connect(filter); filter.connect(g); g.connect(this.master);
    g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.25);
    osc.start(); osc2.start();
    this.current = { sid, name, osc, osc2, g };
    this.mode = 'synth';
    this.emit('synth', `${name}（离线合成音）`);
    this.step = 0;
    const scale = SCALES[sid] || SCALES[101];
    const tick = ()=>{
      if(!this.current) return;
      const f = scale[this.step % scale.length];
      const t = ctx.currentTime;
      this.current.osc.frequency.setTargetAtTime(f, t, 0.04);
      this.current.osc2.frequency.setTargetAtTime(f/2, t, 0.04);
      this.step++;
      this.timer = setTimeout(tick, 620);
    };
    tick();
  }

  emit(mode, label){ if(typeof this.onState === 'function') this.onState(mode, label); }

  stop(silent){
    if(this.timer){ clearTimeout(this.timer); this.timer = null; }
    if(this.el){ try{ this.el.pause(); }catch(e){} if(!silent) this.el.currentTime = 0; }
    if(this.current && this.ctx){
      const {osc, osc2, g} = this.current;
      const t = this.ctx.currentTime;
      try{
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0.0001, t, 0.06);
        osc.stop(t+0.35); osc2.stop(t+0.35);
      }catch(e){}
      this.current = null;
    }
    this.mode = 'idle';
  }

  setVolume(v){
    this.vol = Math.max(0, Math.min(100, v));
    if(this.master && this.ctx) this.master.gain.setTargetAtTime(this.vol/100*0.34, this.ctx.currentTime, 0.05);
    if(this.el) this.el.volume = this.vol/100 * 0.85;
  }

  get playing(){ return !!this.current || (this.el && !this.el.paused); }
}
