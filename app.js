import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const L = { belum: "Belum", proses: "Proses", selesai: "Selesai" };
const NEXT = { belum: "proses", proses: "selesai", selesai: "belum" };
let me = null, admin = false, tasks = [], view = "login", modal = null, err = "", showPast = false, loading = true, chan = null;
const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }); };

const cache = { get: () => { try { return JSON.parse(localStorage.getItem("tasks") || "[]"); } catch { return []; } }, set: v => { try { localStorage.setItem("tasks", JSON.stringify(v)); } catch {} } };

async function load() {
  const { data, error } = await sb.from("tasks").select("*").order("at");
  loading = false;
  if (error) { tasks = cache.get(); err = tasks.length ? "Offline: menampilkan data terakhir." : "Gagal memuat task."; }
  else { tasks = data; cache.set(data); err = ""; }
  render();
}

async function onSession(session) {
  me = session?.user ?? null; admin = false; err = "";
  if (chan) { sb.removeChannel(chan); chan = null; }
  if (!me) { view = "login"; tasks = []; return render(); }
  const { data } = await sb.from("profiles").select("role").eq("id", me.id).maybeSingle();
  admin = data?.role === "admin";
  view = "main"; loading = true; render();
  await load();
  chan = sb.channel("tasks").on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, load).subscribe();
}
// setTimeout menghindari deadlock pemanggilan Supabase di dalam callback auth
sb.auth.onAuthStateChange((_e, session) => setTimeout(() => onSession(session), 0));

// RLS yang menolak menghasilkan 0 baris, bukan error: anggap itu gagal
async function mut(q) { const { data, error } = await q; if (error || !data?.length) throw new Error("ditolak"); await load(); }

function split() {
  const now = Date.now(), s = tasks.filter(t => t.at);
  return { up: s.filter(t => new Date(t.at) >= now), past: s.filter(t => new Date(t.at) < now).reverse() };
}
const stBtn = t => { const c = "st " + (t.status || "belum"); return admin ? `<button class="${c}" data-st="${t.id}"><i></i>${L[t.status || "belum"]}</button>` : `<span class="${c} ro"><i></i>${L[t.status || "belum"]}</span>`; };
const card = (t, z) => `<div class="card ${z}">${admin ? `<button class="del" data-del="${t.id}">hapus</button>` : ""}<h2>${esc(t.title)}</h2><div class="when">${fmt(t.at)}</div><p class="det">${esc(t.detail)}</p>${stBtn(t)}</div>`;
const head = () => `<header><h1>Task Manager</h1><div class="nav"><span class="badge">${admin ? "Admin" : "User"}</span>${admin ? `<button data-go="${view === "input" ? "main" : "input"}">${view === "input" ? "Daftar task" : "+ Task"}</button>` : ""}<button data-out="1">Keluar</button></div></header>`;

function render() {
  let h = "";
  if (view === "login" || !me) {
    h = `<form class="center" id="login"><h1>Task Manager</h1><label>Email</label><input type="email" id="l-e" autocomplete="username" required><label>Password</label><input type="password" id="l-p" autocomplete="current-password" required><p class="err">${esc(err)}</p><button class="p" type="submit">Masuk</button></form>`;
  } else if (view === "main") {
    const { up, past } = split();
    h = head() + (err ? `<p class="err">${esc(err)}</p>` : "");
    if (loading) h += `<p class="mut">Memuat…</p>`;
    else if (!tasks.length) h += `<p class="mut">Belum ada task.</p>`;
    up.forEach((t, i) => h += card(t, i === 0 ? "big" : i < 4 ? "mid" : "sm"));
    if (!up.length && tasks.length) h += `<p class="mut">Tidak ada task mendatang.</p>`;
    if (past.length) { h += `<div class="sec">Terlewat (${past.length}) <button data-past="1" style="padding:2px 8px;font-size:12px">${showPast ? "sembunyikan" : "tampilkan"}</button></div>`; if (showPast) past.forEach(t => h += card(t, "sm")); }
  } else if (view === "input" && admin) {
    h = head() + `<div class="card"><h2>Task baru</h2><div class="row"><div><label>Tanggal</label><input type="date" id="f-d"></div><div><label>Waktu</label><input type="time" id="f-t"></div></div><label>Judul</label><input id="f-title" maxlength="150"><label>Detail</label><textarea id="f-detail"></textarea><p class="err" id="f-err"></p><button class="p" id="f-save">Simpan</button></div>`;
  } else { view = "main"; return render(); }
  if (modal) h += `<div class="modal"><div class="box"><b>${esc(modal.text)}</b><div class="acts"><button data-no="1">Batal</button><button class="p" data-yes="1">Ya</button></div></div></div>`;
  app.innerHTML = h;
}

app.addEventListener("submit", async e => {
  if (e.target.id !== "login") return;
  e.preventDefault(); err = "";
  const { error } = await sb.auth.signInWithPassword({ email: document.getElementById("l-e").value.trim(), password: document.getElementById("l-p").value });
  if (error) { err = "Email atau password salah."; render(); }
});

app.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.out) return sb.auth.signOut();
  if (d.go) { view = d.go; return render(); }
  if (d.past) { showPast = !showPast; return render(); }
  if (d.st && admin) { const t = tasks.find(x => x.id === d.st), n = NEXT[t.status || "belum"]; modal = { text: `Ubah status “${t.title}” menjadi ${L[n]}?`, run: () => mut(sb.from("tasks").update({ status: n }).eq("id", t.id).select()) }; return render(); }
  if (d.del && admin) { const t = tasks.find(x => x.id === d.del); modal = { text: `Hapus task “${t.title}”?`, run: () => mut(sb.from("tasks").delete().eq("id", t.id).select()) }; return render(); }
  if (d.no) { modal = null; return render(); }
  if (d.yes) { const m = modal; modal = null; render(); try { await m.run(); } catch (x) { err = "Aksi ditolak atau gagal."; } return render(); }
  if (b.id === "f-save") {
    const v = id => document.getElementById(id).value.trim(), er = document.getElementById("f-err");
    const date = v("f-d"), time = v("f-t"), title = v("f-title"), detail = v("f-detail");
    if (!date || !time || !title) { er.textContent = "Tanggal, waktu, dan judul wajib diisi."; return; }
    const { error } = await sb.from("tasks").insert({ title, detail, at: new Date(`${date}T${time}`).toISOString() });
    if (error) { er.textContent = "Gagal menyimpan. Pastikan Anda admin."; return; }
    view = "main"; err = ""; await load();
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
render();
