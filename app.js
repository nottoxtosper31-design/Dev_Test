'use strict';

const $ = (s, r = document) => r.querySelector(s);
const els = {
  statusPill: $('#statusPill'), statusText: $('#statusText'),
  detectBtn: $('#detectBtn'), diagBtn: $('#diagBtn'), diagPanel: $('#diagPanel'),
  aimDebugBtn: $('#aimDebugBtn'), aimDebug: $('#aimDebug'),
  gameName: $('#gameName'), procName: $('#procName'),
  pidVal: $('#pidVal'), detectMsg: $('#detectMsg'), lockHint: $('#lockHint'),
  elevBanner: $('#elevBanner'),
  cards: $('#cards'),
};

let lastStatus = null;
let cardsBuilt = false;
const cardRefs = {};           // key -> element refs
const interacting = new Set(); // keys the user is currently adjusting
const sendTimers = {};         // key -> debounce timer

const TYPES = ['float', 'double', 'int32', 'uint32', 'uint16', 'uint8', 'int8'];

async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(path, opt);
  return r.json();
}

function fmt(v, step) {
  if (v === null || v === undefined) return '—';
  const dec = (String(step || 0).split('.')[1] || '').length;
  return Number(v).toFixed(Math.min(dec, 4));
}

function featureOrder(obj) { return Object.keys(obj); }

// Build the three control cards once from the first status payload.
function buildCards(features) {
  els.cards.innerHTML = '';
  for (const key of featureOrder(features)) {
    const f = features[key];
    const card = document.createElement('div');
    card.className = 'card locked';
    card.dataset.key = key;
    const opts = TYPES.map((t) => `<option value="${t}">${t}</option>`).join('');
    const modeRow = f.modes
      ? `<div class="feat-mode"><label>${f.modeLabel || 'โหมด'}: <select class="featMode">` +
        Object.keys(f.modes).map((v) => `<option value="${v}">${f.modes[v]}</option>`).join('') +
        `</select></label> <span class="feat-note"></span></div>`
      : '';
    // Secondary slider(s) declared by the server (generic card `extras`).
    // The config `note` becomes a tooltip; the live meaning is filled in by renderStatus.
    const extraRows = (f.extras || []).map((e) =>
      `<div class="extra-row">` +
        `<div class="extra-head"><span class="extra-label"${e.note ? ` title="${e.note}"` : ''}>${e.label}</span>` +
        `<span class="extra-val" data-extra-val="${e.key}"></span></div>` +
        `<input class="range extra-range" data-extra="${e.key}" type="range" min="${e.min}" max="${e.max}" step="${e.step}" value="${e.value}">` +
      `</div>`).join('');
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title">${f.label}</div>
        <label class="switch"><input type="checkbox" class="tog"><span class="slider-track"></span></label>
      </div>
      <div class="card-desc">${f.description || ''}</div>
      ${modeRow}
      <div class="value-row">
        <div class="big-value">${fmt(f.target, f.step)}</div>
        <input class="num-input" type="number" step="${f.step}">
      </div>
      <input class="range" type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.target}">
      ${extraRows}
      <div class="meta">
        <span class="tgt">ตั้ง: —</span>
        <span class="cur">ในเกม: —</span>
        <span class="fx"></span>
        <span class="addr">—</span>
        <span class="err"></span>
      </div>
      <details class="adv">
        <summary>Advanced — แก้ offset / ชนิดค่า</summary>
        <div class="adv-grid">
          <div class="adv-full"><label>Base address</label><input data-f="base"></div>
          <div class="adv-full"><label>Pointer offsets (คั่นด้วย , — ทุกตัวจะ deref 4 บิต)</label><input data-f="pointerOffsets"></div>
          <div><label>Value offset</label><input data-f="valueOffset"></div>
          <div><label>Type</label><select data-f="type">${opts}</select></div>
          <div><label>Min</label><input data-f="min" type="number" step="any"></div>
          <div><label>Max</label><input data-f="max" type="number" step="any"></div>
          <div><label>Step</label><input data-f="step" type="number" step="any"></div>
          <button class="adv-apply">Apply offset</button>
        </div>
      </details>`;
    els.cards.appendChild(card);

    const adv = {};
    card.querySelectorAll('[data-f]').forEach((i) => { adv[i.dataset.f] = i; });
    adv.apply = $('.adv-apply', card); // button has no data-f, capture it explicitly
    cardRefs[key] = {
      card,
      big: $('.big-value', card),
      num: $('.num-input', card),
      range: $('.range', card),
      tog: $('.tog', card),
      cur: $('.cur', card),
      tgt: $('.tgt', card),
      fx: $('.fx', card),
      addr: $('.addr', card),
      err: $('.err', card),
      featMode: $('.featMode', card),
      featNote: $('.feat-note', card),
      extras: [...card.querySelectorAll('[data-extra]')].map((i) => ({
        key: i.dataset.extra, range: i, val: $(`[data-extra-val="${i.dataset.extra}"]`, card),
      })),
      adv,
    };
    wireCard(key, f);
  }
  cardsBuilt = true;
}

// Wire up interactions for one card.
function wireCard(key, f) {
  const r = cardRefs[key];

  // Populate advanced (offset) fields from current feature config.
  r.adv.base.value = f.base;
  r.adv.pointerOffsets.value = (f.pointerOffsets || []).join(', ');
  r.adv.valueOffset.value = f.valueOffset;
  r.adv.type.value = f.type;
  r.adv.min.value = f.min;
  r.adv.max.value = f.max;
  r.adv.step.value = f.step;

  // Features that declare modes (Melee Speed, Speed Run): pick which mechanism to use.
  if (r.featMode) {
    r.featMode.value = f.mode || (f.modes ? Object.keys(f.modes)[0] : '');
    r.featMode.addEventListener('change', () => {
      api('/api/mode-option', 'POST', { key, mode: r.featMode.value })
        .then((d) => { if (!d.ok) r.err.textContent = d.error || 'ตั้งโหมดไม่สำเร็จ'; refreshStatus(); })
        .catch(() => {});
    });
  }

  // Secondary slider(s) declared by the feature (generic card `extras`).
  // These post to the generic /api/extra endpoint and are live like the main slider.
  for (const ex of r.extras) {
    const tkey = key + ':' + ex.key;
    const sendExtra = (val) => {
      if (!lastStatus || !lastStatus.attached) return;
      api('/api/extra', 'POST', { key, field: ex.key, value: Number(val) }).then(() => refreshStatus());
    };
    ex.range.addEventListener('pointerdown', () => interacting.add(key));
    ex.range.addEventListener('input', () => {
      interacting.add(key);
      if (ex.val) ex.val.textContent = fmt(ex.range.value, ex.range.step);
      clearTimeout(sendTimers[tkey]);
      sendTimers[tkey] = setTimeout(() => sendExtra(ex.range.value), 40);
    });
    ex.range.addEventListener('change', () => sendExtra(ex.range.value));
  }

  const setDisplays = (val) => {
    r.big.textContent = fmt(val, r.adv.step.value || f.step);
    r.num.value = val;
    r.range.value = val;
  };

  const sendNow = (val) => {
    if (!lastStatus || !lastStatus.attached) return;
    api('/api/value', 'POST', { key, value: Number(val) }).then(() => refreshStatus());
  };
  const sendDebounced = (val) => {
    clearTimeout(sendTimers[key]);
    sendTimers[key] = setTimeout(() => sendNow(val), 40);
  };

  r.range.addEventListener('pointerdown', () => interacting.add(key));
  r.range.addEventListener('input', () => {
    interacting.add(key);
    setDisplays(r.range.value);
    sendDebounced(r.range.value);
  });
  r.range.addEventListener('change', () => sendNow(r.range.value));

  r.num.addEventListener('focus', () => interacting.add(key));
  r.num.addEventListener('input', () => {
    interacting.add(key);
    const v = r.num.value;
    r.big.textContent = fmt(v, r.adv.step.value || f.step);
    if (v !== '') r.range.value = v;
    sendDebounced(v);
  });
  const finishNum = () => { sendNow(r.num.value); interacting.delete(key); };
  r.num.addEventListener('change', finishNum);
  r.num.addEventListener('blur', finishNum);

  r.tog.addEventListener('change', () => {
    if (!lastStatus || !lastStatus.attached) { r.tog.checked = false; return; }
    api('/api/toggle', 'POST', { key, active: r.tog.checked }).then(() => refreshStatus());
  });

  r.adv.apply.addEventListener('click', (e) => {
    e.preventDefault();
    const body = {
      key,
      base: r.adv.base.value.trim(),
      pointerOffsets: r.adv.pointerOffsets.value.split(',').map((x) => x.trim()).filter((x) => x !== ''),
      valueOffset: r.adv.valueOffset.value.trim(),
      type: r.adv.type.value,
      min: Number(r.adv.min.value),
      max: Number(r.adv.max.value),
      step: Number(r.adv.step.value),
    };
    r.range.min = body.min;
    r.range.max = body.max;
    r.range.step = body.step;
    api('/api/config', 'POST', body).then((d) => {
      if (d.ok) {
        r.err.textContent = '';
        refreshStatus();
      } else {
        r.err.textContent = d.error || 'apply failed';
      }
    });
  });
}

window.addEventListener('pointerup', () => interacting.clear());
window.addEventListener('pointercancel', () => interacting.clear());

function setPill(mode, text) {
  els.statusPill.className = 'pill pill-' + mode;
  els.statusText.textContent = text;
}
function showMsg(text, cls) {
  els.detectMsg.textContent = text || '';
  els.detectMsg.className = 'sb-msg ' + (cls || '');
}

function applyLock(attached) {
  els.lockHint.classList.toggle('hidden', attached);
  for (const key of Object.keys(cardRefs)) {
    const r = cardRefs[key];
    r.card.classList.toggle('locked', !attached);
    r.range.disabled = !attached;
    r.num.disabled = !attached;
    r.tog.disabled = !attached;
    (r.extras || []).forEach((ex) => { ex.range.disabled = !attached; });
  }
}

function renderStatus(s) {
  lastStatus = s;
  if (!cardsBuilt && s.features) buildCards(s.features);

  els.gameName.textContent = s.displayName || '—';
  els.procName.textContent = s.processName || '—';
  els.pidVal.textContent = s.attached ? (s.pid || '—') : '—';

  // Warn (only) when we are certain the server is not elevated — an elevated game then
  // cannot be attached. Hide the banner once attached or when elevation is unknown/OK.
  if (els.elevBanner) {
    const show = (s.elevated === false) && !s.attached;
    els.elevBanner.classList.toggle('hidden', !show);
  }

  if (s.attached) setPill('on', 'เชื่อมต่อแล้ว · PID ' + s.pid);
  else setPill('off', 'ยังไม่เชื่อมต่อ');
  applyLock(s.attached);

  for (const key of Object.keys(cardRefs)) {
    const f = s.features[key];
    if (!f) continue;
    const r = cardRefs[key];
    r.tog.checked = !!f.active;
    r.tgt.textContent = 'ตั้ง: ' + fmt(f.target, f.step);
    r.cur.textContent = 'ในเกม: ' + fmt(f.current, f.step);
    // Effect indicator: when active, does the in-game value match what we set?
    if (f.kind === 'velocity' || f.kind === 'runanim') {
      if (f.active) {
        const label = (f.kind === 'runanim' && f.mode !== 'vel') ? 'วิ่งเร็ว ×' : 'เร่งวิ่ง ×';
        r.fx.textContent = label + fmt(f.target, 1);
        r.fx.className = 'fx ok';
      } else { r.fx.textContent = ''; r.fx.className = 'fx'; }
    } else if (f.kind === 'melee') {
      if (f.active) {
        const label = f.mode === 'anim' ? 'อนิเมชันเร็ว ×' : (f.mode === 'timing' ? 'ต่อคอมโบไว ×' : 'ฟันเร็ว ×');
        r.fx.textContent = label + fmt(f.target, 1);
        r.fx.className = 'fx ok';
      } else { r.fx.textContent = ''; r.fx.className = 'fx'; }
    } else if (f.kind === 'aimbot') {
      if (f.active && f.locked) {
        const lk = f.locked.kind;
        let k = lk === 'soft'
          ? 'ล็อกนุ่ม ตามมุมกล้อง'
          : (lk === 'snap'
            ? 'สแนปมุมกล้อง (ตาม source เป๊ะ)'
            : (lk === 'mouse' ? 'หันกล้องตามเป้า (เมาส์)' : 'ล็อกเต็ม ตามตัวเป้า'));
        if (lk === 'soft' && f.locked.perTickDeg != null) k += ' · ' + fmt(f.locked.perTickDeg, 1) + '°/tick';
        r.fx.textContent = 'ล็อก ' + fmt(f.locked.dist, 1) + ' ม. · ' + k;
        r.fx.className = 'fx ok';
      }
      else if (f.active) { r.fx.textContent = 'ไม่มีเป้าในระยะ'; r.fx.className = 'fx warn'; }
      else { r.fx.textContent = ''; r.fx.className = 'fx'; }
    } else if (f.active && f.current !== null && f.current !== undefined) {
      const diff = Math.abs(Number(f.current) - Number(f.target));
      const tol = Math.max(Math.abs(Number(f.target)) * 0.05, Number(f.step) || 0.1);
      if (diff <= tol) { r.fx.textContent = '✔ มีผลแล้ว'; r.fx.className = 'fx ok'; }
      else { r.fx.textContent = '⚠ ค่าในเกมยังไม่เปลี่ยน'; r.fx.className = 'fx warn'; }
    } else { r.fx.textContent = ''; r.fx.className = 'fx'; }
    r.addr.textContent = f.address ? '@ ' + f.address : '@ —';
    r.err.textContent = f.lastError || '';
    if (r.featMode && !interacting.has(key)) r.featMode.value = f.mode || (f.modes ? Object.keys(f.modes)[0] : '');
    if (r.featNote) {
      const info = f.info;
      if ((f.kind === 'melee' || f.kind === 'runanim') && f.active && info) {
        if (info.error) { r.featNote.textContent = info.error; r.featNote.className = 'feat-note err'; }
        else {
          const anims = (info.meleeAnims != null) ? info.meleeAnims : info.runAnims;
          let t = '';
          if (anims != null) t = 'อนิเมชันที่เร่ง ' + anims + (info.entryCount != null ? '/' + info.entryCount : '') + ' รายการ';
          else if (info.mult != null) t = '×' + fmt(info.mult, 1);
          r.featNote.textContent = t;
          r.featNote.className = 'feat-note';
        }
      } else { r.featNote.textContent = ''; r.featNote.className = 'feat-note'; }
    }
    // Secondary slider(s) — generic: any feature that declares `extras` gets extra sliders.
    if (r.extras && r.extras.length) {
      const meta = f.extras || [];
      for (const ex of r.extras) {
        const m = meta.find((x) => x.key === ex.key);
        const val = (m ? m.value : ex.range.value);
        if (!interacting.has(key)) ex.range.value = val;
        if (ex.val) ex.val.textContent = fmt(val, (m ? m.step : ex.range.step));
      }
    }
    if (!interacting.has(key)) {
      r.range.value = f.target;
      r.num.value = f.target;
      r.big.textContent = fmt(f.target, f.step);
    }
  }
}

function refreshStatus() {
  return api('/api/status').then(renderStatus).catch(() => {});
}

// Detect button (top-right): scan for the game process + attach memory.
els.detectBtn.addEventListener('click', async () => {
  els.detectBtn.disabled = true;
  setPill('busy', 'กำลังสแกน...');
  showMsg('', '');
  try {
    const r = await api('/api/detect', 'POST');
    if (r.ok) { showMsg(`พบเกมและแนบ memory สำเร็จ (PID ${r.pid})`, 'ok'); runDiag(); }
    else showMsg(r.error || 'ไม่สามารถเชื่อมต่อได้', 'err');
  } catch (e) {
    showMsg('เกิดข้อผิดพลาด: ' + e.message, 'err');
  } finally {
    els.detectBtn.disabled = false;
    refreshStatus();
  }
});

// Diagnostic: read real memory values to check address validity / game version.
function renderDiag(d) {
  const p = els.diagPanel;
  p.classList.remove('hidden');
  if (!d.attached) {
    p.innerHTML = '<div class="diag-note">' + (d.message || 'ยังไม่ได้แนบเกม') + '</div>';
    return;
  }
  const rows = Object.entries(d.reads).map(([, r]) => {
    const ok = r.plausible;
    let val;
    if (r.hex) val = r.hex;
    else if (r.value === null || r.value === undefined) val = '—';
    else if (typeof r.value === 'number') val = Number.isInteger(r.value) ? r.value : +r.value.toFixed(4);
    else val = r.value;
    const err = r.error ? ' <span class="diag-err">(' + r.error + ')</span>' : '';
    return '<tr><td><code>' + r.addr + '</code></td><td>' + val + err + '</td><td>' + r.note +
      '</td><td class="' + (ok ? 'diag-ok' : 'diag-bad') + '">' + (ok ? '✓ ปกติ' : '✗ ผิดปกติ') + '</td></tr>';
  }).join('');
  let abHtml = '';
  if (d.aimbot) {
    const a = d.aimbot;
    const abr = (k, v) => '<tr><td>' + k + '</td><td>' + (v === null || v === undefined ? '—' : v) + '</td></tr>';
    const aMode = a.mode === 'mouse'
      ? 'สำรอง · หันกล้องด้วยเมาส์ (mouse_event) ตามเต็ม'
      : (a.mode === 'soft'
        ? 'Mode 2 · ล็อกนุ่ม ตาม source (เขียนมุมกล้อง 0xB6F248/0xB6F258 ไล่แบบนุ่ม ไม่ดูด)'
        : (a.mode === 'snap'
          ? 'Mode 2+ · ตาม source เป๊ะ (เขียนมุมกล้องเต็มทุก tick สแนปทันที)'
          : 'Mode 1 · ล็อกเต็มในเกม (เกมตามตัวเป้าให้เอง)'));
    const isAngleMode = (a.mode === 'soft' || a.mode === 'snap');
    abHtml = '<div class="diag-subhead">Aimbot — ' + aMode + '</div>' +
      '<table class="diag-table"><tbody>' +
      abr('โหมดการล็อกเป้า', aMode) +
      abr('ปุ่ม aim (คลิกขวา) ค้างอยู่ไหม', a.rightButton ? 'ใช่ — กำลัง aim' : 'ไม่ได้กด') +
      abr('กล้อง matrix @ ' + (a.matrixAddr || '0xB6F9E4'), a.matrixOk ? 'อ่านได้' : 'อ่านไม่ได้') +
      (a.cameraPos ? abr('ตำแหน่งกล้อง (x, y, z)', a.cameraPos.x + ', ' + a.cameraPos.y + ', ' + a.cameraPos.z) : '') +
      (a.cameraFwd ? abr('ทิศทางกล้อง (forward)', a.cameraFwd.x + ', ' + a.cameraFwd.y + ', ' + a.cameraFwd.z) : '') +
      (isAngleMode ? abr('มุมกล้องปัจจุบัน X° / Z° @ ' + (a.camAngleAddr ? a.camAngleAddr.x + ' / ' + a.camAngleAddr.z : '0xB6F248 / 0xB6F258'),
        a.camAngles ? (a.camAngles.x + '° / ' + a.camAngles.z + '°') : 'อ่านไม่ได้') : '') +
      (isAngleMode && a.aimAnglesDeg ? abr('มุมที่ aimbot จะเขียน (X°, Z°)', a.aimAnglesDeg.x + '° / ' + a.aimAnglesDeg.z + '°') : '') +
      (isAngleMode && a.aimDeltaDeg ? abr('มุมที่ต้องหันอีก (X°, Z°)', a.aimDeltaDeg.x + '° / ' + a.aimDeltaDeg.z + '°') : '') +
      (isAngleMode ? abr('จุดเล็ง', 'ped origin + ' + (a.boneHeight == null ? 0.8 : a.boneHeight) + ' ม. (≈ BONE_HEAD — เรียก GetBonePosition ในเกมจาก Node ไม่ได้)') : '') +
      (isAngleMode ? abr('วิธีไล่มุมกล้อง', a.mode === 'soft'
        ? ('นุ่ม: ' + Math.round((a.gain == null ? 0.3 : a.gain) * 100) + '% ของมุมที่เหลือต่อ tick · จำกัด ' + (a.maxDeg == null ? 3 : a.maxDeg) + '°/tick')
        : 'สแนป: เขียนมุมเต็มทุก tick (พฤติกรรมเป๊ะของ source)') : '') +
      abr('ped pool @ 0xB74490', a.pool || 'อ่านไม่ได้') +
      abr('จำนวน ped ใน pool', a.poolSize) +
      abr('ped ที่สแกนได้ / stride', (a.poolSizeDisplay == null ? '—' : a.poolSizeDisplay) + ' / ' + (a.pedStride || '—')) +
      abr('ล็อกเฉพาะผู้เล่นจริง (ไม่เอา NPC)', a.playersOnly === false ? 'ปิด' : ('เปิด · ข้าม NPC ' + (a.skippedNpc || 0) + ' ตัว')) +
      abr('ระยะล็อก (ม.)', a.lockDistance) +
      (!isAngleMode ? abr('ความแรงในการดึงกล้อง', (a.gain == null ? '—' : Math.round(a.gain * 100) + '% ของมุมที่เหลือ ต่อ tick') +
        (a.mode === 'lock' ? ' (โหมด 1 ไม่ใช้ — เขียน target ให้เกมล็อกเอง)' : '')) : '') +
      abr('เป้าใกล้สุด (ม. / ชนิด)', a.target ? (a.target.dist + (a.target.typeName ? ' · ' + a.target.typeName : '')) : 'ไม่มีเป้าในระยะ') +
      (a.reason ? abr('เหตุผล', a.reason) : '') +
      (a.yawErrDeg != null ? abr('มุมที่ต้องหัน (yaw°, pitch°)', a.yawErrDeg + '°, ' + a.pitchErrDeg + '°') : '') +
      (a.mouseDelta ? abr('เมาส์ที่จะขยับ (x, y)', a.mouseDelta.x + ', ' + a.mouseDelta.y) : '') +
      (a.error ? abr('error', a.error) : '') +
      '</table></div>';
  }
  let raHtml = '';
  if (d.runanim) {
    const ra = d.runanim;
    if (ra.error) {
      raHtml = '<div class="diag-subhead">Speed Run</div><div class="diag-err">' + ra.error + '</div>';
    } else {
      const a = ra.anim || {};
      let animHtml;
      if (a.error) {
        animHtml = '<div class="diag-err">อ่านอนิเมชันไม่ได้: ' + a.error + '</div>';
      } else {
        const rows2 = (a.entries || []).map((e) =>
          '<tr' + (e.isRun ? ' class="diag-ok"' : '') + '><td><code>' + e.assoc + '</code></td>' +
          '<td>group ' + e.group + ' · animId ' + e.animId + '</td><td>' + e.speed + '</td>' +
          '<td>' + (e.isRun ? 'วิ่ง (WALK/RUN/SPRINT)' : '—') + '</td></tr>').join('');
        animHtml = '<div class="diag-note">clump offset @ 0xB5F878 = <b>' + a.clumpOffset + '</b> · clump ' + a.clump +
          ' · animList ' + a.animData + ' · animId ที่เร่ง: [' + (a.animIds || []).join(', ') + ']</div>' +
          '<table class="diag-table"><thead><tr><th>assoc</th><th>group / animId</th><th>speed</th><th>สถานะ</th></tr></thead><tbody>' + rows2 + '</tbody></table>';
      }
      raHtml = '<div class="diag-subhead">Speed Run — โหมด <b>' + ra.mode + '</b> · ' +
        (ra.active ? ('เปิดอยู่ ×' + ra.mult) : 'ปิด') + ' · ความเร็วแนวนอน ' + (ra.velocity == null ? '—' : ra.velocity) +
        ' · <label>เปลี่ยน: <select class="runanimModeDiag">' +
        '<option value="anim">anim — อนิเมชันวิ่งเร็วขึ้น (แนะนำ)</option><option value="vel">vel — เร่งความเร็วเคลื่อนที่</option><option value="both">both — รวมสองอย่าง</option></select></label></div>' +
        '<div class="diag-note">animId 0 = WALK, 1 = RUN, 2 = SPRINT · แถวสีเขียวคืออนิเมชันที่ DevNight กำลังเร่ง (m_Speed)</div>' +
        animHtml;
    }
  }
  const level = d.verdict ? d.verdict.level : '';
  let wtHtml = '';
  if (d.writeTests) {
    const n = (x) => (typeof x === 'number' ? +x.toFixed(2) : x);
    const wtRows = Object.entries(d.writeTests).map(([, t]) => {
      if (t.note) return '<tr><td>' + t.label + '</td><td colspan="2" class="diag-note">' + t.note + '</td></tr>';
      if (t.error) return '<tr><td>' + t.label + '</td><td colspan="2" class="diag-err">' + t.error + '</td></tr>';
      return '<tr><td>' + t.label + '</td><td>' + n(t.orig) + ' → ' + n(t.testVal) + ' (อ่านกลับ ' + n(t.readback) + ')</td>' +
        '<td class="' + (t.stuck ? 'diag-ok' : 'diag-bad') + '">' + (t.stuck ? '✔ เขียนติด' : '✘ โดนเกมเขียนทับ') + '</td></tr>';
    }).join('');
    wtHtml = '<div class="diag-subhead">ผลทดสอบเขียนค่า (write-test)</div>' +
      '<table class="diag-table"><thead><tr><th>ค่า</th><th>ทดสอบ (เดิม → ทดสอบ → อ่านกลับ)</th><th>ผล</th></tr></thead><tbody>' + wtRows + '</tbody></table>';
  }
  let miHtml = '';
  if (d.melee) {
    const m = d.melee;
    if (m.error) {
      miHtml = '<div class="diag-subhead">Melee Speed</div><div class="diag-err">' + m.error + '</div>';
    } else {
      const comboRows = (m.combos || []).map((c) => {
        if (c.error) return '<tr><td>' + c.combo + '</td><td colspan="3" class="diag-err">' + c.error + '</td></tr>';
        return '<tr><td>' + c.combo + '</td><td>' + c.animGroup + '</td><td>' +
          (c.hit || []).join(', ') + '</td><td>' + (c.chain || []).join(', ') + '</td></tr>';
      }).join('');
      const a = m.anim || {};
      let animHtml;
      if (a.error) {
        animHtml = '<div class="diag-err">อ่านอนิเมชันไม่ได้: ' + a.error + '</div>';
      } else {
        const rows2 = (a.entries || []).map((e) =>
          '<tr' + (e.isMelee ? ' class="diag-ok"' : '') + '><td><code>' + e.assoc + '</code></td>' +
          '<td>group ' + e.group + ' · animId ' + e.animId + '</td><td>' + e.speed + '</td>' +
          '<td>' + (e.isMelee ? 'ฟัน (melee)' : '—') + '</td></tr>').join('');
        animHtml = '<div class="diag-note">clump offset @ 0xB5F878 = <b>' + a.clumpOffset + '</b> · clump ' + a.clump +
          ' · animList ' + a.animData + ' · melee anim groups: [' + (a.groups || []).join(', ') + ']</div>' +
          '<table class="diag-table"><thead><tr><th>assoc</th><th>group / animId</th><th>speed</th><th>สถานะ</th></tr></thead><tbody>' + rows2 + '</tbody></table>';
      }
      miHtml = '<div class="diag-subhead">Melee Speed — base ' + m.base + ' · โหมด <b>' + m.mode + '</b> · ' +
        (m.active ? ('เปิดอยู่ ×' + m.mult) : 'ปิด') + ' · <label>เปลี่ยน: <select class="meleeModeDiag">' +
        '<option value="anim">anim — อนิเมชันฟันเร็วขึ้น (แนะนำ)</option><option value="timing">timing — ต่อคอมโบไวขึ้น</option><option value="both">both — รวมสองอย่าง</option></select></label></div>' +
        '<div class="diag-note">hit = เวลาที่อาวุธโดนเป้า · chain = เวลาที่กดต่อคอมโบได้ (หน่วยเฟรมอนิเมชัน, ยิ่งน้อยยิ่งเร็ว) · ค่าที่เห็นคือค่าปัจจุบัน (หลังคูณแล้ว)</div>' +
        '<table class="diag-table"><thead><tr><th>combo</th><th>animGroup</th><th>hit[5]</th><th>chain[5]</th></tr></thead><tbody>' + comboRows + '</tbody></table>' +
        '<div class="diag-subhead">อนิเมชันที่กำลังเล่นบนตัวผู้เล่น (m_Speed)</div>' + animHtml;
    }
  }
  p.innerHTML =
    '<div class="diag-head">Diagnostic — ' + d.processName + ' (PID ' + d.pid + ')</div>' +
    (d.exePath ? '<div class="diag-exe">ไฟล์เกม: <code>' + d.exePath + '</code>' + (d.exeSize ? ' · ' + d.exeSize + ' bytes' : '') + '</div>' : '') +
    '<table class="diag-table"><thead><tr><th>address</th><th>ค่าที่อ่านได้</th><th>คำอธิบาย</th><th>ผล</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    miHtml +
    raHtml +
    wtHtml + abHtml +
    '<div class="diag-verdict ' + level + '">' + (d.verdict ? d.verdict.text : '') + '</div>';

  // Wire the in-diagnostic melee mode selector (switching re-applies and re-reads).
  const rsd = p.querySelector('.runanimModeDiag');
  if (rsd && d.runanim && !d.runanim.error) {
    rsd.value = d.runanim.mode;
    rsd.addEventListener('change', async () => {
      try { await api('/api/mode-option', 'POST', { key: 'speed_run', mode: rsd.value }); } catch (e) { /* ignore */ }
      runDiag();
    });
  }
  const msd = p.querySelector('.meleeModeDiag');
  if (msd && d.melee && !d.melee.error) {
    msd.value = d.melee.mode;
    msd.addEventListener('change', async () => {
      try { await api('/api/melee-option', 'POST', { mode: msd.value }); } catch (e) { /* ignore */ }
      runDiag();
    });
  }
}

async function runDiag() {
  els.diagBtn.disabled = true;
  els.diagPanel.classList.remove('hidden');
  els.diagPanel.innerHTML = '<div class="diag-note">กำลังอ่านหน่วยความจำเกม...</div>';
  try {
    renderDiag(await api('/api/diag'));
  } catch (e) {
    els.diagPanel.innerHTML = '<div class="diag-err">เกิดข้อผิดพลาด: ' + e.message + '</div>';
  } finally {
    els.diagBtn.disabled = false;
  }
}
els.diagBtn.addEventListener('click', runDiag);

// ---------------------------------------------------------------------------
// Aimbot live debug panel: shows every pipeline stage in real time so we can see
// exactly where the right-click lock breaks. Also offers a manual mouse-injection
// test to check whether the game reacts to synthetic mouse input at all.
// ---------------------------------------------------------------------------
let aimDebugTimer = null;
let aimLastCalib = null; // last calibration result (kept between 250ms re-renders)
let aimLastPeds = null;  // last ped-pool listing (kept between 250ms re-renders)
function dbgRow(k, v, cls) {
  return '<tr><td>' + k + '</td><td' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</td></tr>';
}
function dbgYn(b) { return b ? '<span class="diag-ok">ใช่</span>' : '<span class="diag-bad">ไม่</span>'; }

async function refreshAimDebug() {
  const p = els.aimDebug;
  if (p.classList.contains('hidden')) return;
  let d;
  try { d = await api('/api/aimbot-debug'); }
  catch (e) { p.innerHTML = '<div class="diag-err">เกิดข้อผิดพลาด: ' + e.message + '</div>'; return; }
  if (!d.ok) { p.innerHTML = '<div class="diag-err">' + (d.error || 'error') + '</div>'; return; }
  const i = d.info;
  const md = i.mouseDelta ? (i.mouseDelta.x + ', ' + i.mouseDelta.y) : '—';
  const cam = i.camera;
  const aim = i.aim;
  // Mode 2 ("soft"/"snap") aims by writing the game's camera angles — summarise it here.
  const camMode = (i.mode === 'soft' || i.mode === 'snap');
  const gainText = i.mode === 'soft'
    ? ('ไล่มุม ' + Math.round((i.gain == null ? 0.3 : i.gain) * 100) + '% ของมุมที่เหลือต่อ tick · จำกัด ' + (i.maxDeg == null ? '—' : i.maxDeg) + '°/tick')
    : (i.mode === 'snap'
      ? 'เขียนมุมกล้องเต็มทุก tick (สแนป) — พฤติกรรมเป๊ะของ source'
      : (i.mode === 'lock'
        ? 'ไม่ใช้ในโหมด 1 (เกมล็อกให้เอง)'
        : ((i.gain == null ? '—' : Math.round(i.gain * 100) + '% ของมุมที่เหลือ') + ' · ตามเต็ม ไม่จำกัดความเร็ว')));
  p.innerHTML =
    '<div class="diag-head">Aimbot Debug — เรียลไทม์ (รีเฟรชอัตโนมัติ)</div>' +
    '<table class="diag-table"><tbody>' +
    dbgRow('แนบเกม (attached)', dbgYn(i.attached)) +
    dbgRow('รันแบบ Administrator', i.elevated === true ? dbgYn(true) : (i.elevated === false ? '<span class="diag-bad">ไม่ (เกม elevated จะแนบไม่ได้)</span>' : '—')) +
    dbgRow('Aimbot เปิดอยู่ (สวิตช์)', dbgYn(i.active)) +
    dbgRow('กดคลิกขวาค้างอยู่', dbgYn(i.rmbDown)) +
    dbgRow('PID เกม / PID หน้าต่างที่โฟกัส', i.gamePid + ' / ' + i.foregroundPid) +
    dbgRow('หน้าต่างเกมเป็น foreground', dbgYn(i.foregroundMatch)) +
    dbgRow('player ped pointer', i.playerPed || '—') +
    dbgRow('โหมดการล็อกเป้า', i.mode === 'mouse'
      ? 'สำรอง — หันกล้องด้วยเมาส์ (mouse_event) ตามเป้าต่อเนื่อง'
      : (i.mode === 'soft'
        ? '<span class="diag-ok">Mode 2</span> — ล็อกนุ่ม ตาม source: DevNight หันกล้องเองด้วยการเขียนมุมกล้อง 0xB6F248/0xB6F258 ไปที่ตัวเป้า แต่ไล่แค่บางส่วนต่อ tick + จำกัดความเร็ว (ไม่ดูด ไม่ตามเท่า Mode 1)'
        : (i.mode === 'snap'
          ? '<span class="diag-ok">Mode 2+</span> — ตาม source เป๊ะ: เขียนมุมกล้องเต็มทุก tick (สแนปที่ตัวเป้าทันที)'
          : '<span class="diag-ok">Mode 1</span> — ล็อกเต็มในเกม (เกมตามตัวเป้าให้เอง)'))) +
    (i.native ? dbgRow('เป้าที่เกมใช้อยู่ (m_pTargetedObject @+0x71C)', i.native.targetedObject || '— (ว่าง)') : '') +
    (i.native ? dbgRow('เป้าเมาส์ 3rd person (@+0x79C)', i.native.mouseTarget || '— (ว่าง)') : '') +
    (i.native && i.native.ours ? dbgRow('เป้าที่ DevNight สั่งล็อก', i.native.ours + ((i.native.targetedObject === i.native.ours) ? ' <span class="diag-ok">✓ ตรงกัน</span>' : ' <span class="diag-bad">✗ ไม่ตรง</span>')) : '') +
    dbgRow('ตำแหน่งผู้เล่น (x, y, z)', i.playerPos ? (i.playerPos.x + ', ' + i.playerPos.y + ', ' + i.playerPos.z) : '—') +
    dbgRow('ped pool / pool size', (i.pool || '—') + ' / ' + (i.poolSize == null ? '—' : i.poolSize)) +
    dbgRow('ped stride', (i.stride != null ? '0x' + i.stride.toString(16).toUpperCase() + ' (ตรวจแล้ว ' + i.strideScore + ' ตัว)' : '—')) +
    dbgRow('ล็อกเฉพาะผู้เล่นจริง (ไม่เอา NPC)', (i.playersOnly ? '<span class="diag-ok">เปิด</span>' : '<span class="diag-bad">ปิด</span>') + ' · ped type ' + (i.playerPedTypes || []).join(', ')) +
    dbgRow('สแกน ped ทั้งหมด / ข้าม NPC', i.scanned + ' / ' + (i.skippedNpc || 0) + ' ตัว') +
    dbgRow((i.mode === 'soft' || i.mode === 'snap') ? 'วิธีไล่มุมกล้อง' : 'ความแรงในการดึงกล้องต่อ tick', gainText) +
    dbgRow('เป้าใกล้สุด (ม. / ชนิด)', i.nearest ? (i.nearest.dist + (i.nearest.typeName ? ' · ' + i.nearest.typeName : '')) : '— ไม่เจอ') +
    dbgRow('camera matrix @ ' + i.matrixAddr, i.matrixOk ? '<span class="diag-ok">อ่านได้</span>' : '<span class="diag-bad">อ่านไม่ได้</span>') +
    (cam ? dbgRow('กล้อง pos (x, y, z)', cam.pos.x + ', ' + cam.pos.y + ', ' + cam.pos.z) : '') +
    (cam ? dbgRow('กล้อง forward (x, y, z)', cam.fwd.x + ', ' + cam.fwd.y + ', ' + cam.fwd.z) : '') +
    (camMode && i.camAngles ? dbgRow('มุมกล้องปัจจุบัน X° / Z° (0xB6F248 / 0xB6F258)', i.camAngles.x + '° / ' + i.camAngles.z + '°') : '') +
    (camMode && i.aimAnglesDeg ? dbgRow('มุมที่ aimbot จะเขียน (X°, Z°)', i.aimAnglesDeg.x + '° / ' + i.aimAnglesDeg.z + '°') : '') +
    (camMode && i.aimDeltaDeg ? dbgRow('มุมที่ต้องหันอีก (X°, Z°)', i.aimDeltaDeg.x + '° / ' + i.aimDeltaDeg.z + '°') : '') +
    (camMode ? dbgRow('จุดเล็ง', 'ped origin + ' + (i.boneHeight == null ? 0.8 : i.boneHeight) + ' ม. (≈ BONE_HEAD)') : '') +
    (aim ? dbgRow('เป้าในพิกัดกล้อง (ขวา, บน, หน้า)', aim.xc + ', ' + aim.yc + ', ' + aim.zc) : '') +
    (aim ? dbgRow('มุมที่ต้องหัน (yaw°, pitch°)', aim.yawErrDeg + '°, ' + aim.pitchErrDeg + '°') : '') +
    dbgRow('เมาส์ที่จะขยับต่อ tick (x, y)', md) +
    dbgRow('สถานะล็อก', i.locked ? ('🔒 ล็อก ' + Number(i.locked.dist).toFixed(2) + ' ม.' + (i.locked.sticky ? ' (เกาะเป้าเดิม)' : '') +
      (i.locked.perTickDeg != null ? ' · ไล่มุม ' + i.locked.perTickDeg + '°/tick' : '') +
      (i.locked.yawErr != null ? ' · yaw ' + i.locked.yawErr + '°' : '')) : 'ยังไม่ล็อก') +
    (i.reason ? dbgRow('เหตุผลล่าสุด', i.reason, 'diag-err') : '') +
    (i.lastError ? dbgRow('lastError', i.lastError, 'diag-err') : '') +
    '</tbody></table>' +
    (i.last ?
      '<div class="diag-head" style="margin-top:12px">รอบล่าสุดที่กดคลิกขวาในเกม</div>' +
      '<table class="diag-table"><tbody>' +
      dbgRow('เวลา', new Date(i.last.ts).toLocaleTimeString('th-TH')) +
      dbgRow('ระยะเป้า (ม.)', i.last.targetDist != null ? Number(i.last.targetDist).toFixed(2) : '—') +
      (i.last.targetType ? dbgRow('ชนิดเป้า (ped type)', i.last.targetType) : '') +
      (i.last.mode ? dbgRow('โหมดที่ใช้รอบนั้น', i.last.mode) : '') +
      (i.last.kind ? dbgRow('กลไกที่ใช้รอบนั้น', i.last.kind === 'soft'
        ? 'soft — Mode 2 ล็อกนุ่ม' + (i.last.gain != null ? ' (ดึง ' + Math.round(i.last.gain * 100) + '% ของมุมที่เหลือ' + (i.last.maxDeg ? ' · จำกัด ' + i.last.maxDeg + '°/tick' : '') + ')' : '')
        : (i.last.kind === 'snap'
          ? 'snap — Mode 2+ ตาม source เป๊ะ (เขียนมุมกล้องเต็มทุก tick)'
        : (i.last.kind === 'mouse'
          ? 'mouse — ดึงกล้องเข้าหาเป้าทุก tick (ตามเต็ม)'
          : 'lock — Mode 1 ล็อกเต็มในเกม (เกมตามตัวเป้าให้เอง)'))) : '') +
      (i.last.nativeTarget ? dbgRow('สั่งล็อกเป้า →', i.last.nativeTarget + ' (เขียนที่ ped+0x71C)') : '') +
      dbgRow('มุมที่ต้องหัน (yaw°, pitch°)', i.last.yawErr != null ? (i.last.yawErr + '°, ' + i.last.pitchErr + '°') : '—') +
      dbgRow('เมาส์ที่ขยับ (x, y)', i.last.mouseDelta ? (i.last.mouseDelta.x + ', ' + i.last.mouseDelta.y) : '—') +
      dbgRow('ผลล็อก', i.last.locked ? '<span class="diag-ok">🔒 ล็อกสำเร็จ</span>' : '<span class="diag-bad">ไม่ล็อก</span>') +
      (i.last.reason ? dbgRow('สาเหตุที่ไม่ล็อก', i.last.reason, 'diag-err') : '') +
      '</tbody></table>'
      : '') +
    '<div style="margin-top:12px; display:flex; align-items:center; gap:14px; flex-wrap:wrap">' +
    '<label style="display:flex; align-items:center; gap:8px; cursor:pointer"><span>โหมด:</span> <select id="aimMode"><option value="lock">Mode 1 — ล็อกเต็ม ตามตัวเป้า (แบบเดิม)</option><option value="soft">Mode 2 — ล็อกนุ่ม ตาม source (เขียนมุมกล้อง ไล่แบบไม่ดูด)</option><option value="snap">Mode 2+ — ตาม source เป๊ะ (สแนปมุมกล้องทันที)</option><option value="mouse">สำรอง — หันกล้องด้วยเมาส์ (ตามเต็ม ไม่จำกัดความเร็ว)</option></select></label>' +
    '<label style="display:flex; align-items:center; gap:8px; cursor:pointer"><input type="checkbox" id="aimPlayersOnly"' + (i.playersOnly ? ' checked' : '') + '> <span>ล็อกเฉพาะ <b>ผู้เล่นจริง</b> (ไม่เอา NPC)</span></label>' +
    '<button class="btn btn-ghost" id="aimListPeds">ดู ped ทั้งหมดในโลก</button>' +
    '</div>' +
    '<div class="diag-note" id="aimPedsOut">' + (aimLastPeds || 'กด “ดู ped ทั้งหมดในโลก” เพื่อดูว่ามี ped ชนิดไหนบ้าง (ผู้เล่น = PLAYER_NETWORK / PLAYER1.. type 0-3)') + '</div>' +
    '<div class="diag-note">วิธีอ่าน: เปิดสวิตช์ Aimbot + เลือกโหมด + กดคลิกขวาค้าง <b>ในเกม</b> แล้วดูว่าแถวไหนไม่ผ่าน — ' +
    'ถ้า “แนบเกม” = ไม่ → server ยังไม่แนบ (ดูแถว Administrator); ถ้า “เป้าใกล้สุด” = — → ไม่เจอผู้เล่นในระยะ (ดู “ข้าม NPC” ว่ากรองออกเยอะไหม); ' +
    '<b>Mode 1 (lock)</b>: ดูว่า “เป้าที่ DevNight สั่งล็อก” ตรงกับ “เป้าที่เกมใช้อยู่ (+0x71C)” ไหม (ควรขึ้น ✓ ตรงกัน ขณะกดคลิกขวา) — โหมดนี้เกมจะ<b>ตามตัวเป้า</b>ให้เอง (ถ้าไม่ตรง/ว่าง แปลว่าเกมเขียนทับ ให้ลอง Mode 2 หรือโหมด mouse); ' +
    '<b>Mode 2 (soft)</b>: ตาม source HeadShotAimBot — DevNight <b>หันกล้องเอง</b> ด้วยการเขียนมุมกล้อง 0xB6F248/0xB6F258 ไปที่ตัวเป้า (แก้ FOV/เส้นเล็งให้ตรง) แต่ไล่มุมแค่บางส่วนต่อ tick + จำกัดความเร็ว → ตามแบบไม่ดูด (ดูแถว “มุมกล้องปัจจุบัน”, “มุมที่ aimbot จะเขียน”, “มุมที่ต้องหันอีก”); ' +
    '<b>Mode 2+ (snap)</b>: กลไกเดียวกัน แต่เขียนมุมเต็มทุก tick = พฤติกรรมเป๊ะของ source (สแนป/ตามแน่น); ' +
    'โหมด <b>mouse</b>: ถ้า “มุมที่ต้องหัน” มีค่าแต่กล้องไม่หัน → เกมไม่รับการฉีดเมาส์ ให้กดปรับเทียบด้านล่าง</div>' +
    '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap">' +
    '<button class="btn btn-ghost" id="aimTestR">ทดสอบเมาส์ → ขวา</button>' +
    '<button class="btn btn-ghost" id="aimTestL">ทดสอบเมาส์ ← ซ้าย</button>' +
    '<button class="btn btn-primary" id="aimCalib">ปรับเทียบ (วัดความไวเมาส์)</button>' +
    '</div>' +
    '<div class="diag-note" id="aimCalibOut">' + (aimLastCalib || 'กด “ปรับเทียบ” ขณะ <b>อยู่ในเกม (โฟกัสเกม)</b> — ระบบจะขยับเมาส์เล็กน้อย วัดว่ากล้องตอบสนองและทิศทางถูกต้องไหม') + '</div>';
  const tr = p.querySelector('#aimTestR');
  const tl = p.querySelector('#aimTestL');
  const cb = p.querySelector('#aimCalib');
  const po = p.querySelector('#aimPlayersOnly');
  const lp = p.querySelector('#aimListPeds');
  const msel = p.querySelector('#aimMode');
  if (msel) { msel.value = i.mode; }
  if (tr) tr.onclick = () => api('/api/aimbot-test', 'POST', { dx: 150, dy: 0 });
  if (tl) tl.onclick = () => api('/api/aimbot-test', 'POST', { dx: -150, dy: 0 });
  if (msel) msel.onchange = async () => {
    try { await api('/api/aimbot-option', 'POST', { mode: msel.value }); }
    catch (e) { aimLastPeds = '<span class="diag-err">' + e.message + '</span>'; }
    refreshAimDebug();
  };
  if (po) po.onchange = async () => {
    try {
      const r = await api('/api/aimbot-option', 'POST', { playersOnly: po.checked });
      if (!r.ok) aimLastPeds = '<span class="diag-err">' + (r.error || 'error') + '</span>';
    } catch (e) { aimLastPeds = '<span class="diag-err">' + e.message + '</span>'; }
    refreshAimDebug();
  };
  if (lp) lp.onclick = async () => {
    aimLastPeds = 'กำลังอ่าน...';
    refreshAimDebug();
    try {
      const r = await api('/api/aimbot-peds');
      if (!r.ok) { aimLastPeds = '<span class="diag-err">' + (r.error || 'error') + '</span>'; }
      else {
        const rows = (r.entries || []).map((e) =>
          '<tr' + (e.isPlayerType ? ' class="diag-ok"' : '') + '><td>' + e.dist + ' ม.</td>' +
          '<td>' + e.typeName + ' (type=' + e.type + ', createdBy=' + e.createdBy + ')</td>' +
          '<td>' + (e.isSelf ? 'ตัวเอง' : (e.isPlayerType ? 'ผู้เล่น' : 'NPC')) + ' · hp ' + e.health + '</td></tr>'
        ).join('');
        const hist = Object.keys(r.histogram || {}).map((k) => k + '×' + r.histogram[k]).join(', ');
        aimLastPeds = '<b>พบ ped ' + r.live + ' ตัว</b> (stride ' + r.stride + ') · ชนิด: ' + (hist || '—') +
          '<table class="diag-table"><tbody>' + rows + '</tbody></table>' +
          '<span>ถ้าผู้เล่นขึ้นเป็น type อื่นที่ไม่ใช่ 0-3 ให้บอกผม จะได้ปรับตัวกรองให้ตรง</span>';
      }
    } catch (e) { aimLastPeds = '<span class="diag-err">' + e.message + '</span>'; }
    refreshAimDebug();
  };
  if (cb) cb.onclick = async () => {
    aimLastCalib = 'กำลังวัด... (โฟกัสเกมค้างไว้)';
    refreshAimDebug();
    try {
      const r = await api('/api/aimbot-calibrate');
      if (!r.ok) { aimLastCalib = '<span class="diag-err">' + r.error + '</span>'; }
      else {
        aimLastCalib =
          'กล้องตอบสนอง: ' + (r.moved ? '<span class="diag-ok">ใช่</span>' : '<span class="diag-bad">ไม่</span>') +
          ' · ผลตอบสนอง: yaw ' + r.responseDeg.yawPer200dx + '°/200dx, pitch ' + r.responseDeg.pitchPer200dy + '°/200dy' +
          ' · วัดได้ ≈ yaw ' + (r.measured.countsPerRadYaw || '—') + ' , pitch ' + (r.measured.countsPerRadPitch || '—') + ' counts/rad' +
          ' · ที่ตั้งไว้ ' + r.configured.AIM_COUNTS_PER_RAD + ' · ' + r.verdict;
      }
    } catch (e) { aimLastCalib = '<span class="diag-err">' + e.message + '</span>'; }
    refreshAimDebug();
  };
}

els.aimDebugBtn.addEventListener('click', () => {
  const p = els.aimDebug;
  const nowHidden = p.classList.toggle('hidden');
  if (!nowHidden) {
    refreshAimDebug();
    if (!aimDebugTimer) aimDebugTimer = setInterval(refreshAimDebug, 250);
  } else if (aimDebugTimer) {
    clearInterval(aimDebugTimer);
    aimDebugTimer = null;
  }
});

// Initial load + polling.
refreshStatus();
setInterval(refreshStatus, 500);

