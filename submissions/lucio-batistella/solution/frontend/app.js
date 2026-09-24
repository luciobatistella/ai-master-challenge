(function () {
  "use strict";

  const PAGE_SIZE = 30;
  const DESKTOP_QUERY = "(min-width: 720px)";
  const ICON_SUN =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line><line x1="4" y1="12" x2="2" y2="12"></line><line x1="22" y1="12" x2="20" y2="12"></line><line x1="5" y1="5" x2="6.5" y2="6.5"></line><line x1="17.5" y1="17.5" x2="19" y2="19"></line><line x1="5" y1="19" x2="6.5" y2="17.5"></line><line x1="17.5" y1="6.5" x2="19" y2="5"></line></svg>';
  const ICON_MOON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"></path></svg>';

  let ALL_DEALS = [];
  let visibleCount = PAGE_SIZE;
  let aiEndpointAvailable = null;

  const state = {
    search: "",
    stage: "all",
    region: "all",
    manager: "all",
    agent: "all",
  };
  const draft = { stage: "all", region: "all", manager: "all", agent: "all" };
  // Dashboard é o padrão nos dois breakpoints — Kanban continua exclusivo
  // do desktop (ver initViewSwitch/o guard de resize).
  let currentView = "dashboard"; // "list" | "kanban" | "dashboard"

  const els = {
    btnMenu: document.getElementById("btn-menu"),
    btnFilter: document.getElementById("btn-filter"),
    btnFilterDesktop: document.getElementById("btn-filter-desktop"),
    filterDot: document.getElementById("filter-dot"),
    filterDotDesktop: document.getElementById("filter-dot-desktop"),
    filterPanel: document.getElementById("filter-panel"),
    searchDesktop: document.getElementById("search-desktop"),
    searchMobile: document.getElementById("search-mobile"),
    chipRows: document.querySelectorAll(".chip-row"),
    chipNoAccount: document.getElementById("chip-no-account"),
    selectManager: document.getElementById("select-manager"),
    selectAgent: document.getElementById("select-agent"),
    draftCount: document.getElementById("draft-count"),
    btnClear: document.getElementById("btn-clear"),
    btnCancel: document.getElementById("btn-cancel"),
    btnApply: document.getElementById("btn-apply"),
    overlay: document.getElementById("overlay"),
    drawer: document.getElementById("drawer"),
    btnTheme: document.getElementById("btn-theme"),
    themeIcon: document.getElementById("theme-icon"),
    themeLabel: document.getElementById("theme-label"),
    themeOptions: document.querySelectorAll(".theme-option"),
    profileMenu: document.querySelector(".profile-menu"),
    btnProfile: document.getElementById("btn-profile"),
    profileDropdown: document.getElementById("profile-dropdown"),
    btnMyData: document.getElementById("btn-my-data"),
    banner: document.getElementById("banner"),
    bannerCount: document.getElementById("banner-count"),
    bannerText: document.getElementById("banner-text"),
    btnCloseBanner: document.getElementById("btn-close-banner"),
    resultCount: document.getElementById("result-count"),
    resultCountDesktop: document.getElementById("result-count-desktop"),
    list: document.getElementById("deal-list"),
    loadMore: document.getElementById("load-more"),
    emptyState: document.getElementById("empty-state"),
    navItems: document.querySelectorAll(".nav-item"),
    viewList: document.getElementById("view-list"),
    viewKanban: document.getElementById("view-kanban"),
    viewDashboard: document.getElementById("view-dashboard"),
    activeFilters: document.getElementById("active-filters"),
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function compactCurrency(v) {
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + Math.round(v);
  }

  function tierOf(score) {
    if (score >= 75) return "high";
    if (score >= 40) return "med";
    return "low";
  }
  function tierLabel(tier) {
    return { high: "Alta", med: "Média", low: "Baixa" }[tier];
  }

  // ---------- theme ----------

  function initTheme() {
    // Claro é o padrão sempre — não segue a preferência do sistema. O usuário
    // troca manualmente pelo menu, e aí sim a escolha fica salva.
    let saved = null;
    try { saved = localStorage.getItem("theme"); } catch (e) {}
    const theme = saved === "dark" ? "dark" : "light";
    applyTheme(theme);
    els.btnTheme.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    els.themeIcon.innerHTML = theme === "dark" ? ICON_MOON : ICON_SUN;
    els.themeLabel.textContent = theme === "dark" ? "Modo escuro" : "Modo claro";
    els.themeOptions.forEach((btn) => btn.classList.toggle("active", btn.dataset.themeChoice === theme));
    // Cores dos gráficos são lidas das CSS vars no momento da criação/update —
    // não seguem a troca de tema automaticamente, então força um refresh.
    if (currentView === "dashboard") renderDashboard();
  }

  // ---------- profile dropdown ----------

  function setProfileMenuOpen(open) {
    els.profileDropdown.classList.toggle("hidden", !open);
    els.btnProfile.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function initProfileMenu() {
    els.btnProfile.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setProfileMenuOpen(els.profileDropdown.classList.contains("hidden"));
    });
    document.addEventListener("click", (ev) => {
      if (!els.profileMenu.contains(ev.target)) setProfileMenuOpen(false);
    });
    els.themeOptions.forEach((btn) => {
      btn.addEventListener("click", () => {
        applyTheme(btn.dataset.themeChoice);
        try { localStorage.setItem("theme", btn.dataset.themeChoice); } catch (e) {}
        setProfileMenuOpen(false);
      });
    });
    els.btnMyData.addEventListener("click", () => setProfileMenuOpen(false));
  }

  // ---------- data ----------

  async function loadDeals() {
    const res = await fetch("deals.json");
    const data = await res.json();
    ALL_DEALS = data.deals;
    populateFilterOptions();
    render();
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  function populateFilterOptions() {
    const regions = uniqueSorted(ALL_DEALS.map((d) => d.regional_office));
    const managers = uniqueSorted(ALL_DEALS.map((d) => d.manager));
    const agents = uniqueSorted(ALL_DEALS.map((d) => d.sales_agent));

    const regionRow = document.querySelector('.chip-row[data-group="region"]');
    regionRow.innerHTML =
      chipHtml("region", "all", "Todas", ALL_DEALS.length) +
      regions.map((r) => chipHtml("region", r, r, ALL_DEALS.filter((d) => d.regional_office === r).length)).join("");

    fillSelect(els.selectManager, [
      { value: "all", label: "Todos os managers", count: ALL_DEALS.length },
      ...managers.map((m) => ({ value: m, label: m, count: ALL_DEALS.filter((d) => d.manager === m).length })),
    ]);
    fillSelect(els.selectAgent, [
      { value: "all", label: "Todos os vendedores", count: ALL_DEALS.length },
      ...agents.map((a) => ({ value: a, label: a, count: ALL_DEALS.filter((d) => d.sales_agent === a).length })),
    ]);

    paintStageChipCounts();
  }

  // Os chips de Estágio já existem fixos no HTML (por causa do "Sem conta"
  // com visibilidade condicional por view) — só injeta a contagem uma vez,
  // sem precisar regenerar o botão.
  function paintStageChipCounts() {
    const counts = {
      all: ALL_DEALS.length,
      Engaging: ALL_DEALS.filter((d) => d.deal_stage === "Engaging").length,
      Prospecting: ALL_DEALS.filter((d) => d.deal_stage === "Prospecting").length,
      "Sem conta": ALL_DEALS.filter((d) => !d.account).length,
    };
    document.querySelectorAll('.chip-row[data-group="stage"] .chip').forEach((btn) => {
      const value = btn.dataset.value;
      const label = btn.textContent.trim();
      btn.innerHTML = `${escapeHtml(label)} <span class="chip-count">(${counts[value] ?? 0})</span>`;
    });
  }

  function chipHtml(group, value, label, count) {
    const countHtml = count === undefined ? "" : ` <span class="chip-count">(${count})</span>`;
    return `<button class="chip" data-group="${group}" data-value="${escapeHtml(value)}">${escapeHtml(label)}${countHtml}</button>`;
  }

  function fillSelect(select, options) {
    select.innerHTML = options
      .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}${o.count === undefined ? "" : ` (${o.count})`}</option>`)
      .join("");
  }

  // ---------- filtering ----------

  // skipField deixa de fora uma dimensão do próprio filtro — usado pelos
  // gráficos do dashboard pra sempre mostrar o panorama completo daquilo
  // que eles mesmos controlam, em vez de colapsar quando você filtra
  // clicando numa barra do próprio gráfico.
  function applyPredicate(d, f, skipField) {
    if (skipField !== "stage") {
      if (f.stage === "Sem conta") {
        if (d.account) return false;
      } else if (f.stage !== "all" && d.deal_stage !== f.stage) {
        return false;
      }
    }
    if (skipField !== "region" && f.region !== "all" && d.regional_office !== f.region) return false;
    if (skipField !== "manager" && f.manager !== "all" && d.manager !== f.manager) return false;
    if (skipField !== "agent" && f.agent !== "all" && d.sales_agent !== f.agent) return false;
    if (state.search) {
      const hay = (d.account + " " + d.product).toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  }

  // Deals sem conta identificada continuam aparecendo no estágio real deles
  // (mesmo produto/agente/valor, só falta a conta) — mas não é possível
  // calcular uma prioridade comparável pra eles. Ficam ao final da lista
  // (sem posição no ranking); pra isolar e agir em lote, use o filtro
  // "Sem conta" no Estágio.
  function sortForDisplay(deals) {
    const withAccount = deals.filter((d) => d.account).sort((a, b) => b.score.priority_score - a.score.priority_score);
    const withoutAccount = deals.filter((d) => !d.account).sort((a, b) => b.score.estimated_value - a.score.estimated_value);
    return [...withAccount, ...withoutAccount];
  }

  function getFiltered() {
    const matches = ALL_DEALS.filter((d) => applyPredicate(d, state));
    return { main: sortForDisplay(matches) };
  }

  function getDraftCount() {
    return ALL_DEALS.filter((d) => applyPredicate(d, draft)).length;
  }

  // ---------- render ----------

  function render() {
    renderBanner();
    if (currentView === "kanban") {
      renderKanban();
    } else if (currentView === "dashboard") {
      renderDashboard();
    } else {
      renderList();
    }
  }

  function wireCardEvents(container) {
    container.querySelectorAll(".deal-card").forEach((card) => {
      card.addEventListener("click", (ev) => {
        if (ev.target.closest(".ai-form") || ev.target.closest(".ai-log")) return;
        card.classList.toggle("open");
        if (card.classList.contains("open")) probeAiEndpoint(card);
      });
      const form = card.querySelector(".ai-form");
      if (form) form.addEventListener("submit", (ev) => onAskAi(ev, card));
    });
  }

  function setResultCount(text) {
    els.resultCount.textContent = text;
    els.resultCountDesktop.textContent = text;
  }

  function renderBanner() {
    const highs = ALL_DEALS.filter((d) => d.account && tierOf(d.score.priority_score) === "high");
    const sum = highs.reduce((s, d) => s + d.score.expected_value, 0);
    els.bannerCount.textContent = highs.length;
    els.bannerText.textContent = `de alta prioridade — ${compactCurrency(sum)} em jogo hoje`;
  }

  // ---------- toast (banner de alta prioridade) ----------

  const TOAST_DURATION_MS = 6000;
  const TOAST_TRANSITION_MS = 250;
  let bannerTimer = null;

  function showBanner() {
    els.banner.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => els.banner.classList.add("show")));
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, TOAST_DURATION_MS);
  }

  function hideBanner() {
    clearTimeout(bannerTimer);
    els.banner.classList.remove("show");
    setTimeout(() => { els.banner.hidden = true; }, TOAST_TRANSITION_MS);
  }

  function renderList() {
    const { main } = getFiltered();
    const total = main.length;
    const visible = main.slice(0, visibleCount);

    setResultCount(`${total} deal${total === 1 ? "" : "s"} encontrado${total === 1 ? "" : "s"}`);
    els.emptyState.hidden = total !== 0;
    els.loadMore.hidden = visibleCount >= main.length;

    els.list.innerHTML = visible.map((d) => cardHtml(d)).join("");
    wireCardEvents(els.list);
  }

  const KANBAN_STAGES = ["Prospecting", "Engaging"];
  const KANBAN_COL_CAP = 40;

  function kanbanColHtml(name, deals, valueField, muted) {
    const visible = deals.slice(0, KANBAN_COL_CAP);
    const rest = deals.length - visible.length;
    const value = deals.reduce((s, d) => s + d.score[valueField], 0);
    return `
      <div class="kanban-col${muted ? " no-account-col" : ""}" data-stage="${escapeHtml(name)}">
        <div class="kanban-col-head">
          <span class="name">${escapeHtml(name)}</span>
          <span class="count">${deals.length} · ${compactCurrency(value)}</span>
        </div>
        <div class="kanban-col-body">
          ${visible.map((d) => cardHtml(d, true)).join("")}
          ${rest > 0 ? `<div class="kanban-more">+ ${rest.toLocaleString("pt-BR")} — ajuste os filtros pra ver todos</div>` : ""}
        </div>
      </div>`;
  }

  // No kanban, os deals sem conta ganham a própria coluna (fora de
  // Prospecting/Engaging) pra dar pra escanear e agir em lote — mesma
  // lógica do "Precisa de atenção no CRM" de antes, só que como coluna.
  function renderKanban() {
    const { main } = getFiltered();
    setResultCount(`${main.length} deal${main.length === 1 ? "" : "s"} encontrado${main.length === 1 ? "" : "s"}`);

    const withAccount = main.filter((d) => d.account);
    const noAccount = main.filter((d) => !d.account);

    const cols = KANBAN_STAGES.map((stage) =>
      kanbanColHtml(stage, withAccount.filter((d) => d.deal_stage === stage), "expected_value")
    );
    cols.push(kanbanColHtml("Sem conta", noAccount, "estimated_value", true));

    els.viewKanban.innerHTML = cols.join("");
    wireCardEvents(els.viewKanban);
    sizeKanbanBoard();
  }

  // Preenche 100% do espaço vertical restante da viewport (em vez de um
  // max-height fixo por tentativa), pra não sobrar vão embaixo nem depender
  // de constantes frágeis se o header/toolbar mudar de altura.
  function sizeKanbanBoard() {
    if (currentView !== "kanban" || els.viewKanban.hidden) return;
    const top = els.viewKanban.getBoundingClientRect().top;
    const height = Math.max(240, window.innerHeight - top - 20);
    els.viewKanban.style.height = `${height}px`;
  }

  // ---------- dashboard ----------

  const charts = {};

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function groupSum(deals, keyFn) {
    const map = new Map();
    deals.forEach((d) => {
      const k = keyFn(d);
      const cur = map.get(k) || { count: 0, value: 0 };
      cur.count += 1;
      cur.value += d.score.expected_value;
      map.set(k, cur);
    });
    return map;
  }

  function baseChartOptions(extra) {
    const grid = cssVar("--chart-grid");
    const axis = cssVar("--chart-axis");
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: "easeOutQuart" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar("--surface"), titleColor: cssVar("--ink"), bodyColor: cssVar("--ink"),
          borderColor: cssVar("--hairline"), borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4,
        },
      },
      scales: {
        x: { grid: { color: grid }, ticks: { color: axis, font: { size: 11 } }, border: { display: false } },
        y: { grid: { color: grid }, ticks: { color: axis, font: { size: 11 } }, border: { display: false }, beginAtZero: true },
      },
    };
    if (extra && extra.plugins) Object.assign(opts.plugins, extra.plugins);
    if (extra && extra.scales) {
      Object.keys(extra.scales).forEach((k) => Object.assign(opts.scales[k] || (opts.scales[k] = {}), extra.scales[k]));
    }
    if (extra) {
      Object.keys(extra).forEach((k) => { if (k !== "plugins" && k !== "scales") opts[k] = extra[k]; });
    }
    return opts;
  }

  function upsertChart(id, canvasId, config) {
    if (charts[id]) {
      charts[id].data = config.data;
      charts[id].options = config.options;
      charts[id].update();
      return;
    }
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return;
    charts[id] = new Chart(canvas, config);
  }

  function renderLegend(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "dash-legend-row";
      const dot = document.createElement("span");
      dot.className = "dash-legend-dot";
      dot.style.background = it.color;
      const label = document.createElement("span");
      label.className = "dash-legend-label";
      label.textContent = it.label;
      const sub = document.createElement("span");
      sub.className = "dash-legend-sub";
      sub.textContent = it.sub;
      row.append(dot, label, sub);
      el.appendChild(row);
    });
  }

  // Clicar num gráfico do dashboard aplica o filtro correspondente e refaz
  // os gráficos na hora — cross-filtering, sem sair da view. Clicar de novo
  // na mesma barra remove o filtro (toggle). O filtro fica valendo se o
  // usuário for pra Lista/Kanban depois.
  function filterInPlace(field, value) {
    state[field] = state[field] === value ? "all" : value;
    visibleCount = PAGE_SIZE;
    paintFilterDot();
    paintActiveFilters();
    renderDashboard();
  }

  function barClickHandler(field, getValue) {
    return (evt, elements) => {
      if (!elements.length) return;
      filterInPlace(field, getValue(elements[0].index));
    };
  }

  function barHoverHandler(evt, elements) {
    evt.native.target.style.cursor = elements.length ? "pointer" : "default";
  }

  // Em vez de recalcular a barra a partir dos dados já filtrados por ela
  // mesma (o que faria as outras opções somem/zerarem ao clicar), cada
  // gráfico ignora o próprio filtro no cálculo e só destaca com opacidade
  // reduzida as barras que não são a seleção atual — o panorama completo
  // continua visível, só menos evidente.
  function opacityColors(baseColors, categories, activeValue) {
    if (activeValue === "all") return baseColors;
    return categories.map((cat, i) => (cat === activeValue ? baseColors[i] : hexToRgba(baseColors[i], 0.25)));
  }

  function renderStageChart() {
    const stages = ["Prospecting", "Engaging", "Sem conta"];
    const baseColors = [cssVar("--chart-1"), cssVar("--chart-2"), cssVar("--ink-muted")];
    const pool = ALL_DEALS.filter((d) => applyPredicate(d, state, "stage"));
    const withAccount = pool.filter((d) => d.account);
    const noAccount = pool.filter((d) => !d.account);
    const counts = [
      withAccount.filter((d) => d.deal_stage === "Prospecting").length,
      withAccount.filter((d) => d.deal_stage === "Engaging").length,
      noAccount.length,
    ];
    const values = [
      withAccount.filter((d) => d.deal_stage === "Prospecting").reduce((s, d) => s + d.score.expected_value, 0),
      withAccount.filter((d) => d.deal_stage === "Engaging").reduce((s, d) => s + d.score.expected_value, 0),
      noAccount.reduce((s, d) => s + d.score.estimated_value, 0),
    ];
    const colors = opacityColors(baseColors, stages, state.stage);
    upsertChart("stage", "chart-stage", {
      type: "bar",
      data: { labels: stages, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 56 }] },
      options: baseChartOptions({
        onClick: barClickHandler("stage", (i) => stages[i]),
        onHover: barHoverHandler,
        plugins: { tooltip: { callbacks: {
          title: (items) => stages[items[0].dataIndex],
          label: (item) => [compactCurrency(item.parsed.y), `${counts[item.dataIndex]} deals`],
        } } },
        scales: { y: { ticks: { callback: (v) => compactCurrency(v) } } },
      }),
    });
    renderLegend("legend-stage", stages.map((s, i) => ({ label: s, color: baseColors[i], sub: `${counts[i]} deals · ${compactCurrency(values[i])}` })));
  }

  function renderPriorityChart() {
    const withAccount = ALL_DEALS.filter((d) => applyPredicate(d, state)).filter((d) => d.account);
    const buckets = [];
    for (let i = 0; i < 10; i++) buckets.push({ lo: i * 10, hi: i === 9 ? 100 : i * 10 + 9, label: i === 9 ? "90–100" : `${i * 10}–${i * 10 + 9}` });
    const counts = buckets.map((b) => withAccount.filter((d) => d.score.priority_score >= b.lo && d.score.priority_score <= b.hi).length);
    const base = cssVar("--chart-1");
    const colors = counts.map((_, i) => hexToRgba(base, 0.25 + (i / 9) * 0.75));
    upsertChart("priority", "chart-priority", {
      type: "bar",
      data: { labels: buckets.map((b) => b.label), datasets: [{ data: counts, backgroundColor: colors, borderRadius: 4 }] },
      options: baseChartOptions({
        plugins: { tooltip: { callbacks: { title: (items) => `Score ${buckets[items[0].dataIndex].label}`, label: (item) => `${item.parsed.y} deals` } } },
      }),
    });
  }

  function renderManagerChart() {
    const pool = ALL_DEALS.filter((d) => applyPredicate(d, state, "manager")).filter((d) => d.account);
    const byManager = groupSum(pool, (d) => d.manager || "—");
    const rows = Array.from(byManager.entries())
      .map(([manager, v]) => ({ manager, value: v.value, count: v.count }))
      .sort((a, b) => b.value - a.value);
    const base = cssVar("--chart-1");
    const colors = rows.map((r) => (state.manager === "all" || state.manager === r.manager ? base : hexToRgba(base, 0.25)));
    upsertChart("manager", "chart-manager", {
      type: "bar",
      data: { labels: rows.map((r) => r.manager), datasets: [{ data: rows.map((r) => r.value), backgroundColor: colors, borderRadius: 4, maxBarThickness: 20 }] },
      options: baseChartOptions({
        indexAxis: "y",
        onClick: barClickHandler("manager", (i) => rows[i].manager),
        onHover: barHoverHandler,
        plugins: { tooltip: { callbacks: { label: (item) => [compactCurrency(item.parsed.x), `${rows[item.dataIndex].count} deals`] } } },
        scales: { x: { ticks: { callback: (v) => compactCurrency(v) } }, y: { grid: { display: false } } },
      }),
    });
  }

  function renderRegionChart() {
    const pool = ALL_DEALS.filter((d) => applyPredicate(d, state, "region")).filter((d) => d.account);
    const regions = ["Central", "East", "West"];
    const baseColors = [cssVar("--chart-1"), cssVar("--chart-2"), cssVar("--chart-3")];
    const counts = regions.map((r) => pool.filter((d) => d.regional_office === r).length);
    const values = regions.map((r) => pool.filter((d) => d.regional_office === r).reduce((s, d) => s + d.score.expected_value, 0));
    const colors = opacityColors(baseColors, regions, state.region);
    upsertChart("region", "chart-region", {
      type: "bar",
      data: { labels: regions, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 56 }] },
      options: baseChartOptions({
        onClick: barClickHandler("region", (i) => regions[i]),
        onHover: barHoverHandler,
        plugins: { tooltip: { callbacks: {
          title: (items) => regions[items[0].dataIndex],
          label: (item) => [compactCurrency(item.parsed.y), `${counts[item.dataIndex]} deals`],
        } } },
        scales: { y: { ticks: { callback: (v) => compactCurrency(v) } } },
      }),
    });
    renderLegend("legend-region", regions.map((r, i) => ({ label: r, color: baseColors[i], sub: `${counts[i]} deals · ${compactCurrency(values[i])}` })));
  }

  function renderDashboard() {
    const matches = ALL_DEALS.filter((d) => applyPredicate(d, state));
    setResultCount(`${matches.length} deal${matches.length === 1 ? "" : "s"} encontrado${matches.length === 1 ? "" : "s"}`);
    renderStageChart();
    renderPriorityChart();
    renderManagerChart();
    renderRegionChart();
  }

  function cardHtml(d, compact) {
    const hasAccount = Boolean(d.account);
    const tier = hasAccount ? tierOf(d.score.priority_score) : null;
    const accountLabel = hasAccount ? d.account : "Conta não identificada";

    const badgeStyle = hasAccount
      ? `background: var(--tier-${tier}-bg); color: var(--tier-${tier}-fg);`
      : `background: var(--hairline); color: var(--ink-2);`;
    const badgeTitle = hasAccount ? `Prioridade ${tierLabel(tier)}` : "Sem conta associada — sem prioridade calculável";
    const badgeInner = hasAccount
      ? `<div class="score">${d.score.priority_score}</div><div class="tier">${tierLabel(tier)}</div>`
      : `<div class="score">00</div>`;
    const metaTag = hasAccount ? "" : ` · <span class="tag-no-account">Precisa de atenção no CRM</span>`;

    const detail = hasAccount
      ? `
        <p class="narrative">${escapeHtml(d.narrative)}</p>
        <table class="breakdown">
          <tr><td>Valor estimado do produto</td><td>${compactCurrency(d.score.estimated_value)}</td></tr>
          <tr><td>Chance de fechar (estimada)</td><td>${Math.round(d.score.win_probability * 100)}%</td></tr>
          <tr><td>Taxa média do pipeline</td><td>${Math.round(d.score.baseline_rate * 100)}%</td></tr>
          <tr><td>Ajuste por vendedor</td><td>${fmtDelta(d.score.agent_delta)}</td></tr>
          <tr><td>Ajuste por produto</td><td>${fmtDelta(d.score.product_delta)}</td></tr>
          <tr><td>Ajuste por setor da conta</td><td>${fmtDelta(d.score.sector_delta)}</td></tr>
          <tr><td>Ajuste por momentum</td><td>×${d.score.momentum_multiplier.toFixed(2)}</td></tr>
          <tr><td>Valor esperado final</td><td>${compactCurrency(d.score.expected_value)}</td></tr>
        </table>
        <p class="confidence-note">Confiança: ${escapeHtml(d.score.confidence)} · Manager: ${escapeHtml(d.manager || "—")} · Setor: ${escapeHtml(d.sector || "não identificado")}</p>`
      : `
        <p class="narrative">Este deal não tem conta associada no CRM. Não é possível calcular uma prioridade comparável nem agir sobre ele (ligar para o cliente, por exemplo) até a conta ser identificada no sistema. Estimativa de valor pelo histórico do produto: ${compactCurrency(d.score.estimated_value)}.</p>
        <p class="confidence-note">Manager: ${escapeHtml(d.manager || "—")} · Setor: ${escapeHtml(d.sector || "não identificado")}</p>`;

    return `
    <li class="deal-card${compact ? " kanban-card" : ""}${hasAccount ? "" : " no-account"}" data-id="${escapeHtml(d.opportunity_id)}">
      <div class="deal-card-head">
        <div class="priority-badge${hasAccount ? ` tier-${tier}` : ""}" style="${badgeStyle}" title="${badgeTitle}">
          ${badgeInner}
        </div>
        <div class="deal-title">
          <p class="deal-account">${escapeHtml(accountLabel)}</p>
          <p class="deal-sub">${escapeHtml(d.product)} · ${escapeHtml(d.sales_agent)}</p>
          <p class="deal-meta">${escapeHtml(d.deal_stage)} · ${compactCurrency(d.score.estimated_value)} est. · ${escapeHtml(d.regional_office || "—")}${metaTag}</p>
        </div>
      </div>
      <div class="deal-detail">
        ${detail}
        <div class="ai-panel">
          <div class="ai-log"></div>
          <form class="ai-form">
            <input type="text" placeholder="Pergunte algo sobre este deal..." required>
            <button type="submit">Perguntar à IA</button>
          </form>
        </div>
      </div>
    </li>`;
  }

  function fmtDelta(v) {
    const pp = Math.round(v * 1000) / 10;
    if (Math.abs(pp) < 0.1) return "±0pp";
    return (pp > 0 ? "+" : "") + pp + "pp";
  }

  // ---------- Ask AI ----------

  async function probeAiEndpoint(card) {
    if (aiEndpointAvailable !== null) { paintAiHint(card); return; }
    try {
      const res = await fetch("/api/health", { method: "GET" });
      aiEndpointAvailable = res.ok;
    } catch (e) {
      aiEndpointAvailable = false;
    }
    paintAiHint(card);
  }

  function paintAiHint(card) {
    const log = card.querySelector(".ai-log");
    if (!log || log.dataset.hinted) return;
    log.dataset.hinted = "1";
    if (!aiEndpointAvailable) {
      log.innerHTML = `<div class="ai-msg hint">Recurso de IA ao vivo disponível apenas na versão hospedada (o backend Node.js não está rodando aqui). A explicação acima já foi calculada a partir dos dados reais.</div>`;
    }
  }

  async function onAskAi(ev, card) {
    ev.preventDefault();
    const form = ev.target;
    const input = form.querySelector("input");
    const log = card.querySelector(".ai-log");
    const question = input.value.trim();
    if (!question) return;

    log.dataset.hinted = "1";
    log.insertAdjacentHTML("beforeend", `<div class="ai-msg user">${escapeHtml(question)}</div>`);
    input.value = "";
    const btn = form.querySelector("button");
    btn.disabled = true;

    const dealId = card.dataset.id;
    const deal = ALL_DEALS.find((d) => d.opportunity_id === dealId);

    try {
      const res = await fetch("/api/ask-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal, question }),
      });
      if (!res.ok) throw new Error("backend indisponível");
      const data = await res.json();
      log.insertAdjacentHTML("beforeend", `<div class="ai-msg assistant">${escapeHtml(data.answer)}</div>`);
    } catch (e) {
      log.insertAdjacentHTML(
        "beforeend",
        `<div class="ai-msg hint">Não foi possível falar com a IA ao vivo agora (rodando localmente sem o backend, ou o servidor está fora do ar). Tente na versão hospedada.</div>`
      );
    } finally {
      btn.disabled = false;
      log.scrollTop = log.scrollHeight;
    }
  }

  // ---------- filter panel (draft / apply / cancel / clear) ----------

  function positionFilterPanel(triggerBtn) {
    els.filterPanel.style.top = "";
    els.filterPanel.style.left = "";
    els.filterPanel.style.right = "";
    if (!triggerBtn || !window.matchMedia(DESKTOP_QUERY).matches) return;
    const rect = triggerBtn.getBoundingClientRect();
    const panelWidth = 460;
    const left = Math.min(rect.left, window.innerWidth - panelWidth - 16);
    els.filterPanel.style.top = `${rect.bottom + 8}px`;
    els.filterPanel.style.left = `${Math.max(16, left)}px`;
    els.filterPanel.style.right = "auto";
  }

  function openFilterPanel(triggerBtn) {
    draft.stage = state.stage;
    draft.region = state.region;
    draft.manager = state.manager;
    draft.agent = state.agent;
    els.selectManager.value = draft.manager;
    els.selectAgent.value = draft.agent;
    paintChips();
    paintDraftCount();
    positionFilterPanel(triggerBtn);
    els.filterPanel.classList.remove("hidden");
    els.overlay.hidden = false;
  }

  function closeFilterPanel() {
    els.filterPanel.classList.add("hidden");
    if (els.drawer.classList.contains("hidden")) els.overlay.hidden = true;
  }

  function paintChips() {
    els.chipRows.forEach((row) => {
      const group = row.dataset.group;
      row.querySelectorAll(".chip").forEach((chip) => {
        chip.classList.toggle("on", chip.dataset.value === draft[group]);
      });
    });
  }

  function paintDraftCount() {
    els.draftCount.textContent = getDraftCount();
  }

  function paintFilterDot() {
    const active = state.stage !== "all" || state.region !== "all" || state.manager !== "all" || state.agent !== "all";
    els.filterDot.hidden = !active;
    els.filterDotDesktop.hidden = !active;
  }

  const FILTER_LABELS = { stage: "Estágio", region: "Região", manager: "Manager", agent: "Vendedor" };

  // Badges abaixo da busca mostrando cada filtro ativo, com X pra remover
  // individualmente (os dados voltam ao estado sem aquele filtro).
  function paintActiveFilters() {
    const active = Object.keys(FILTER_LABELS).filter((key) => state[key] !== "all");
    els.activeFilters.hidden = active.length === 0;
    els.activeFilters.innerHTML = "";
    active.forEach((key) => {
      const chip = document.createElement("span");
      chip.className = "active-filter-chip";
      const label = document.createElement("span");
      label.textContent = `${FILTER_LABELS[key]}: ${state[key]}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "×";
      btn.setAttribute("aria-label", `Remover filtro ${FILTER_LABELS[key]}`);
      btn.addEventListener("click", () => {
        state[key] = "all";
        visibleCount = PAGE_SIZE;
        paintFilterDot();
        paintActiveFilters();
        render();
      });
      chip.append(label, btn);
      els.activeFilters.appendChild(chip);
    });
  }

  // ---------- wiring ----------

  function setView(view) {
    currentView = view;
    els.navItems.forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    els.viewList.hidden = view !== "list";
    els.viewKanban.hidden = view !== "kanban";
    els.viewDashboard.hidden = view !== "dashboard";
    // "Sem conta" no filtro de estágio só faz sentido na lista — o kanban já
    // tem a própria coluna dedicada pra isso.
    els.chipNoAccount.hidden = view !== "list";
    if (view !== "list" && state.stage === "Sem conta") {
      state.stage = "all";
      paintFilterDot();
    }
    render();
  }

  function initViewSwitch() {
    els.navItems.forEach((btn) => {
      btn.addEventListener("click", () => {
        setView(btn.dataset.view);
        els.drawer.classList.add("hidden");
        els.overlay.hidden = true;
      });
    });
    // Kanban só existe no desktop — se a janela encolher pra mobile enquanto
    // o kanban está ativo, volta pra lista.
    const desktopQuery = window.matchMedia(DESKTOP_QUERY);
    desktopQuery.addEventListener("change", (ev) => {
      if (!ev.matches && currentView === "kanban") setView("list");
    });
  }

  function init() {
    initTheme();
    initProfileMenu();
    initViewSwitch();
    setView(currentView);
    window.addEventListener("resize", sizeKanbanBoard);

    els.btnMenu.addEventListener("click", () => {
      els.drawer.classList.remove("hidden");
      els.overlay.hidden = false;
    });
    els.overlay.addEventListener("click", () => {
      els.drawer.classList.add("hidden");
      closeFilterPanel();
    });

    els.btnFilter.addEventListener("click", () => openFilterPanel(els.btnFilter));
    els.btnFilterDesktop.addEventListener("click", () => openFilterPanel(els.btnFilterDesktop));
    els.btnCancel.addEventListener("click", closeFilterPanel);
    els.btnApply.addEventListener("click", () => {
      state.stage = draft.stage;
      state.region = draft.region;
      state.manager = draft.manager;
      state.agent = draft.agent;
      visibleCount = PAGE_SIZE;
      closeFilterPanel();
      paintFilterDot();
      render();
    });
    els.btnClear.addEventListener("click", () => {
      draft.stage = "all"; draft.region = "all"; draft.manager = "all"; draft.agent = "all";
      els.selectManager.value = "all";
      els.selectAgent.value = "all";
      paintChips();
      paintDraftCount();
    });

    document.querySelectorAll(".chip-row").forEach((row) => {
      row.addEventListener("click", (ev) => {
        const chip = ev.target.closest(".chip");
        if (!chip) return;
        draft[row.dataset.group] = chip.dataset.value;
        paintChips();
        paintDraftCount();
      });
    });
    els.selectManager.addEventListener("change", () => { draft.manager = els.selectManager.value; paintDraftCount(); });
    els.selectAgent.addEventListener("change", () => { draft.agent = els.selectAgent.value; paintDraftCount(); });

    const onSearch = (val) => {
      state.search = val.trim().toLowerCase();
      els.searchDesktop.value = val;
      els.searchMobile.value = val;
      visibleCount = PAGE_SIZE;
      render();
      paintDraftCount();
    };
    els.searchDesktop.addEventListener("input", (e) => onSearch(e.target.value));
    els.searchMobile.addEventListener("input", (e) => onSearch(e.target.value));

    els.btnCloseBanner.addEventListener("click", hideBanner);

    els.loadMore.addEventListener("click", () => {
      visibleCount += PAGE_SIZE;
      renderList();
    });

    loadDeals().then(() => {
      showBanner();
    });
  }

  init();
})();
