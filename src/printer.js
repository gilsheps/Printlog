// Printer screen: everything the printer reports (live), plus statistics from the print history
const STAGE = {
  0: 'מדפיס', 1: 'יישור משטח אוטומטי', 2: 'חימום המשטח', 3: 'סריקת מנגנון', 4: 'החלפת פילמנט', 5: 'השהיה', 6: 'נעצר: הפילמנט נגמר',
  7: 'חימום הפיה', 8: 'כיול שפיכה', 9: 'סריקת המשטח', 10: 'בדיקת השכבה הראשונה', 11: 'זיהוי סוג המשטח', 12: 'כיול Lidar', 13: 'איפוס צירים',
  14: 'ניקוי הפיה', 15: 'בדיקת טמפרטורת הפיה', 16: 'הושהה על ידי המשתמש', 17: 'נעצר: המכסה הקדמי נפל', 18: 'כיול Lidar', 19: 'כיול זרימה',
  20: 'נעצר: תקלת טמפרטורה בפיה', 21: 'נעצר: תקלת טמפרטורה במשטח', 22: 'פריקת פילמנט', 23: 'נעצר: דילוג צעד במנוע', 24: 'טעינת פילמנט',
  25: 'כיול רעשי מנוע', 26: 'נעצר: ה-AMS התנתק', 27: 'נעצר: מאוורר הקירור איטי', 28: 'נעצר: תקלת טמפרטורת התא', 29: 'קירור התא',
  30: 'הושהה מתוך ה-G-code', 31: 'בדיקת רעשי מנוע', 32: 'נעצר: פילמנט על הפיה', 33: 'נעצר: תקלה בחותך', 34: 'נעצר: בעיה בשכבה הראשונה', 35: 'נעצר: סתימה בפיה',
};
const SPEED = { 1: 'שקט', 2: 'רגיל', 3: 'ספורט', 4: 'טורבו' };
const STATE = { RUNNING: 'מדפיס', PREPARE: 'מתכונן', PAUSE: 'מושהה', FINISH: 'סיים', FAILED: 'נכשל', IDLE: 'פנוי', SLICING: 'פורס' };
const HMS_MODULE = { '03': 'מערכת התנועה', '05': 'לוח ראשי', '07': 'AMS', '08': 'ראש ההדפסה', '0C': 'מצלמה וחיישנים', '12': 'AMS Lite', '18': 'AMS HT' };
const hmsCode = (attr, code) => { const h = (n) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0'); return (h(attr) + h(code)).match(/.{4}/g).join('_'); };
const num = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);
const color = (c) => (c && /^[0-9a-f]{6}/i.test(c) ? '#' + c.slice(0, 6) : null);
const fan = (v) => { const n = num(v); return n == null ? null : Math.round((n / 15) * 10) * 10; };

// newer models (H2D, P2S…) pack "current | target << 16" into device.*.info.temp
function packed(v) { const n = num(v); if (n == null) return null; return { cur: n & 0xffff, tgt: n >>> 16 }; }
function temps(r) {
  const t = [];
  const d = r.device || {};
  const ext = d.extruder && Array.isArray(d.extruder.info) ? d.extruder.info : [];
  if (num(r.nozzle_temper) != null) t.push({ label: 'פיה', cur: num(r.nozzle_temper), tgt: num(r.nozzle_target_temper) });
  else ext.forEach((e, i) => { const p = packed(e.temp); if (p) t.push({ label: ext.length > 1 ? `פיה ${i ? 'שמאל' : 'ימין'}` : 'פיה', ...p }); });
  if (num(r.bed_temper) != null) t.push({ label: 'משטח', cur: num(r.bed_temper), tgt: num(r.bed_target_temper) });
  else if (d.bed && d.bed.info) { const p = packed(d.bed.info.temp); if (p) t.push({ label: 'משטח', ...p }); }
  if (num(r.chamber_temper) != null && num(r.chamber_temper) > 0) t.push({ label: 'תא ההדפסה', cur: num(r.chamber_temper) });
  else if (d.ctc && d.ctc.info) { const p = packed(d.ctc.info.temp); if (p) t.push({ label: 'תא ההדפסה', ...p }); }
  return t;
}

export function printerScreenHTML(d, ctx) {
  const { esc, fmtDur, I, prints } = ctx;
  const r = d.report || {};
  const st = String(r.gcode_state || (d.status && d.status.state) || '').toUpperCase();
  const live = d.reportAt && Date.now() - d.reportAt < 10 * 60 * 1000;
  const active = ['RUNNING', 'PAUSE', 'PREPARE'].includes(st);
  const stage = num(r.stg_cur) != null && STAGE[num(r.stg_cur)] ? STAGE[num(r.stg_cur)] : '';
  const remain = num(r.mc_remaining_time);
  const eta = remain ? new Date(Date.now() + remain * 60000).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
  const pct = num(r.mc_percent) || 0;
  const sec = (title, body) => (body ? `<section class="pr-sec"><h4>${title}</h4>${body}</section>` : '');
  const kv = (rows) => { const x = rows.filter((a) => a[1] != null && a[1] !== ''); return x.length ? `<dl class="kv pr-kv">${x.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''; };

  // job
  const job = active ? `<div class="pr-job">
      <div class="pr-job-top"><b>${esc(r.subtask_name || r.gcode_file || 'הדפסה')}</b><span class="pill ${st === 'PAUSE' ? 'partial' : 'ok'}">${STATE[st] || st}</span></div>
      <div class="pr-bar"><i style="width:${pct}%"></i></div>
      <div class="pr-job-meta"><span class="big">${pct}%</span>
        ${num(r.layer_num) != null ? `<span>שכבה ${r.layer_num}${num(r.total_layer_num) ? ' / ' + r.total_layer_num : ''}</span>` : ''}
        ${remain ? `<span>נשארו ${fmtDur(remain * 60)} · מסתיים ב-${eta}</span>` : ''}
        ${stage ? `<span>${stage}</span>` : ''}
        ${SPEED[num(r.spd_lvl)] ? `<span>מהירות: ${SPEED[num(r.spd_lvl)]}</span>` : ''}</div>
    </div>` : `<div class="pr-idle">${live ? `המדפסת ${STATE[st] ? STATE[st] : 'מחוברת'}` : 'אין כרגע נתונים חיים מהמדפסת (כבויה או לא מחוברת)'}</div>`;

  // temperatures
  const T = temps(r);
  const tempsHTML = T.length ? `<div class="pr-tiles">${T.map((t) => `<div class="pr-tile"><span class="lbl">${t.label}</span><span class="val">${Math.round(t.cur)}°</span>${t.tgt ? `<span class="sub">יעד ${Math.round(t.tgt)}°</span>` : ''}</div>`).join('')}</div>` : '';

  // AMS
  const units = r.ams && Array.isArray(r.ams.ams) ? r.ams.ams : [];
  const trayNow = num(r.ams && r.ams.tray_now);
  const tray = (t, idx, unitId) => {
    const c = color(t.tray_color);
    const rem = num(t.remain);
    const on = trayNow != null && trayNow === +unitId * 4 + +t.id;
    if (!t.tray_type) return `<div class="pr-tray pr-empty"><span class="sw"></span><span class="tt">ריק</span><span class="tn">חריץ ${idx + 1}</span></div>`;
    return `<div class="pr-tray ${on ? 'on' : ''}" title="${esc([t.tray_type, t.tray_sub_brands].filter(Boolean).join(' '))}">
      <span class="sw" style="background:${c || 'transparent'}"></span>
      <span class="tt">${esc(t.tray_sub_brands || t.tray_type)}</span>
      <span class="tn">חריץ ${idx + 1}${on ? ' · בשימוש' : ''}</span>
      ${rem != null && rem >= 0 ? `<span class="rem"><i style="width:${rem}%;${rem <= 10 ? 'background:var(--fail)' : ''}"></i></span><span class="tn">${rem}%</span>` : '<span class="tn">כמות לא ידועה</span>'}
    </div>`;
  };
  const amsHTML = units.map((u) => {
    const hum = num(u.humidity_raw) != null ? `לחות ${u.humidity_raw}%` : num(u.humidity) != null ? `לחות: רמה ${u.humidity} מתוך 5` : '';
    return `<div class="pr-ams"><div class="pr-ams-h"><b>AMS ${+u.id + 1}</b><span>${[hum, num(u.temp) ? `${Math.round(+u.temp)}°` : ''].filter(Boolean).join(' · ')}</span></div>
      <div class="pr-trays">${(u.tray || []).map((t, i) => tray(t, i, u.id)).join('')}</div></div>`;
  }).join('') + (r.vt_tray && r.vt_tray.tray_type ? `<div class="pr-ams"><div class="pr-ams-h"><b>גליל חיצוני</b></div><div class="pr-trays">${tray({ ...r.vt_tray, id: 0 }, 0, -1).replace('חריץ 1', 'חיצוני')}</div></div>` : '');

  // fans
  const fans = [['קירור החלק', fan(r.cooling_fan_speed)], ['עזר', fan(r.big_fan1_speed)], ['תא ההדפסה', fan(r.big_fan2_speed)], ['ראש ההדפסה', fan(r.heatbreak_fan_speed)]].filter((f) => f[1] != null);
  const fansHTML = fans.length ? `<div class="pr-tiles">${fans.map(([l, v]) => `<div class="pr-tile"><span class="lbl">${l}</span><span class="val">${v}%</span></div>`).join('')}</div>` : '';

  // errors
  const hms = (Array.isArray(r.hms) ? r.hms : []).map((x) => hmsCode(x.attr, x.code));
  const perr = num(r.print_error) || 0;
  const errs = [...hms.map((c) => `<div class="pr-err"><b>${HMS_MODULE[c.slice(0, 2)] ? 'תקלה ב' + (/^[A-Z]/.test(HMS_MODULE[c.slice(0, 2)]) ? '-' : '') + HMS_MODULE[c.slice(0, 2)] : 'תקלה'}</b><span class="mono">${c}</span><a href="#" data-hms="${c}">מה זה?</a></div>`),
    perr ? `<div class="pr-err"><b>${(perr & 0xffff) === 0x8011 ? 'הפילמנט נגמר' : 'שגיאת הדפסה'}</b><span class="mono">${(perr >>> 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>` : ''].join('');

  // hardware
  const light = Array.isArray(r.lights_report) ? r.lights_report.find((l) => l.node === 'chamber_light') : null;
  const hw = kv([
    ['דגם', esc(d.model || '')], ['מספר סידורי', `<span class="mono">${esc(d.serial)}</span>`],
    ['חיבור', d.conn === 'lan' ? `רשת ביתית${d.ip ? ' · ' + esc(d.ip) : ''}` : d.conn === 'cloud' ? 'Bambu Cloud' : ''],
    ['פיה', [r.nozzle_diameter ? `${r.nozzle_diameter} מ״מ` : '', esc(r.nozzle_type || '').replace('hardened_steel', 'פלדה מוקשחת').replace('stainless_steel', 'נירוסטה')].filter(Boolean).join(' · ')],
    ['Wi-Fi', r.wifi_signal ? `<span class="ltr">${esc(r.wifi_signal)}</span>` : ''],
    ['תאורה', light ? (light.mode === 'on' ? 'דולקת' : 'כבויה') : ''],
    ['כרטיס SD', r.sdcard == null ? '' : r.sdcard ? 'קיים' : 'אין'],
    ['טיימלאפס', r.ipcam ? (r.ipcam.timelapse === 'enable' ? 'פעיל' : 'כבוי') : ''],
  ]);
  const mods = (d.modules || []).filter((m) => m.sw);
  const fw = mods.length ? `<dl class="kv pr-kv">${mods.map((m) => `<dt>${esc(m.name)}</dt><dd class="mono"><bdi>${esc(m.sw)}</bdi></dd>`).join('')}</dl>` : '';

  // statistics from the history
  const ps = prints.filter((p) => !d.serial || !p.serial || p.serial === d.serial);
  const ok = ps.filter((p) => p.result === 'ok').length, fail = ps.filter((p) => p.result === 'fail').length;
  const hours = ps.reduce((a, p) => a + (p.minutes || 0), 0) / 60;
  const grams = ps.reduce((a, p) => a + (p.grams || 0), 0);
  const types = {};
  ps.forEach((p) => (p.filaments || []).forEach((f) => { if (f.type) types[f.type] = (types[f.type] || 0) + (f.grams || 0); }));
  const top = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const stats = ps.length ? `<div class="pr-tiles">
      <div class="pr-tile"><span class="lbl">הדפסות</span><span class="val">${ps.length}</span></div>
      <div class="pr-tile"><span class="lbl">הצליחו</span><span class="val">${ps.length ? Math.round((ok / ps.length) * 100) : 0}%</span><span class="sub">${fail} נכשלו</span></div>
      <div class="pr-tile"><span class="lbl">שעות הדפסה</span><span class="val">${Math.round(hours)}</span></div>
      <div class="pr-tile"><span class="lbl">פילמנט</span><span class="val">${grams >= 1000 ? (grams / 1000).toFixed(1) + ' ק״ג' : Math.round(grams) + ' ג׳'}</span>${top.length ? `<span class="sub">${top.map(([t, g]) => `<bdi>${esc(t)}</bdi> ${g >= 1000 ? (g / 1000).toFixed(1) + ' ק״ג' : Math.round(g) + ' ג׳'}`).join(' · ')}</span>` : ''}</div>
    </div>` : '';

  return `${job}
    ${sec('טמפרטורות', tempsHTML)}
    ${sec('AMS ופילמנט', amsHTML)}
    ${sec('תקלות', errs)}
    ${sec('מאווררים', fansHTML)}
    ${sec('סטטיסטיקה', stats)}
    ${sec('המדפסת', hw)}
    ${sec('גרסאות קושחה', fw)}
    <div class="hint" style="margin-top:6px">${live ? `עודכן ${new Date(d.reportAt).toLocaleTimeString('he-IL')}` : ''}</div>`;
}
