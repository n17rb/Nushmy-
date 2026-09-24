/* ==========================================================
   CallKit — مكالمة صوتية داخل التطبيق بين الزبون والكابتن (متل الماسنجر)
   • بتمشي على الإنترنت، بدون رصيد، وبدون ما يبين رقم حدا للثاني
   • الصوت بيروح بين التلفونين مباشرة (WebRTC)، والسيرفر بس بيمرّر رسائل الربط
   • الطرف الثاني بيوصله إشعار «عم يتصل فيك» حتى لو التطبيق مسكّر
   ========================================================== */
window.CallKit = (function () {
  const { el, esc, toast } = UI;
  const APP = () => (location.pathname.startsWith('/captain') ? 'captain' : 'customer');

  let S = null;          // المكالمة الشغالة
  let watchTimer = null; // مراقبة المكالمات الواردة
  let audioEl = null;
  let iceCache = null;

  const supported = () => Boolean(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  async function iceConfig() {
    if (iceCache) return iceCache;
    iceCache = await API.call.ice();
    return iceCache;
  }

  /* ------------------------------ الرنّة ------------------------------ */
  const Ring = (() => {
    let ctx = null, timer = null;
    function beep() {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        const t = ctx.currentTime;
        [0, 0.28].forEach((d) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = 880;
          g.gain.setValueAtTime(0.0001, t + d);
          g.gain.exponentialRampToValueAtTime(0.22, t + d + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.22);
          o.connect(g).connect(ctx.destination); o.start(t + d); o.stop(t + d + 0.25);
        });
      } catch {}
    }
    return {
      on(vibrate) {
        this.off();
        beep();
        timer = setInterval(() => { beep(); if (vibrate && navigator.vibrate) navigator.vibrate([400, 200]); }, 2200);
        if (vibrate && navigator.vibrate) navigator.vibrate([400, 200]);
      },
      off() { clearInterval(timer); timer = null; if (navigator.vibrate) navigator.vibrate(0); },
    };
  })();

  /* ------------------------------ الواجهة ------------------------------ */
  function ui(call, mode) {
    const p = call.peer || {};
    const node = el(`
      <div class="callx" role="dialog" aria-label="مكالمة">
        <div class="callx__body">
          <div class="callx__who">
            ${UI.avatar({ name: p.name, photoUrl: p.photoUrl }, 'avatar--xl')}
            <div class="callx__name">${esc(p.name || 'مكالمة')}</div>
            <div class="callx__sub">${esc(p.isCaptain ? 'كابتن نشمي' : 'زبون نشمي')}${call.tripCode ? ' · <span class="num">' + esc(call.tripCode) + '</span>' : ''}</div>
            <div class="callx__state" data-state>${mode === 'in' ? 'مكالمة واردة…' : 'جاري الاتصال…'}</div>
          </div>
          <div class="callx__hint" data-hint>المكالمة عبر الإنترنت — ما بتكلّف رصيد</div>
          <div class="callx__actions" data-actions></div>
        </div>
      </div>`);
    node.querySelector('.callx__sub').innerHTML = (p.isCaptain ? 'كابتن نشمي' : 'زبون نشمي') + (call.tripCode ? ' · <span class="num">' + esc(call.tripCode) + '</span>' : '');
    document.body.appendChild(node);
    return node;
  }

  const btn = (cls, icon, label, attr) => `<button class="callx__btn ${cls}" ${attr}>${Icon(icon, 26)}<span>${label}</span></button>`;

  function renderActions(mode) {
    if (!S) return;
    const box = S.node.querySelector('[data-actions]');
    if (mode === 'in') {
      box.innerHTML = btn('callx__btn--no', 'phone', 'رفض', 'data-decline') + btn('callx__btn--yes', 'phone', 'رد', 'data-accept');
      box.querySelector('[data-accept]').onclick = () => accept();
      box.querySelector('[data-decline]').onclick = () => hangup('declined');
    } else {
      box.innerHTML = btn('callx__btn--mute', 'mic', 'كتم', 'data-mute') + btn('callx__btn--no', 'phone', 'إنهاء', 'data-end');
      box.querySelector('[data-end]').onclick = () => hangup('hangup');
      box.querySelector('[data-mute]').onclick = (e) => {
        if (!S || !S.stream) return;
        S.muted = !S.muted;
        S.stream.getAudioTracks().forEach((t) => { t.enabled = !S.muted; });
        e.currentTarget.classList.toggle('on', S.muted);
        e.currentTarget.querySelector('span').textContent = S.muted ? 'مكتوم' : 'كتم';
      };
    }
  }

  const setState = (text) => { if (S && S.node) S.node.querySelector('[data-state]').textContent = text; };

  function startTimer() {
    if (!S || S.timer) return;
    const t0 = Date.now();
    S.timer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setState(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
    }, 1000);
    setState('00:00');
  }

  /* ------------------------------ الاتصال ------------------------------ */
  async function media() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
      });
    } catch (e) {
      throw new Error(e && e.name === 'NotAllowedError'
        ? 'لازم تسمح للتطبيق يستخدم المايك عشان تحكي'
        : 'ما قدرنا نفتح المايك على هاد الجهاز');
    }
  }

  async function connect(isCaller) {
    const cfg = S.ice || (await iceConfig());
    const pc = new RTCPeerConnection({ iceServers: cfg.iceServers || [] });
    S.pc = pc;
    S.pending = [];
    S.stream = await media();
    S.stream.getTracks().forEach((t) => pc.addTrack(t, S.stream));

    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true; audioEl.setAttribute('playsinline', '');
      document.body.appendChild(audioEl);
    }
    pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; audioEl.play().catch(() => {}); };
    pc.onicecandidate = (e) => { if (e.candidate) send('ice', e.candidate.toJSON()); };
    pc.onconnectionstatechange = () => {
      if (!S) return;
      if (pc.connectionState === 'connected') { S.connected = true; startTimer(); S.node.querySelector('[data-hint]').textContent = 'مكالمة عبر الإنترنت'; }
      if (pc.connectionState === 'failed') fail();
    };
    if (isCaller) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      await send('offer', { type: offer.type, sdp: offer.sdp });
    }
  }

  const send = (kind, payload) => API.call.signal(S.id, kind, JSON.stringify(payload)).catch(() => {});

  async function handle(sig) {
    if (!S || !S.pc) return;
    let data; try { data = JSON.parse(sig.payload); } catch { return; }
    if (sig.kind === 'offer') {
      await S.pc.setRemoteDescription(new RTCSessionDescription(data));
      await drain();
      const answer = await S.pc.createAnswer();
      await S.pc.setLocalDescription(answer);
      await send('answer', { type: answer.type, sdp: answer.sdp });
    } else if (sig.kind === 'answer') {
      if (S.pc.signalingState !== 'stable') { await S.pc.setRemoteDescription(new RTCSessionDescription(data)); await drain(); }
    } else if (sig.kind === 'ice') {
      if (S.pc.remoteDescription && S.pc.remoteDescription.type) await S.pc.addIceCandidate(data).catch(() => {});
      else S.pending.push(data);
    }
  }
  async function drain() {
    for (const c of S.pending || []) await S.pc.addIceCandidate(c).catch(() => {});
    S.pending = [];
  }

  /** حلقة المتابعة: رسائل الربط + حالة المكالمة */
  function poll() {
    clearInterval(S.poll);
    S.poll = setInterval(async () => {
      if (!S) return;
      try {
        const r = await API.call.get(S.id, S.after);
        if (!S) return;
        for (const sig of r.signals || []) {
          if (S.seen.has(sig.id)) continue;
          S.seen.add(sig.id);
          S.after = sig.at;
          await handle(sig);
        }
        if (r.call.status === 'ACTIVE' && !S.active) {
          S.active = true;
          Ring.off();
          if (S.mode === 'out') { setState('جاري الاتصال…'); renderActions('live'); }
        }
        if (r.call.status === 'ENDED') {
          const why = { declined: 'ما رد', missed: 'ما رد', cancelled: 'أغلق المكالمة', failed: 'انقطع الاتصال' }[r.call.endReason];
          close(why || (S.connected ? 'انتهت المكالمة' : 'انتهت المكالمة'));
        }
      } catch (e) { if (e.status === 404) close('انتهت المكالمة'); }
    }, S.active ? 2000 : 1200);
  }

  /* ------------------------------ العمليات ------------------------------ */
  async function start({ tripId, as }) {
    if (S) return;
    if (!supported()) return toast('هاد المتصفح ما بيدعم المكالمات. جرّب Chrome أو Safari حديث', 'error');
    let r;
    try { r = await API.call.start(tripId, as || APP()); }
    catch (e) { return toast(e.message, 'error'); }
    S = { id: r.call.id, mode: 'out', node: ui(r.call, 'out'), seen: new Set(), ice: r.ice, as: as || APP() };
    renderActions('live');
    setState('عم يرنّ…');
    try { await connect(true); } catch (e) { toast(e.message, 'error'); return hangup('failed'); }
    poll();
  }

  /** مكالمة واردة (من المراقبة أو من إشعار) */
  async function incoming(call, ice) {
    if (S) return;
    if (!supported()) return;
    S = { id: call.id, mode: 'in', node: ui(call, 'in'), seen: new Set(), ice, as: APP() };
    renderActions('in');
    Ring.on(true);
  }

  async function accept() {
    if (!S) return;
    Ring.off();
    setState('جاري الوصل…');
    renderActions('live');
    try {
      const r = await API.call.accept(S.id);
      S.ice = r.ice || S.ice;
      S.active = true;
      await connect(false);
      poll();
    } catch (e) { toast(e.message, 'error'); close('انتهت المكالمة'); }
  }

  function fail() {
    if (!S) return;
    API.call.end(S.id, 'failed').catch(() => {});
    close('تعذّر الاتصال — جرّب مرة ثانية أو اتصال عادي');
  }

  function hangup(reason) {
    if (!S) return;
    API.call.end(S.id, reason || 'hangup').catch(() => {});
    close(reason === 'declined' ? '' : '');
  }

  function close(message) {
    if (!S) return;
    Ring.off();
    clearInterval(S.poll); clearInterval(S.timer);
    try { if (S.stream) S.stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { if (S.pc) S.pc.close(); } catch {}
    if (audioEl) audioEl.srcObject = null;
    const node = S.node;
    S = null;
    if (node) { node.classList.add('callx--out'); setTimeout(() => node.remove(), 220); }
    if (message) toast(message);
  }

  /* ------------------------------ المراقبة ------------------------------ */
  /** بيشغّل مراقبة المكالمات الواردة (بينادى من الشاشة الي فيها رحلة شغالة) */
  function watch() {
    if (watchTimer) return;
    const tick = async () => {
      if (S) return;
      try {
        const r = await API.call.incoming();
        if (r.call && r.call.direction === 'in' && r.call.status === 'RINGING') incoming(r.call, r.ice);
      } catch {}
    };
    tick();
    watchTimer = setInterval(tick, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }
  function unwatch() { clearInterval(watchTimer); watchTimer = null; }

  return { start, watch, unwatch, close, supported, get busy() { return Boolean(S); } };
})();
