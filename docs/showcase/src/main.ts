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

initNav();
initReveal();
initTree();
