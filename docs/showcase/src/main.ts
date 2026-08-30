import "./styles.css";

function initNav() {
  const toggle = document.querySelector<HTMLButtonElement>("[data-nav-toggle]");
  const menu = document.querySelector<HTMLElement>("[data-menu]");
  if (!toggle || !menu) return;

  const setOpen = (open: boolean) => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menu.classList.toggle("is-open", open);
    document.body.style.overflow = open ? "hidden" : "";
  };

  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  menu.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => setOpen(false));
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) setOpen(false);
  });
}

function initReveal() {
  const items = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
  );
  items.forEach((el) => io.observe(el));
}

function initTree() {
  document.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.parentElement;
      const group = row?.nextElementSibling;
      if (!row || !group || !group.classList.contains("tree-group")) return;
      const open = group.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", String(open));
    });
  });
}

function initHashScrollFix() {
  // FIX: opening https://.../#demo scrolls to bottom because #demo is near
  // the end of the page — that's correct browser anchor behavior, but if you
  // share the showcase URL with #demo, visitors land at the bottom and think
  // "site starts from bottom" is a bug. Also browsers restore previous scroll
  // position on reload.
  // We force start at top on full page load, and only scroll to hash when
  // user clicks a navigation link (handled by smooth css scroll).
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }
  // If URL has a hash on initial load, strip it and start at top.
  // Comment this block out if you WANT #demo to auto-scroll to demo section.
  if (window.location.hash) {
    // Keep hash in history but don't jump to it
    const cleanUrl = window.location.pathname + window.location.search;
    history.replaceState(null, "", cleanUrl);
  }
  window.scrollTo(0, 0);
  // Also guard against browser late hash jump after assets load
  window.addEventListener("load", () => {
    window.scrollTo(0, 0);
  });
}

initNav();
initReveal();
initTree();
initHashScrollFix();
