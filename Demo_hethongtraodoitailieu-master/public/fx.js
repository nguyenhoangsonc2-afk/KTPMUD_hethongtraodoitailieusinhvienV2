/* Hiệu ứng giao diện: hiện dần khi cuộn, vào trang, đếm số, thanh tiến trình cuộn. Không ảnh hưởng logic ứng dụng. */
(() => {
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const bar = document.createElement("div"); bar.id = "scrollBar"; document.body.appendChild(bar);
  const onScroll = () => { const h = document.documentElement; const max = h.scrollHeight - h.clientHeight; bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + "%"; };
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
  if (reduce || !("IntersectionObserver" in window)) return;

  const SEL = ".book-card,.request-card,.admin-stat,.side-card,.form-card,.profile-card,.notif,.section-heading,.stats-row>div,.empty-state,.ai-banner,.admin-panel,.filter-panel,.messages-layout";
  const countUp = el => {
    if (el.dataset.anim) return;                      // đang chạy: bỏ qua các mutation do chính hiệu ứng tạo ra
    const raw = el.textContent.trim(), n = parseInt(raw.replace(/\D/g, ""), 10);
    if (!Number.isFinite(n) || n <= 0 || el.dataset.counted === raw) return;
    el.dataset.anim = "1"; const pad = raw.length > 1 && raw[0] === "0" ? raw.length : 0, t0 = performance.now(), dur = 900;
    const tick = t => {
      const p = Math.min(1, (t - t0) / dur), v = Math.round(n * (1 - Math.pow(1 - p, 3)));
      if (p < 1) { el.textContent = pad ? String(v).padStart(pad, "0") : String(v); requestAnimationFrame(tick); }
      else { el.textContent = raw; el.dataset.counted = raw; setTimeout(() => { delete el.dataset.anim; }, 50); }
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (!e.isIntersecting) return;
    const el = e.target; io.unobserve(el); el.classList.add("in");
    el.querySelectorAll(".stats-row strong,.admin-stat strong").forEach(countUp);
    setTimeout(() => el.classList.remove("reveal", "in"), 1100 + (parseInt(el.style.getPropertyValue("--d")) || 0));
  }), { threshold: .08, rootMargin: "0px 0px -40px 0px" });

  const register = root => {
    const list = root.matches && root.matches(SEL) ? [root] : [];
    root.querySelectorAll && list.push(...root.querySelectorAll(SEL));
    list.forEach(el => {
      if (el.dataset.fx || el.closest("#modalRoot")) return;
      el.dataset.fx = "1";
      const sibs = el.parentElement ? [...el.parentElement.children].filter(c => c.matches(SEL)) : [];
      el.style.setProperty("--d", Math.min(sibs.indexOf(el), 8) * 70 + "ms");
      el.classList.add("reveal"); io.observe(el);
    });
  };

  let lastPage = "";
  const app = document.getElementById("app");
  new MutationObserver(muts => {
    const pg = typeof state !== "undefined" ? state.page : "";
    const fresh = pg !== lastPage;
    muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (m.target === app && fresh) { [...app.children].forEach((c, i) => { if (c.matches(".hero,.ai-banner")) return; c.style.setProperty("--i", i); c.classList.add("page-in"); }); lastPage = pg; }
      register(n);
      if (n.matches && n.matches(".stats-row strong,.admin-stat strong")) countUp(n);
    }));
    if (fresh) lastPage = pg;
    // số liệu được cập nhật bằng textContent (ví dụ #statBooks)
    muts.forEach(m => { if (m.type === "childList" && m.target.matches && m.target.matches(".stats-row strong") && m.addedNodes.length) countUp(m.target); });
  }).observe(document.body, { childList: true, subtree: true });
  register(document.body);
})();
