/* CampusShelf v2 — giao diện thuần JS, gọi API Express + SQLite */
const state = {
  page: "home", token: localStorage.getItem("cs_token") || "", me: null,
  meta: { modes: [], categories: [], conditions: [], locations: [], ai: false, demo: true, emailDomains: [] },
  mode: "", q: "", course: "", condition: "", category: "", location: "", maxPrice: "", sort: "newest", geo: null,
  conversation: null, exTab: "active", adminTab: "reports", authTab: "login", pendingEmail: "", demoCode: "", after: "", assistantText: ""
};
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const money = n => Number(n) === 0 ? "Miễn phí" : new Intl.NumberFormat("vi-VN").format(n) + "đ";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = s => (s || "?").trim().split(/\s+/).slice(-2).map(x => x[0]).join("").toUpperCase();
const modeClass = mode => ({ "Bán": "sale", "Trao đổi": "swap", "Tặng": "gift", "Cho mượn": "borrow" }[mode] || "");
const fmt = s => {
  if (!s) return "";
  const str = String(s), d = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(str) ? new Date(str.replace(" ", "T") + "Z") : new Date(str);
  return isNaN(d) ? str : d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
};
const starsHtml = n => `<span class="stars">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>`;
const options = (list, sel) => list.map(v => `<option${v === sel ? " selected" : ""}>${esc(v)}</option>`).join("");
const coverClass = item => ({ "Xử lý tín hiệu số": "cover-dsp", "Lý thuyết mạch điện": "cover-circuit", "Điện từ học – Sadiku": "cover-em", "Xác suất thống kê": "cover-stat", "Điện tử tương tự": "cover-analog", "Giải tích 3": "cover-calc" }[item.title] || ["cover-dsp", "cover-circuit", "cover-em", "cover-stat"][item.id % 4]);
const coverLabel = item => {
  if (item.image && item.image.startsWith("/uploads/")) return `<img src="${esc(item.image)}" alt="Ảnh tài liệu" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0">`;
  return `<div class="book-cover ${coverClass(item)}"><b>${esc(item.title).replace(" – ", "<br>").replace(" ", "<br>")}</b><small>${esc(item.author || "CAMPUS EDITION").toUpperCase()}</small><span class="cover-mark">${({ "cover-dsp": "DSP", "cover-circuit": "∿", "cover-em": "E·M", "cover-stat": "Σ", "cover-analog": "∿", "cover-calc": "∫" })[coverClass(item)] || "C+"}</span></div>`;
};
function card(item, extra = "") {
  const where = state.geo ? `${Number(item.distance || 0).toFixed(1)} km` : esc(item.location || "");
  const off = item.status && item.status !== "Đang tìm chủ mới" ? `<span class="status-tag">${esc(item.status)}</span>` : "";
  return `<article class="book-card">
    <div class="book-art"><span class="cover-tag">${esc(item.category || "Giáo trình")}</span><button class="cover-save" data-save="${item.id}" title="Lưu tài liệu">♡</button>${coverLabel(item)}${off}</div>
    <div class="card-content"><div class="card-course">${esc(item.course || "Tài liệu học tập")}</div><h3 class="card-title">${esc(item.title)}</h3><div class="card-author">${esc(item.author || "Chưa cập nhật tác giả")}</div>
    <div class="card-meta"><span class="price ${Number(item.price) === 0 ? "free" : ""}">${money(item.price)}</span><span class="condition">${esc(item.condition || "Tốt")}</span></div>
    <div class="card-bottom"><div class="owner"><span class="owner-avatar">${esc(initials(item.owner_name))}</span><span>${esc(item.owner_name)}<br><span class="rating">★ <b>${Number(item.owner_rating || 5).toFixed(1)}</b> · ${where}</span></span></div><span class="mode-tag ${modeClass(item.mode)}">${esc(item.mode)}</span></div>
    <button class="btn btn-light btn-small detail-btn" style="width:100%;margin-top:13px" data-detail="${item.id}">Xem chi tiết <span>↗</span></button>${extra}</div></article>`;
}
function empty(title, desc, btn = `<button class="btn btn-light btn-small" data-page="requests">Đăng nhu cầu tìm sách</button>`) {
  return `<div class="empty-state"><div class="empty-icon">⌕</div><h3>${esc(title)}</h3><p>${esc(desc)}</p>${btn}</div>`;
}
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}
async function api(url, opt = {}) {
  opt.headers = { ...(opt.headers || {}) };
  if (state.token) opt.headers.Authorization = "Bearer " + state.token;
  if (opt.body && !(opt.body instanceof FormData) && typeof opt.body !== "string") { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(opt.body); }
  const res = await fetch(url, opt);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.token && !url.startsWith("/api/auth/")) { clearSession(); setPage("auth"); toast("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại."); }
    const err = new Error(data.error || "Đã xảy ra lỗi."); err.data = data; err.status = res.status; throw err;
  }
  return data;
}

/* ---------- Phiên đăng nhập, realtime ---------- */
let stream = null;
function setSession(token, user) {
  state.token = token; state.me = user; localStorage.setItem("cs_token", token);
  renderAuthArea(); connectStream(); refreshUnread();
}
function clearSession() {
  state.token = ""; state.me = null; localStorage.removeItem("cs_token");
  if (stream) { stream.close(); stream = null; }
  renderAuthArea();
}
function connectStream() {
  if (stream) stream.close();
  if (!state.token) return;
  stream = new EventSource("/api/stream?token=" + encodeURIComponent(state.token));
  stream.addEventListener("message", e => {
    const d = JSON.parse(e.data); refreshUnread();
    if (state.page === "messages") { loadConversations(); if (state.conversation === d.key) loadMessages(); }
    else toast(`Tin nhắn mới từ ${d.sender}`);
  });
  stream.addEventListener("notification", e => {
    const d = JSON.parse(e.data); refreshUnread(); toast(d.text);
    if (state.page === "exchanges") renderExchanges(); else if (state.page === "notifications") renderNotifications();
  });
  stream.onerror = () => { if (stream && stream.readyState === 2) { stream = null; } };
}
async function refreshUnread() {
  if (!state.token) return;
  try {
    const u = await api("/api/unread");
    $("#msgDot").hidden = !u.messages;
    const b = $("#bellBadge"); if (b) { b.textContent = u.notifications > 9 ? "9+" : u.notifications; b.hidden = !u.notifications; }
  } catch { /* bỏ qua */ }
}
setInterval(refreshUnread, 60000);
function renderAuthArea() {
  const me = state.me;
  $("#adminLink").hidden = !(me && me.role === "admin");
  if (!me) { $("#authArea").innerHTML = `<button class="btn btn-primary btn-small" data-page="auth">Đăng nhập</button>`; $("#msgDot").hidden = true; return; }
  $("#authArea").innerHTML = `<button class="icon-btn bell" data-page="notifications" title="Thông báo">🔔<span class="badge" id="bellBadge" hidden>0</span></button>
    <button class="avatar" data-page="profile" title="${esc(me.name)} · Hồ sơ">${esc(initials(me.name).slice(0, 2))}</button>
    <button class="btn btn-light btn-small" data-act="logout">Đăng xuất</button>`;
}
function needLogin(msg = "Vui lòng đăng nhập để tiếp tục.") {
  if (state.me) return false;
  state.after = state.page; toast(msg); closeModal(); setPage("auth"); return true;
}

/* ---------- Điều hướng ---------- */
// Các trang tải dữ liệu bất đồng bộ chỉ được vẽ nếu người dùng vẫn đang ở đúng trang đó.
const paint = (page, html) => { if (state.page !== page) return false; $("#app").innerHTML = html; return true; };
const setHtml = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; return !!el; };
const AUTH_PAGES = ["post", "exchanges", "messages", "notifications", "admin", "profile"];
function setPage(page) {
  if (AUTH_PAGES.includes(page) && !state.me) { state.after = page; page = "auth"; }
  if (page === "admin" && state.me && state.me.role !== "admin") { toast("Chỉ quản trị viên mới truy cập được."); page = "home"; }
  state.page = page;
  $$(".nav-link").forEach(a => a.classList.toggle("active", a.dataset.page === page || (page === "catalog" && a.dataset.page === "home")));
  const r = { home: renderHome, catalog: renderCatalog, post: renderPost, requests: renderRequests, assistant: renderAssistant, exchanges: renderExchanges, messages: renderMessages, notifications: renderNotifications, admin: renderAdmin, profile: renderProfile, auth: renderAuth }[page];
  (r || renderHome)();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Trang chủ ---------- */
function renderHome() {
  $("#app").innerHTML = $("#homeTemplate").innerHTML;
  const t = $("[data-ai-text]");
  if (t) t.textContent = state.meta.ai ? "Tải ảnh bìa lên, AI sẽ tự đọc tên sách, tác giả và môn học giúp bạn." : "Tải ảnh bìa lên để thử luồng nhập liệu thông minh. Máy chủ chưa bật AI nên bạn nhập thông tin thủ công.";
  $("#quickModes").addEventListener("click", e => {
    const b = e.target.closest("[data-mode]"); if (!b) return;
    $$(".pill").forEach(x => x.classList.toggle("active", x === b)); loadHome(b.dataset.mode);
  });
  loadHome("");
}
async function loadHome(mode) {
  try {
    const all = await api("/api/listings");
    if (!$("#statBooks")) return;
    $("#statBooks").textContent = String(all.length).padStart(2, "0");
    const items = mode ? all.filter(x => x.mode === mode) : all;
    $("#homeListings").innerHTML = items.slice(0, 3).map(x => card(x)).join("") || empty("Chưa có tài liệu", "Hãy đăng tài liệu đầu tiên cho cộng đồng.");
  } catch (e) { toast(e.message); }
}

/* ---------- Danh mục tài liệu ---------- */
function renderCatalog() {
  const m = state.meta;
  $("#app").innerHTML = `<section class="page-shell"><div class="page-head"><div><div class="eyebrow">THƯ VIỆN CỘNG ĐỒNG</div><h1>Khám phá tài liệu.</h1><p>Tìm sách theo môn học, hình thức, tình trạng và điểm hẹn gần bạn.</p></div><button class="btn btn-primary" data-page="post">＋ Đăng tài liệu</button></div>
  <div class="catalog-layout"><aside class="filter-panel"><h3>Bộ lọc <span style="float:right;color:#89a57a">☷</span></h3>
  <label class="field-label">Từ khóa</label><input class="field" id="filterQ" placeholder="Tên sách, tác giả, môn học…" value="${esc(state.q)}">
  <div class="filter-row"><label class="field-label">Hình thức</label><select class="select-field" id="filterMode"><option value="">Tất cả hình thức</option>${options(m.modes, state.mode)}</select>
  <label class="field-label">Tình trạng</label><select class="select-field" id="filterCondition"><option value="">Tất cả</option>${options(m.conditions, state.condition)}</select></div>
  <label class="field-label">Loại tài liệu</label><select class="select-field" id="filterCategory"><option value="">Tất cả</option>${options(m.categories, state.category)}</select>
  <label class="field-label">Môn học</label><input class="field" id="filterCourse" placeholder="VD: Trường điện từ" value="${esc(state.course)}">
  <label class="field-label">Điểm hẹn (landmark)</label><select class="select-field" id="filterLocation"><option value="">Tất cả địa điểm</option>${options(m.locations, state.location)}</select>
  <label class="field-label">Giá tối đa (đ)</label><input class="field" id="filterPrice" type="number" min="0" step="5000" placeholder="VD: 50000" value="${esc(state.maxPrice)}">
  <label class="field-label">Sắp xếp</label><select class="select-field" id="filterSort"><option value="newest">Mới đăng</option><option value="price_asc">Giá thấp trước</option><option value="near">Gần bạn trước</option></select>
  <button class="btn btn-light btn-small" id="useGeo" style="width:100%;margin-top:12px">📍 ${state.geo ? "Đã dùng vị trí của bạn" : "Dùng vị trí của tôi"}</button>
  <div class="filter-actions"><button class="btn btn-primary btn-small" id="applyFilters" style="flex:1">Áp dụng</button><button class="btn btn-light btn-small" id="clearFilters">Xóa lọc</button></div>
  <p class="help-text">Khoảng cách tính từ vị trí trình duyệt của bạn tới điểm hẹn (ước lượng). Nếu không cho phép vị trí, danh sách hiển thị tên điểm hẹn.</p></aside>
  <div><div class="catalog-topline"><span id="resultCount">Đang tải tài liệu…</span><span>Hiển thị dạng lưới ▦</span></div><div class="listing-grid catalog-grid" id="catalogResults"></div></div></div></section>`;
  $("#filterSort").value = state.sort;
  $("#applyFilters").onclick = applyFilters;
  $("#clearFilters").onclick = () => { Object.assign(state, { q: "", mode: "", course: "", condition: "", category: "", location: "", maxPrice: "", sort: "newest", geo: null }); renderCatalog(); };
  $("#useGeo").onclick = () => {
    if (!navigator.geolocation) return toast("Trình duyệt không hỗ trợ định vị.");
    navigator.geolocation.getCurrentPosition(p => { state.geo = { lat: p.coords.latitude, lng: p.coords.longitude }; state.sort = "near"; renderCatalog(); },
      () => toast("Không lấy được vị trí. Hãy cho phép truy cập vị trí trong trình duyệt."), { timeout: 8000 });
  };
  ["filterQ", "filterCourse", "filterPrice"].forEach(id => $("#" + id).addEventListener("keydown", e => { if (e.key === "Enter") applyFilters(); }));
  applyFilters();
}
async function applyFilters() {
  if (!$("#filterQ")) return;
  const v = id => $("#" + id).value.trim();
  Object.assign(state, { q: v("filterQ"), mode: v("filterMode"), course: v("filterCourse"), condition: v("filterCondition"), category: v("filterCategory"), location: v("filterLocation"), maxPrice: v("filterPrice"), sort: v("filterSort") });
  const p = new URLSearchParams({ q: state.q, mode: state.mode, course: state.course, condition: state.condition, category: state.category, location: state.location, max_price: state.maxPrice, sort: state.sort });
  if (state.geo) { p.set("lat", state.geo.lat); p.set("lng", state.geo.lng); }
  try {
    const items = await api("/api/listings?" + p);
    if (!$("#resultCount")) return;
    $("#resultCount").innerHTML = `Tìm thấy <b>${items.length}</b> tài liệu`;
    $("#catalogResults").innerHTML = items.map(x => card(x)).join("") || empty("Không tìm thấy tài liệu phù hợp", "Thử đổi bộ lọc hoặc đăng nhu cầu tìm sách.");
  } catch (e) { toast(e.message); }
}

/* ---------- Đăng / sửa tài liệu ---------- */
function listingFields(v = {}) {
  const m = state.meta;
  return `<div class="form-group full"><label for="postTitle">Tên tài liệu *</label><input class="field" id="postTitle" name="title" required maxlength="200" value="${esc(v.title)}" placeholder="VD: Xử lý tín hiệu số"></div>
  <div class="form-group"><label for="postAuthor">Tác giả</label><input class="field" id="postAuthor" name="author" maxlength="150" value="${esc(v.author)}" placeholder="Tên tác giả / giảng viên"></div>
  <div class="form-group"><label for="postCourse">Môn học</label><input class="field" id="postCourse" name="course" maxlength="150" value="${esc(v.course)}" placeholder="VD: Xử lý tín hiệu số"></div>
  <div class="form-group"><label for="postCategory">Loại tài liệu</label><select class="select-field" id="postCategory" name="category">${options(m.categories, v.category)}</select></div>
  <div class="form-group"><label for="postCondition">Tình trạng</label><select class="select-field" name="condition">${options(m.conditions, v.condition || "Tốt")}</select></div>
  <div class="form-group"><label for="postMode">Hình thức *</label><select class="select-field" id="postMode" name="mode">${options(m.modes, v.mode)}</select></div>
  <div class="form-group"><label for="postPrice">Giá (VNĐ)</label><input class="field" id="postPrice" name="price" type="number" min="0" value="${Number(v.price) || 0}"><div class="help-text">Chỉ áp dụng cho hình thức Bán; các hình thức khác tự về 0đ.</div></div>
  <div class="form-group full"><label for="postLocation">Địa điểm hẹn giao nhận</label><select class="select-field" id="postLocation" name="location">${options(m.locations, v.location)}</select></div>
  <div class="form-group full"><label for="postDescription">Mô tả</label><textarea class="text-field" id="postDescription" name="description" maxlength="2000" placeholder="Mô tả tình trạng, ghi chú, điều kiện trao đổi…">${esc(v.description)}</textarea></div>`;
}
function bindUploadPreview(input) {
  input.addEventListener("change", e => {
    const f = e.target.files[0], preview = $("#uploadPreview");
    if (!f) { preview.style.display = "none"; return; }
    preview.src = URL.createObjectURL(f); preview.style.display = "block";
    $(".upload-box .upload-icon").style.display = "none"; $(".upload-box b").textContent = f.name; $(".upload-box small").textContent = "Ảnh đã chọn — có thể thay đổi";
  });
}
function renderPost() {
  const ai = state.meta.ai;
  $("#app").innerHTML = `<section class="page-shell"><div class="page-head"><div><div class="eyebrow">CHIA SẺ TRI THỨC</div><h1>Đăng tài liệu mới.</h1><p>Thông tin càng rõ ràng, người cần càng dễ tìm thấy bạn.</p></div></div><div class="form-layout"><form class="form-card" id="postForm"><h2>Thông tin tài liệu</h2><p class="subtext">Các trường có dấu * là bắt buộc. Bạn có thể chỉnh lại gợi ý trước khi đăng.</p><div class="form-grid">
  <div class="form-group full"><label>Ảnh bìa / ảnh tài liệu</label><label class="upload-box" for="coverFile"><span class="upload-icon">↥</span><b>Nhấn để tải ảnh lên</b><small>JPG, PNG, WEBP hoặc GIF · Tối đa 5 MB</small><img id="uploadPreview" class="upload-preview" alt="Xem trước ảnh"><input id="coverFile" name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
  <div class="ai-sim"><span class="ai-sim-icon">✳</span><div><b>Trợ lý AI nhận diện bìa</b><p>${ai ? "AI sẽ đọc ảnh bìa và điền sẵn tên sách, tác giả, môn học, loại tài liệu. Bạn nên kiểm tra lại trước khi đăng." : "Máy chủ chưa cấu hình ANTHROPIC_API_KEY nên chưa dùng được nhận diện ảnh. Bạn vẫn có thể nhập tay."}</p><button type="button" class="btn btn-light" id="aiExtract"${ai ? "" : " disabled"}>✦ Nhận diện từ ảnh bìa</button></div></div></div>
  ${listingFields({ mode: "Bán" })}</div><div class="form-actions"><button type="button" class="btn btn-light" data-page="catalog">Hủy</button><button class="btn btn-primary" type="submit">Đăng tài liệu <span>↗</span></button></div></form>
  <aside><div class="side-card"><h3>✳ Mẹo đăng tin tốt</h3><ul><li>Chụp rõ bìa và tình trạng sách.</li><li>Ghi chính xác tên tài liệu, tác giả và môn học.</li><li>Nêu rõ giá hoặc điều kiện trao đổi.</li><li>Chọn điểm hẹn công cộng trong trường.</li></ul></div><div class="side-card"><h3>🔒 An toàn cộng đồng</h3><p>Không đăng số điện thoại, địa chỉ nhà hay thông tin nhạy cảm trong mô tả. Hai bên nên thống nhất gặp tại nơi công cộng.</p></div></aside></div></section>`;
  bindUploadPreview($("#coverFile"));
  $("#aiExtract").onclick = async () => {
    const f = $("#coverFile").files[0]; if (!f) return toast("Hãy chọn ảnh bìa trước.");
    const btn = $("#aiExtract"); btn.disabled = true; btn.textContent = "Đang đọc ảnh…";
    try {
      const fd = new FormData(); fd.append("image", f);
      const r = await api("/api/ai/extract-cover", { method: "POST", body: fd });
      if (r.title) $("#postTitle").value = r.title; if (r.author) $("#postAuthor").value = r.author;
      if (r.course) $("#postCourse").value = r.course; if (r.category) $("#postCategory").value = r.category;
      toast(r.title ? "AI đã điền gợi ý, hãy kiểm tra lại thông tin." : "AI không nhận ra thông tin trên ảnh, hãy nhập tay.");
    } catch (e) { toast(e.message); }
    btn.disabled = false; btn.textContent = "✦ Nhận diện từ ảnh bìa";
  };
  $("#postForm").onsubmit = async e => {
    e.preventDefault();
    try { await api("/api/listings", { method: "POST", body: new FormData(e.currentTarget) }); toast("Đăng tài liệu thành công!"); setPage("profile"); }
    catch (err) { toast(err.message); }
  };
}
function openEditListing(item) {
  const el = openModal("Chỉnh sửa tài liệu", `<form id="editForm"><div class="form-grid">
    <div class="form-group full"><label>Ảnh mới (không bắt buộc)</label><label class="upload-box" for="coverFile"><span class="upload-icon">↥</span><b>Nhấn để thay ảnh</b><small>JPG, PNG, WEBP hoặc GIF · Tối đa 5 MB</small><img id="uploadPreview" class="upload-preview" alt=""><input id="coverFile" name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label></div>
    ${listingFields(item)}</div><div class="form-actions"><button type="button" class="btn btn-light" data-act="close">Hủy</button><button class="btn btn-primary">Lưu thay đổi</button></div></form>`, true);
  bindUploadPreview($("#coverFile", el));
  $("#editForm", el).onsubmit = async e => {
    e.preventDefault();
    try { await api("/api/listings/" + item.id, { method: "PATCH", body: new FormData(e.currentTarget) }); toast("Đã cập nhật tài liệu."); closeModal(); renderProfile(); }
    catch (err) { toast(err.message); }
  };
}

/* ---------- Nhu cầu tìm tài liệu ---------- */
async function renderRequests() {
  const me = state.me;
  $("#app").innerHTML = `<section class="page-shell"><div class="page-head"><div><div class="eyebrow">KẾT NỐI NHU CẦU</div><h1>Bạn đang tìm cuốn nào?</h1><p>Đăng nhu cầu để cộng đồng biết chính xác tài liệu bạn cần. Khi có tài liệu phù hợp, bạn sẽ nhận thông báo.</p></div></div><div class="form-layout">
  ${me ? `<form class="form-card" id="requestForm"><h2>Đăng nhu cầu tìm tài liệu</h2><p class="subtext">Mô tả cụ thể để người đang sở hữu dễ nhận ra.</p><div class="form-group"><label>Tên tài liệu cần tìm *</label><input class="field" name="title" required maxlength="200" placeholder="VD: Giáo trình Thông tin số"></div><div class="form-group"><label>Môn học</label><input class="field" name="course" maxlength="150" placeholder="Tên môn học"></div><div class="form-group"><label>Hình thức mong muốn</label><select class="select-field" name="mode"><option>Mua / Trao đổi</option><option>Mua</option><option>Mượn</option><option>Xin tặng</option></select></div><div class="form-group"><label>Ghi chú</label><textarea class="text-field" name="note" maxlength="1000" placeholder="Tình trạng mong muốn, thời gian cần, điểm hẹn…"></textarea></div><button class="btn btn-primary">Đăng nhu cầu <span>↗</span></button></form>`
  : `<div class="form-card"><h2>Đăng nhu cầu tìm tài liệu</h2><p class="subtext">Bạn cần đăng nhập để đăng nhu cầu.</p><button class="btn btn-primary" data-page="auth">Đăng nhập</button></div>`}
  <aside><div class="side-card"><h3>Gợi ý để tìm nhanh hơn</h3><ul><li>Ghi đúng tên sách hoặc mã môn học.</li><li>Nêu rõ bạn muốn mua, mượn hay trao đổi.</li><li>Không đưa thông tin liên lạc riêng tư lên bài công khai.</li></ul></div></aside></div>
  <div style="margin-top:35px"><div class="section-heading" style="margin-bottom:20px"><div><div class="eyebrow">NHU CẦU CỘNG ĐỒNG</div><h2>Những người đang tìm sách</h2></div></div><div class="request-list" id="requestList">Đang tải…</div></div></section>`;
  const f = $("#requestForm");
  if (f) f.onsubmit = async e => { e.preventDefault(); try { await api("/api/requests", { method: "POST", body: Object.fromEntries(new FormData(e.currentTarget).entries()) }); toast("Đã đăng nhu cầu."); renderRequests(); refreshUnread(); } catch (err) { toast(err.message); } };
  try {
    const items = await api("/api/requests");
    if (!$("#requestList")) return;
    $("#requestList").innerHTML = items.map(r => `<article class="request-card"><div class="request-symbol">⌕</div><div class="request-main"><h3>${esc(r.title)}</h3><p>${esc(r.course)} · ${esc(r.mode)}<br>${esc(r.note || "Chưa có ghi chú")}</p></div><div class="request-user">${esc(r.user_name)}<br><span class="status-badge">${esc(r.status)}</span>
      <div class="row-actions" style="justify-content:flex-end;margin-top:8px"><button class="btn btn-light btn-small" data-act="recommend" data-text="${esc(r.title + " " + r.course)}">Gợi ý tài liệu</button>${me && me.id === r.user_id ? `<button class="btn btn-light btn-small" data-act="close-request" data-id="${r.id}">Đóng</button>` : ""}</div></div></article>`).join("") || empty("Chưa có nhu cầu", "Hãy đăng nhu cầu đầu tiên.", "");
  } catch (e) { toast(e.message); }
}

/* ---------- Trợ lý AI gợi ý ---------- */
function renderAssistant() {
  $("#app").innerHTML = `<section class="page-shell"><div class="page-head"><div><div class="eyebrow">TRỢ LÝ GỢI Ý</div><h1>Dán đề cương, nhận gợi ý sách.</h1><p>Nhập tên môn học hoặc dán nội dung đề cương, hệ thống sẽ tìm tài liệu đang có phù hợp nhất.</p></div></div>
  <div class="form-card"><textarea class="text-field" id="assistantText" style="min-height:140px" maxlength="6000" placeholder="VD: Môn Xử lý tín hiệu số — biến đổi Z, DFT/FFT, thiết kế bộ lọc FIR/IIR…">${esc(state.assistantText)}</textarea>
  <div class="form-actions" style="border:0;padding-top:12px"><span class="help-text" style="margin-right:auto">${state.meta.ai ? "AI sẽ trích từ khóa môn học/giáo trình từ nội dung bạn dán." : "AI chưa bật trên máy chủ — hệ thống so khớp từ khóa trực tiếp với tài liệu hiện có."}</span><button class="btn btn-primary" id="runRecommend">Gợi ý tài liệu ↗</button></div></div>
  <div id="assistantResult" style="margin-top:28px"></div></section>`;
  $("#runRecommend").onclick = runRecommend;
  if (state.assistantText) runRecommend();
}
async function runRecommend() {
  state.assistantText = $("#assistantText").value.trim();
  const box = $("#assistantResult"); box.innerHTML = "Đang tìm…";
  try {
    const r = await api("/api/ai/recommend", { method: "POST", body: { text: state.assistantText } });
    box.innerHTML = `<div class="eyebrow">${r.ai ? "AI ĐÃ TRÍCH TỪ KHÓA" : "TỪ KHÓA TỰ ĐỘNG"}</div><div class="chips">${r.keywords.map(k => `<span class="chip">${esc(k)}</span>`).join("") || "—"}</div>
      <div class="listing-grid">${r.results.map(x => card(x, `<p class="help-text">Khớp: ${esc(x.matched.join(", ") || "cụm từ khóa")}</p>`)).join("") || empty("Chưa có tài liệu khớp", "Hãy đăng nhu cầu để được báo khi có người đăng sách phù hợp.")}</div>`;
  } catch (e) { box.innerHTML = ""; toast(e.message); }
}

/* ---------- Trao đổi, hẹn gặp, đánh giá, lịch sử ---------- */
const OPEN_STATUS = ["Chờ phản hồi", "Đã chấp nhận"];
const badgeClass = s => s === "Đã hoàn tất" || s === "Đã chấp nhận" || s === "Đã xác nhận" ? "ok" : s === "Đã từ chối" || s === "Đã hủy" ? "bad" : "";
async function renderExchanges() {
  try {
    const me = state.me, items = await api("/api/exchanges");
    const shown = items.filter(x => state.exTab === "active" ? OPEN_STATUS.includes(x.status) : !OPEN_STATUS.includes(x.status));
    const rows = shown.map(x => {
      const isOwner = x.owner_id === me.id, other = isOwner ? x.requester_name : x.owner_name, mt = x.meeting;
      const b = [];
      if (x.status === "Chờ phản hồi") {
        if (isOwner) b.push(`<button class="btn btn-primary btn-small" data-act="ex" data-status="Đã chấp nhận" data-id="${x.id}">Chấp nhận</button>`, `<button class="btn btn-light btn-small" data-act="ex" data-status="Đã từ chối" data-id="${x.id}">Từ chối</button>`);
        else b.push(`<button class="btn btn-danger btn-small" data-act="ex" data-status="Đã hủy" data-id="${x.id}">Hủy yêu cầu</button>`);
      }
      if (x.status === "Đã chấp nhận") {
        b.push(`<button class="btn btn-light btn-small" data-act="meet" data-id="${x.id}">📅 Hẹn gặp</button>`);
        if (isOwner) b.push(`<button class="btn btn-primary btn-small" data-act="ex" data-status="Đã hoàn tất" data-id="${x.id}">Xác nhận hoàn tất</button>`);
      }
      if (OPEN_STATUS.includes(x.status) || x.status === "Đã hoàn tất") b.push(`<button class="btn btn-light btn-small" data-act="chat" data-listing="${x.listing_id}">Nhắn tin</button>`);
      if (x.status === "Đã hoàn tất") b.push(x.reviewed ? `<span class="status-badge muted">Đã đánh giá</span>` : `<button class="btn btn-primary btn-small" data-act="review" data-id="${x.id}" data-other="${esc(other)}">★ Đánh giá</button>`);
      let meet = "";
      if (mt) {
        meet = `<div class="meet-line">📅 ${esc(fmt(mt.meeting_time))} · ${esc(mt.location_name)} · <b>${esc(mt.status)}</b>`;
        if (x.status === "Đã chấp nhận" && mt.status === "Chờ xác nhận" && mt.created_by !== me.id) meet += ` <button class="btn btn-primary btn-small" data-act="meeting" data-status="Đã xác nhận" data-id="${mt.id}">Xác nhận</button>`;
        if (x.status === "Đã chấp nhận") meet += ` <button class="btn btn-light btn-small" data-act="meeting" data-status="Đã hủy" data-id="${mt.id}">Hủy lịch</button>`;
        meet += `</div>`;
      }
      return `<article class="request-card"><div class="request-symbol">⇄</div><div class="request-main"><h3>${esc(x.listing_title)}</h3><p>${isOwner ? "Người yêu cầu" : "Người đăng"}: ${esc(other)} · ${esc(fmt(x.created_at))}<br>${esc(x.message || "Không có lời nhắn kèm theo")}</p>${x.counterpart_phone ? `<div class="phone-line">📞 ${esc(x.counterpart_phone)} (đối tác đã cho phép hiển thị)</div>` : ""}${meet}</div>
        <div class="request-user"><span class="status-badge ${badgeClass(x.status)}">${esc(x.status)}</span><div class="row-actions" style="margin-top:10px;justify-content:flex-end">${b.join("")}</div></div></article>`;
    }).join("");
    paint("exchanges", `<section class="page-shell"><div class="page-head"><div><div class="eyebrow">THEO DÕI YÊU CẦU</div><h1>Trao đổi tài liệu.</h1><p>Quản lý yêu cầu đã gửi, yêu cầu nhận được và xem lại lịch sử giao dịch.</p></div><button class="btn btn-light" data-page="catalog">Khám phá tài liệu ↗</button></div>
      <div class="tabs"><button class="tab ${state.exTab === "active" ? "active" : ""}" data-act="extab" data-tab="active">Đang xử lý (${items.filter(x => OPEN_STATUS.includes(x.status)).length})</button><button class="tab ${state.exTab === "history" ? "active" : ""}" data-act="extab" data-tab="history">Lịch sử (${items.filter(x => !OPEN_STATUS.includes(x.status)).length})</button></div>
      <div class="request-list">${rows || `<div class="empty-state"><div class="empty-icon">⇄</div><h3>${state.exTab === "active" ? "Chưa có yêu cầu đang xử lý" : "Chưa có giao dịch nào trong lịch sử"}</h3><p>Mở một tài liệu và nhấn “Gửi yêu cầu” để bắt đầu.</p><button class="btn btn-primary" data-page="catalog">Tìm tài liệu</button></div>`}</div>
      <p class="warning-note">Số điện thoại của đối tác chỉ hiện sau khi yêu cầu được chấp nhận và họ cho phép hiển thị. Hãy hẹn gặp ở nơi công cộng trong trường.</p></section>`);
  } catch (e) { toast(e.message); }
}
function openMeetingModal(exId) {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const el = openModal("Đề xuất lịch hẹn", `<form id="meetForm"><div class="form-group"><label>Thời gian *</label><input class="field" type="datetime-local" name="meeting_time" min="${now}" required></div>
    <div class="form-group"><label>Địa điểm *</label><input class="field" name="location_name" list="locList" required maxlength="255" value="${esc(state.meta.locations[0] || "")}"><datalist id="locList">${state.meta.locations.map(l => `<option value="${esc(l)}">`).join("")}</datalist></div>
    <p class="help-text">Người còn lại sẽ nhận thông báo để xác nhận lịch hẹn.</p><div class="form-actions"><button type="button" class="btn btn-light" data-act="close">Hủy</button><button class="btn btn-primary">Gửi đề xuất</button></div></form>`);
  $("#meetForm", el).onsubmit = async e => {
    e.preventDefault();
    try { await api(`/api/exchanges/${exId}/meetings`, { method: "POST", body: Object.fromEntries(new FormData(e.currentTarget).entries()) }); toast("Đã gửi đề xuất lịch hẹn."); closeModal(); renderExchanges(); }
    catch (err) { toast(err.message); }
  };
}
function openReviewModal(exId, who) {
  let stars = 5;
  const el = openModal("Đánh giá giao dịch", `<p style="font-size:11px;color:#7f8d82">Bạn đánh giá <b>${esc(who)}</b> sau giao dịch này.</p><div class="star-picker" id="starPicker">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-star="${i}" class="on">★</button>`).join("")}</div>
    <div class="form-group"><label>Nhận xét (không bắt buộc)</label><textarea class="text-field" id="reviewComment" maxlength="500"></textarea></div><div class="form-actions"><button type="button" class="btn btn-light" data-act="close">Hủy</button><button class="btn btn-primary" id="sendReview">Gửi đánh giá</button></div>`);
  $("#starPicker", el).addEventListener("click", e => {
    const b = e.target.closest("[data-star]"); if (!b) return; stars = Number(b.dataset.star);
    $$("#starPicker button", el).forEach(x => x.classList.toggle("on", Number(x.dataset.star) <= stars));
  });
  $("#sendReview", el).onclick = async () => {
    try { await api("/api/reviews", { method: "POST", body: { exchange_id: exId, stars, comment: $("#reviewComment", el).value } }); toast("Cảm ơn bạn đã đánh giá!"); closeModal(); renderExchanges(); }
    catch (err) { toast(err.message); }
  };
}

/* ---------- Tin nhắn ---------- */
function renderMessages() {
  $("#app").innerHTML = `<section class="page-shell"><div class="page-head"><div><div class="eyebrow">KẾT NỐI TRỰC TIẾP</div><h1>Cuộc trò chuyện.</h1><p>Trao đổi về tình trạng sách và thống nhất điểm hẹn. Tin nhắn mới hiện ngay, không cần tải lại trang.</p></div></div>
  <div class="messages-layout"><aside class="conversation-list"><h3>Tin nhắn gần đây</h3><div id="convList">Đang tải…</div></aside>
  <section class="chat-panel"><div class="chat-head" id="chatHead"><b>Chưa chọn cuộc trò chuyện</b></div><div class="chat-messages" id="chatMessages"></div>
  <form class="chat-compose" id="chatForm"><input id="chatInput" placeholder="Nhắn tin về tài liệu, giờ hẹn…" autocomplete="off" maxlength="2000"><button class="btn btn-primary">Gửi ↗</button></form></section></div>
  <p class="warning-note">Không chia sẻ mật khẩu hay thông tin tài chính trong tin nhắn. Hãy hẹn gặp ở nơi công cộng.</p></section>`;
  $("#chatForm").onsubmit = async e => {
    e.preventDefault(); const content = $("#chatInput").value.trim(); if (!content || !state.conversation) return;
    try { await api(`/api/messages/${encodeURIComponent(state.conversation)}`, { method: "POST", body: { content } }); $("#chatInput").value = ""; loadMessages(); loadConversations(); }
    catch (err) { toast(err.message); }
  };
  loadConversations(true);
}
async function loadConversations(first) {
  try {
    const list = await api("/api/conversations");
    if (!$("#convList")) return;
    if (!list.length) { $("#convList").innerHTML = `<p class="help-text">Chưa có cuộc trò chuyện. Mở một tài liệu và nhấn “Nhắn tin”.</p>`; $("#chatForm").style.display = "none"; return; }
    if (!state.conversation || !list.some(c => c.key === state.conversation)) state.conversation = list[0].key;
    $("#convList").innerHTML = list.map(c => `<div class="conversation-item ${c.key === state.conversation ? "active" : ""}" data-act="conv" data-key="${esc(c.key)}"><span class="owner-avatar">${esc(initials(c.counterpart_name))}</span><div><b>${esc(c.counterpart_name)}</b><small>${esc(c.listing_title || "Trò chuyện")}${c.last_message ? " · " + esc(c.last_message.slice(0, 24)) : ""}</small></div>${c.unread ? `<span class="conv-unread">${c.unread}</span>` : ""}</div>`).join("");
    const cur = list.find(c => c.key === state.conversation);
    $("#chatHead").innerHTML = `<span class="owner-avatar">${esc(initials(cur.counterpart_name))}</span><div><b>${esc(cur.counterpart_name)}</b><small>${esc(cur.listing_title || "Đang trao đổi về tài liệu")}</small></div>`;
    $("#chatForm").style.display = "";
    if (first) loadMessages();
  } catch (e) { toast(e.message); }
}
async function loadMessages() {
  if (!state.conversation) return;
  try {
    const items = await api(`/api/messages/${encodeURIComponent(state.conversation)}`);
    const box = $("#chatMessages"); if (!box) return;
    box.innerHTML = items.map(m => `<div class="bubble ${m.sender_id === state.me.id ? "mine" : ""}">${esc(m.content)}<small>${esc(m.sender_name)} · ${esc(fmt(m.created_at))}</small></div>`).join("") || `<div class="empty-state">Chưa có tin nhắn.</div>`;
    box.scrollTop = box.scrollHeight; refreshUnread();
  } catch (e) { toast(e.message); }
}

/* ---------- Thông báo ---------- */
async function renderNotifications() {
  try {
    const items = await api("/api/notifications");
    if (!paint("notifications", `<section class="page-shell"><div class="page-head"><div><div class="eyebrow">CẬP NHẬT</div><h1>Thông báo.</h1><p>Yêu cầu trao đổi, lịch hẹn, đánh giá và gợi ý tài liệu phù hợp.</p></div></div>
      ${items.map(n => `<div class="notif ${n.is_read ? "" : "unread"}"><span class="request-symbol" style="width:34px;height:34px;font-size:15px">${{ exchange: "⇄", meeting: "📅", match: "✦", review: "★", report: "⚑", moderation: "⚠" }[n.type] || "•"}</span><div>${esc(n.text)}<small>${esc(fmt(n.created_at))}</small></div>${n.link ? `<a href="#" data-page="${esc(n.link)}">Mở ↗</a>` : ""}</div>`).join("") || empty("Chưa có thông báo", "Các cập nhật mới sẽ xuất hiện tại đây.", "")}</section>`)) return;
    if (items.some(n => !n.is_read)) { await api("/api/notifications/read-all", { method: "POST" }); refreshUnread(); }
  } catch (e) { toast(e.message); }
}

/* ---------- Quản trị ---------- */
async function renderAdmin() {
  const tabs = [["reports", "Báo cáo"], ["users", "Người dùng"], ["listings", "Tin đăng"]];
  $("#app").innerHTML = `<section class="page-shell"><div class="page-head"><div><div class="eyebrow">ADMIN WORKSPACE</div><h1>Quản trị cộng đồng.</h1><p>Xử lý báo cáo vi phạm, kiểm duyệt tin đăng và quản lý tài khoản.</p></div></div><div class="admin-stats" id="adminStats"></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${state.adminTab === k ? "active" : ""}" data-act="admintab" data-tab="${k}">${l}</button>`).join("")}</div><div class="admin-panel table-wrap" id="adminBody">Đang tải…</div></section>`;
  try {
    const d = await api("/api/admin/summary");
    if (!$("#adminStats")) return;
    $("#adminStats").innerHTML = [["Người dùng", d.users], ["Tin đang hiển thị", d.listings], ["Yêu cầu trao đổi", d.exchanges], ["Báo cáo chờ", d.pendingReports]].map(x => `<div class="admin-stat"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join("");
    const body = $("#adminBody");
    if (state.adminTab === "reports") {
      body.innerHTML = d.reports.length ? `<table class="admin-table"><thead><tr><th>#</th><th>Tài liệu</th><th>Người báo cáo</th><th>Lý do</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${d.reports.map(r => `<tr><td>${r.id}</td><td>${esc(r.listing_title || "—")}${r.listing_status && r.listing_status !== "Đang tìm chủ mới" ? ` <span class="status-badge muted">${esc(r.listing_status)}</span>` : ""}</td><td>${esc(r.reporter_name)}</td><td>${esc(r.reason)}</td><td><span class="status-badge ${r.status === "Chờ xử lý" ? "" : "ok"}">${esc(r.status)}</span></td>
        <td>${r.status === "Chờ xử lý" ? `<div class="row-actions">${r.listing_id ? `<button class="btn btn-danger btn-small" data-act="report" data-do="remove" data-id="${r.id}">Gỡ bài</button>` : ""}<button class="btn btn-light btn-small" data-act="report" data-do="dismiss" data-id="${r.id}">Bác bỏ</button>${r.listing_id ? "" : `<button class="btn btn-light btn-small" data-act="report" data-do="resolve" data-id="${r.id}">Đã xử lý</button>`}</div>` : "—"}</td></tr>`).join("")}</tbody></table>` : empty("Chưa có báo cáo", "Các báo cáo do người dùng gửi sẽ xuất hiện tại đây.", "");
    } else if (state.adminTab === "users") {
      const users = await api("/api/admin/users");
      if (!$("#adminBody")) return;
      body.innerHTML = `<table class="admin-table"><thead><tr><th>#</th><th>Tên</th><th>Email</th><th>Vai trò</th><th>Tin đăng</th><th>Đánh giá</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${users.map(u => `<tr><td>${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${u.listing_count}</td><td>★ ${Number(u.rating).toFixed(1)} (${u.review_count})</td><td><span class="status-badge ${u.status === "active" ? "ok" : "bad"}">${u.status === "active" ? "Hoạt động" : "Đã khóa"}</span></td>
        <td>${u.role === "admin" || u.id === state.me.id ? "—" : `<button class="btn ${u.status === "active" ? "btn-danger" : "btn-light"} btn-small" data-act="lock" data-id="${u.id}" data-status="${u.status === "active" ? "locked" : "active"}">${u.status === "active" ? "Khóa" : "Mở khóa"}</button>`}</td></tr>`).join("")}</tbody></table>`;
    } else {
      const ls = await api("/api/admin/listings");
      if (!$("#adminBody")) return;
      body.innerHTML = `<table class="admin-table"><thead><tr><th>#</th><th>Tài liệu</th><th>Người đăng</th><th>Hình thức</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${ls.map(l => `<tr><td>${l.id}</td><td>${esc(l.title)}</td><td>${esc(l.owner_name)}</td><td>${esc(l.mode)}</td><td><span class="status-badge ${l.status === "Đang tìm chủ mới" ? "ok" : l.status === "Đã gỡ" ? "bad" : "muted"}">${esc(l.status)}</span></td>
        <td><div class="row-actions">${l.status === "Đã gỡ" || l.status === "Đã ẩn" ? `<button class="btn btn-light btn-small" data-act="modlisting" data-id="${l.id}" data-status="Đang tìm chủ mới">Khôi phục</button>` : ""}${l.status !== "Đã gỡ" ? `<button class="btn btn-danger btn-small" data-act="modlisting" data-id="${l.id}" data-status="Đã gỡ">Gỡ bài</button>` : ""}</div></td></tr>`).join("")}</tbody></table>`;
    }
  } catch (e) { if ($("#adminBody")) $("#adminBody").textContent = e.message; }
}

/* ---------- Hồ sơ ---------- */
async function renderProfile() {
  try {
    const me = state.me = await api("/api/me");
    const [mine, rv] = await Promise.all([api("/api/listings?mine=1"), api(`/api/users/${me.id}/reviews`)]);
    const actions = x => `<div class="card-actions"><button class="btn btn-light btn-small" data-act="edit" data-id="${x.id}">Sửa</button>${x.status === "Đã gỡ" ? "" : `<button class="btn btn-light btn-small" data-act="toggle" data-id="${x.id}" data-status="${x.status === "Đã ẩn" ? "Đang tìm chủ mới" : "Đã ẩn"}">${x.status === "Đã ẩn" ? "Hiện lại" : "Ẩn"}</button>`}<button class="btn btn-danger btn-small" data-act="delete" data-id="${x.id}">Xóa</button></div>`;
    window.__mine = mine;
    if (!paint("profile", `<section class="page-shell"><div class="page-head"><div><div class="eyebrow">HỒ SƠ CỘNG ĐỒNG</div><h1>Tài khoản của bạn.</h1><p>Quản lý thông tin cá nhân, tài liệu đã đăng và đánh giá nhận được.</p></div></div>
    <div class="profile-card"><div class="profile-big">${esc(initials(me.name))}</div><div class="profile-info"><h2>${esc(me.name)}</h2><p>${esc(me.email)} · ${esc(me.faculty)}${me.student_code ? " · MSSV " + esc(me.student_code) : ""}</p><div class="profile-rating">★ ${Number(me.rating).toFixed(1)} <span style="color:#8a978d">· ${me.review_count} đánh giá</span></div></div><div class="profile-actions"><button class="btn btn-light" data-page="messages">Tin nhắn</button><button class="btn btn-primary" data-page="post">＋ Đăng tài liệu</button></div></div>
    <div class="form-layout"><form class="form-card" id="profileForm"><h2>Thông tin cá nhân</h2><p class="subtext">Số điện thoại chỉ hiển thị cho đối tác sau khi yêu cầu trao đổi được chấp nhận và khi bạn bỏ chọn “Ẩn số điện thoại”.</p><div class="form-grid">
      <div class="form-group"><label>Họ tên *</label><input class="field" name="name" required maxlength="100" value="${esc(me.name)}"></div><div class="form-group"><label>Khoa / Trường</label><input class="field" name="faculty" maxlength="100" value="${esc(me.faculty)}"></div>
      <div class="form-group"><label>Mã sinh viên</label><input class="field" name="student_code" maxlength="20" value="${esc(me.student_code)}"></div><div class="form-group"><label>Số điện thoại</label><input class="field" name="phone" maxlength="20" value="${esc(me.phone)}" placeholder="09xx xxx xxx"></div>
      <div class="form-group full"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="phone_hidden" ${me.phone_hidden ? "checked" : ""}> Ẩn số điện thoại (khuyến nghị)</label></div></div><div class="form-actions"><button class="btn btn-primary">Lưu thông tin</button></div></form>
      <aside><form class="form-card" id="pwForm"><h2>Đổi mật khẩu</h2><div class="form-group"><label>Mật khẩu hiện tại</label><input class="field" type="password" name="current" required autocomplete="current-password"></div><div class="form-group"><label>Mật khẩu mới (≥ 8 ký tự)</label><input class="field" type="password" name="next" required minlength="8" autocomplete="new-password"></div><button class="btn btn-light">Cập nhật mật khẩu</button></form></aside></div>
    <div class="section-heading" style="margin:34px 0 20px"><div><div class="eyebrow">BỘ SƯU TẬP CỦA BẠN</div><h2>Tài liệu đã đăng (${mine.length})</h2></div></div><div class="listing-grid">${mine.map(x => card(x, actions(x))).join("") || empty("Bạn chưa đăng tài liệu", "Bắt đầu chia sẻ tài liệu với cộng đồng.", `<button class="btn btn-primary btn-small" data-page="post">Đăng tài liệu</button>`)}</div>
    <div class="section-heading" style="margin:34px 0 14px"><div><div class="eyebrow">UY TÍN</div><h2>Đánh giá nhận được</h2></div></div><div class="admin-panel">${rv.reviews.map(r => `<div class="review-item">${starsHtml(r.stars)} <b>${esc(r.reviewer_name)}</b> <small>· ${esc(fmt(r.created_at))}</small><br>${esc(r.comment || "Không có nhận xét")}</div>`).join("") || `<p class="help-text">Chưa có đánh giá nào.</p>`}</div></section>`)) return;
    $("#profileForm").onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      try { state.me = await api("/api/me", { method: "PATCH", body: { name: fd.get("name"), faculty: fd.get("faculty"), student_code: fd.get("student_code"), phone: fd.get("phone"), phone_hidden: fd.get("phone_hidden") === "on" } }); renderAuthArea(); toast("Đã lưu thông tin cá nhân."); renderProfile(); }
      catch (err) { toast(err.message); }
    };
    $("#pwForm").onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      try { await api("/api/me/password", { method: "POST", body: { current: fd.get("current"), next: fd.get("next") } }); toast("Đã đổi mật khẩu."); e.currentTarget.reset(); }
      catch (err) { toast(err.message); }
    };
  } catch (e) { toast(e.message); }
}

/* ---------- Đăng nhập / đăng ký / xác thực ---------- */
async function renderAuth() {
  const t = state.authTab, demo = state.meta.demo;
  let demoBox = "";
  if (demo && t === "login") {
    try {
      const d = await api("/api/auth/demo-accounts");
      if (d.accounts.length) demoBox = `<div class="demo-box"><b>Tài khoản demo</b> (mật khẩu: <code>${esc(d.password)}</code>) — bấm để điền:<br>${d.accounts.map(a => `<button type="button" data-act="fill-demo" data-email="${esc(a.email)}" data-pw="${esc(d.password)}">${esc(a.name)}${a.role === "admin" ? " · admin" : ""}</button>`).join("")}</div>`;
    } catch { /* bỏ qua */ }
  }
  const verify = t === "verify";
  if (!paint("auth", `<section class="page-shell"><div class="auth-wrap"><div class="auth-card">
    ${verify ? `<h2>Xác thực email</h2><p class="subtext" style="font-size:11px;color:#8b978e">Nhập mã 6 số đã gửi tới <b>${esc(state.pendingEmail)}</b>.</p>
      ${state.demoCode ? `<div class="demo-box">Chế độ demo: mã của bạn là <b>${esc(state.demoCode)}</b> <button type="button" data-act="fill-code">Điền mã</button></div>` : ""}
      <form id="verifyForm" style="margin-top:14px"><div class="form-group"><label>Mã xác thực</label><input class="field" name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code" value=""></div><button class="btn btn-primary" style="width:100%">Xác nhận</button></form>
      <p class="help-text" style="margin-top:12px"><a href="#" data-act="resend" style="text-decoration:underline">Gửi lại mã</a> · <a href="#" data-act="authtab" data-tab="login" style="text-decoration:underline">Quay lại đăng nhập</a></p>`
    : `<div class="tabs"><button class="tab ${t === "login" ? "active" : ""}" data-act="authtab" data-tab="login">Đăng nhập</button><button class="tab ${t === "register" ? "active" : ""}" data-act="authtab" data-tab="register">Đăng ký</button></div>
      ${t === "login" ? `<h2>Chào mừng trở lại</h2><form id="loginForm" style="margin-top:14px"><div class="form-group"><label>Email sinh viên</label><input class="field" type="email" name="email" required autocomplete="username"></div><div class="form-group"><label>Mật khẩu</label><input class="field" type="password" name="password" required autocomplete="current-password"></div><button class="btn btn-primary" style="width:100%">Đăng nhập ↗</button></form>${demoBox}`
      : `<h2>Tạo tài khoản</h2><p class="help-text">Chỉ chấp nhận email sinh viên: ${state.meta.emailDomains.map(d => "@" + esc(d)).join(", ")}</p><form id="regForm" style="margin-top:10px"><div class="form-group"><label>Họ tên *</label><input class="field" name="name" required maxlength="100"></div><div class="form-group"><label>Email sinh viên *</label><input class="field" type="email" name="email" required autocomplete="username"></div><div class="inline-grid"><div class="form-group"><label>Mã sinh viên</label><input class="field" name="student_code" maxlength="20"></div><div class="form-group"><label>Khoa / Trường</label><input class="field" name="faculty" maxlength="100"></div></div><div class="form-group"><label>Mật khẩu (≥ 8 ký tự) *</label><input class="field" type="password" name="password" required minlength="8" autocomplete="new-password"></div><button class="btn btn-primary" style="width:100%">Đăng ký ↗</button></form>`}`}
    </div></div></section>`)) return;
  const done = d => { setSession(d.token, d.user); toast(`Xin chào ${d.user.name}!`); const go = state.after || "home"; state.after = ""; setPage(go); };
  const lf = $("#loginForm");
  if (lf) lf.onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(lf);
    try { done(await api("/api/auth/login", { method: "POST", body: { email: fd.get("email"), password: fd.get("password") } })); }
    catch (err) {
      if (err.data && err.data.needs_verification) { state.pendingEmail = err.data.email; state.authTab = "verify"; try { const r = await api("/api/auth/resend", { method: "POST", body: { email: err.data.email } }); state.demoCode = r.demo_code || ""; } catch { /* bỏ qua */ } renderAuth(); }
      else toast(err.message);
    }
  };
  const rf = $("#regForm");
  if (rf) rf.onsubmit = async e => {
    e.preventDefault(); const body = Object.fromEntries(new FormData(rf).entries());
    try { const r = await api("/api/auth/register", { method: "POST", body }); state.pendingEmail = r.email; state.demoCode = r.demo_code || ""; state.authTab = "verify"; renderAuth(); toast("Đã tạo tài khoản, hãy xác thực email."); }
    catch (err) { toast(err.message); }
  };
  const vf = $("#verifyForm");
  if (vf) vf.onsubmit = async e => {
    e.preventDefault();
    try { done(await api("/api/auth/verify", { method: "POST", body: { email: state.pendingEmail, code: new FormData(vf).get("code") } })); }
    catch (err) { toast(err.message); }
  };
}

/* ---------- Modal, chi tiết tài liệu ---------- */
function openModal(title, inner, wide = false) {
  $("#modalRoot").innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal" ${wide ? 'style="width:min(680px,100%)"' : ""}><div class="modal-head"><div><h2>${esc(title)}</h2></div><button class="modal-close" data-act="close">×</button></div><div style="margin-top:14px">${inner}</div></div></div>`;
  return $("#modalRoot");
}
function closeModal() { $("#modalRoot").innerHTML = ""; }
async function openDetail(id) {
  try {
    const p = state.geo ? `?lat=${state.geo.lat}&lng=${state.geo.lng}` : "";
    const x = await api(`/api/listings/${id}${p}`);
    const mine = state.me && state.me.id === x.user_id, avail = x.status === "Đang tìm chủ mới";
    $("#modalRoot").innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal"><div class="modal-head"><div><div class="eyebrow">CHI TIẾT TÀI LIỆU</div><h2>${esc(x.title)}</h2></div><button class="modal-close" data-act="close">×</button></div>
      <div class="modal-book"><div class="book-art">${coverLabel(x)}</div><div><div class="card-course">${esc(x.course)}</div><div class="card-title">${esc(x.title)}</div><div class="card-author">${esc(x.author || "Chưa rõ tác giả")}</div>
      <div class="card-meta"><span class="price ${Number(x.price) === 0 ? "free" : ""}">${money(x.price)}</span><span class="mode-tag ${modeClass(x.mode)}">${esc(x.mode)}</span></div>
      <p style="margin-top:15px">${esc(x.description || "Chưa có mô tả.")}</p><p>📍 ${esc(x.location)}${state.geo ? " · " + Number(x.distance).toFixed(1) + " km" : ""}<br>📘 Tình trạng: ${esc(x.condition)} · ${esc(x.category)}${avail ? "" : `<br><span class="status-badge bad">${esc(x.status)}</span>`}</p>
      <div class="modal-owner"><span class="owner-avatar">${esc(initials(x.owner_name))}</span><div><b>${esc(x.owner_name)}</b><small>★ ${Number(x.owner_rating).toFixed(1)} · ${x.owner_reviews} đánh giá · <a href="#" data-act="owner-reviews" data-id="${x.user_id}" style="text-decoration:underline">Xem</a></small></div></div>
      <div class="modal-actions">${mine ? `<span class="status-badge ok">Bài đăng của bạn</span>` : `${avail ? `<button class="btn btn-primary" data-act="request-exchange" data-id="${x.id}">Gửi yêu cầu ↗</button>` : ""}<button class="btn btn-light" data-act="chat" data-listing="${x.id}">Nhắn tin</button><button class="btn btn-light" data-act="report-listing" data-id="${x.id}">Báo cáo</button>`}</div>
      <div class="warning-note">Hẹn gặp tại nơi công cộng. Hình thức và chi phí (nếu có) do hai bên tự thỏa thuận trực tiếp.</div></div></div></div></div>`;
  } catch (e) { toast(e.message); }
}
function openRequestModal(id) {
  if (needLogin("Vui lòng đăng nhập để gửi yêu cầu.")) return;
  const el = openModal("Gửi yêu cầu trao đổi", `<div class="form-group"><label>Lời nhắn cho người đăng</label><textarea class="text-field" id="reqMsg" maxlength="500">Mình quan tâm tài liệu này, bạn cho mình xin thêm thông tin nhé.</textarea></div><div class="form-actions"><button class="btn btn-light" data-act="close">Hủy</button><button class="btn btn-primary" id="sendReq">Gửi yêu cầu</button></div>`);
  $("#sendReq", el).onclick = async () => {
    try { await api("/api/exchanges", { method: "POST", body: { listing_id: Number(id), message: $("#reqMsg", el).value } }); toast("Đã gửi yêu cầu trao đổi."); closeModal(); }
    catch (e) { toast(e.message); }
  };
}
function openReportModal(id) {
  if (needLogin("Vui lòng đăng nhập để báo cáo.")) return;
  const el = openModal("Báo cáo bài đăng", `<div class="form-group"><label>Lý do báo cáo *</label><textarea class="text-field" id="reportReason" maxlength="500" placeholder="VD: Thông tin sai sự thật, nội dung không phù hợp…"></textarea></div><div class="form-actions"><button class="btn btn-light" data-act="close">Hủy</button><button class="btn btn-primary" id="sendReport">Gửi báo cáo</button></div>`);
  $("#sendReport", el).onclick = async () => {
    try { await api("/api/reports", { method: "POST", body: { listing_id: Number(id), reason: $("#reportReason", el).value } }); toast("Đã gửi báo cáo cho quản trị viên."); closeModal(); }
    catch (e) { toast(e.message); }
  };
}
async function openOwnerReviews(uid) {
  try {
    const d = await api(`/api/users/${uid}/reviews`);
    openModal(`Đánh giá về ${d.user.name}`, `<p>★ <b>${Number(d.user.rating).toFixed(1)}</b> · ${d.user.review_count} đánh giá</p>${d.reviews.map(r => `<div class="review-item">${starsHtml(r.stars)} <b>${esc(r.reviewer_name)}</b> <small>· ${esc(fmt(r.created_at))}</small><br>${esc(r.comment || "Không có nhận xét")}</div>`).join("") || `<p class="help-text">Chưa có đánh giá nào.</p>`}`);
  } catch (e) { toast(e.message); }
}

/* ---------- Xử lý click tập trung ---------- */
const act = {
  close: () => closeModal(),
  logout: async () => { try { await api("/api/auth/logout", { method: "POST" }); } catch { /* bỏ qua */ } clearSession(); toast("Đã đăng xuất."); setPage("home"); },
  authtab: t => { state.authTab = t.dataset.tab; renderAuth(); },
  "fill-demo": t => { const f = $("#loginForm"); f.email.value = t.dataset.email; f.password.value = t.dataset.pw; },
  "fill-code": () => { const f = $("#verifyForm"); if (f) f.code.value = state.demoCode; },
  resend: async () => { try { const r = await api("/api/auth/resend", { method: "POST", body: { email: state.pendingEmail } }); state.demoCode = r.demo_code || ""; renderAuth(); toast("Đã gửi lại mã."); } catch (e) { toast(e.message); } },
  "request-exchange": t => openRequestModal(t.dataset.id),
  "report-listing": t => openReportModal(t.dataset.id),
  "owner-reviews": t => openOwnerReviews(t.dataset.id),
  chat: async t => {
    if (needLogin("Vui lòng đăng nhập để nhắn tin.")) return;
    try { const r = await api("/api/conversations", { method: "POST", body: { listing_id: Number(t.dataset.listing) } }); state.conversation = r.key; closeModal(); setPage("messages"); } catch (e) { toast(e.message); }
  },
  conv: t => { state.conversation = t.dataset.key; loadConversations(true); },
  extab: t => { state.exTab = t.dataset.tab; renderExchanges(); },
  ex: async t => {
    try { await api("/api/exchanges/" + t.dataset.id, { method: "PATCH", body: { status: t.dataset.status } }); toast("Đã cập nhật: " + t.dataset.status.toLowerCase() + "."); renderExchanges(); }
    catch (e) { toast(e.message); renderExchanges(); }
  },
  meet: t => openMeetingModal(t.dataset.id),
  meeting: async t => { try { await api("/api/meetings/" + t.dataset.id, { method: "PATCH", body: { status: t.dataset.status } }); toast("Đã cập nhật lịch hẹn."); renderExchanges(); } catch (e) { toast(e.message); } },
  review: t => openReviewModal(Number(t.dataset.id), t.dataset.other),
  recommend: t => { state.assistantText = t.dataset.text.trim(); setPage("assistant"); },
  "close-request": async t => { try { await api("/api/requests/" + t.dataset.id, { method: "PATCH", body: { status: "Đã đóng" } }); toast("Đã đóng nhu cầu."); renderRequests(); } catch (e) { toast(e.message); } },
  admintab: t => { state.adminTab = t.dataset.tab; renderAdmin(); },
  report: async t => { try { await api("/api/admin/reports/" + t.dataset.id, { method: "PATCH", body: { action: t.dataset.do } }); toast("Đã xử lý báo cáo."); renderAdmin(); } catch (e) { toast(e.message); } },
  lock: async t => { try { await api("/api/admin/users/" + t.dataset.id, { method: "PATCH", body: { status: t.dataset.status } }); toast(t.dataset.status === "locked" ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản."); renderAdmin(); } catch (e) { toast(e.message); } },
  modlisting: async t => { try { await api("/api/admin/listings/" + t.dataset.id, { method: "PATCH", body: { status: t.dataset.status } }); toast("Đã cập nhật tin đăng."); renderAdmin(); } catch (e) { toast(e.message); } },
  edit: t => { const item = (window.__mine || []).find(x => x.id === Number(t.dataset.id)); if (item) openEditListing(item); },
  toggle: async t => { try { const fd = new FormData(); fd.append("status", t.dataset.status); await api("/api/listings/" + t.dataset.id, { method: "PATCH", body: fd }); toast("Đã cập nhật trạng thái."); renderProfile(); } catch (e) { toast(e.message); } },
  delete: async t => { if (!confirm("Xóa bài đăng này? Thao tác không thể hoàn tác.")) return; try { await api("/api/listings/" + t.dataset.id, { method: "DELETE" }); toast("Đã xóa bài đăng."); renderProfile(); } catch (e) { toast(e.message); } }
};
document.addEventListener("click", e => {
  const a = e.target.closest("[data-act]");
  if (a && act[a.dataset.act]) { e.preventDefault(); act[a.dataset.act](a); return; }
  if (e.target.id === "modalBackdrop") { closeModal(); return; }
  const page = e.target.closest("[data-page]"); if (page) { e.preventDefault(); setPage(page.dataset.page); return; }
  const detail = e.target.closest("[data-detail]"); if (detail) { openDetail(detail.dataset.detail); return; }
  const save = e.target.closest("[data-save]"); if (save) { save.textContent = save.textContent === "♡" ? "♥" : "♡"; save.classList.toggle("saved", save.textContent === "♥"); save.classList.remove("pop"); void save.offsetWidth; save.classList.add("pop"); toast(save.textContent === "♥" ? "Đã lưu vào mục yêu thích (chỉ trên trình duyệt này)." : "Đã bỏ lưu."); return; }
  const mode = e.target.closest("[data-mode]:not(.pill)"); if (mode) { state.mode = mode.dataset.mode; setPage("catalog"); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
$("#themeBtn").onclick = () => { document.body.classList.toggle("dark-mode"); toast(document.body.classList.contains("dark-mode") ? "Đã bật giao diện tối." : "Đã bật giao diện sáng."); };

/* ---------- Khởi động ---------- */
(async function init() {
  try { state.meta = await api("/api/meta"); } catch { /* dùng mặc định */ }
  if (state.token) {
    try { state.me = await api("/api/me"); connectStream(); refreshUnread(); } catch { clearSession(); }
  }
  renderAuthArea();
  setPage("home");
})();
