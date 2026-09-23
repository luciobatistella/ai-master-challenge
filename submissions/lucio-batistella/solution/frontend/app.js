(function () {
  "use strict";

  const PAGE_SIZE = 30;
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
  let currentView = "list"; // "list" | "kanban"

  const els = {
    btnMenu: document.getElementById("btn-menu"),
    btnFilter: document.getElementById("btn-filter"),
    filterDot: document.getElementById("filter-dot"),
    filterPanel: document.getElementById("filter-panel"),
    searchDesktop: document.getElementById("search-desktop"),
    searchMobile: document.getElementById("search-mobile"),
    chipRows: document.querySelectorAll(".chip-row"),
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
    banner: document.getElementById("banner"),
    bannerCount: document.getElementById("banner-count"),
    bannerText: document.getElementById("banner-text"),
    btnCloseBanner: document.getElementById("btn-close-banner"),
    resultCount: document.getElementById("result-count"),
    list: document.getElementById("deal-list"),
    loadMore: document.getElementById("load-more"),
    emptyState: document.getElementById("empty-state"),
    asOf: document.getElementById("data-asof"),
    attentionSection: document.getElementById("attention-section"),
    btnCollapse: document.getElementById("btn-collapse"),
    navItems: document.querySelectorAll(".nav-item"),
    viewList: document.getElementById("view-list"),
    viewKanban: document.getElementById("view-kanban"),
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
  }

  // ---------- data ----------

  async function loadDeals() {
    const res = await fetch("deals.json");
    const data = await res.json();
    ALL_DEALS = data.deals;
    els.asOf.textContent =
      `Dados de referência: ${data.total_open_deals.toLocaleString("pt-BR")} deals abertos, posição em ${data.as_of_date}. ` +
      `Taxa de vitória geral do pipeline: ${(data.baseline_win_rate * 100).toFixed(0)}%.`;
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
      chipHtml("region", "all", "Todas") + regions.map((r) => chipHtml("region", r, r)).join("");

    fillSelect(els.selectManager, [{ value: "all", label: "Todos os managers" }, ...managers.map((m) => ({ value: m, label: m }))]);
    fillSelect(els.selectAgent, [{ value: "all", label: "Todos os vendedores" }, ...agents.map((a) => ({ value: a, label: a }))]);
  }

  function chipHtml(group, value, label) {
    return `<button class="chip" data-group="${group}" data-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
  }

  function fillSelect(select, options) {
    select.innerHTML = options.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join("");
  }

  // ---------- filtering ----------

  function applyPredicate(d, f) {
    if (f.stage !== "all" && d.deal_stage !== f.stage) return false;
    if (f.region !== "all" && d.regional_office !== f.region) return false;
    if (f.manager !== "all" && d.manager !== f.manager) return false;
    if (f.agent !== "all" && d.sales_agent !== f.agent) return false;
    if (state.search) {
      const hay = (d.account + " " + d.product).toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  }

  // Deals sem conta identificada não entram no ranking principal — não é
  // possível agir sobre eles até o CRM ter o cliente associado (ver banner
  // de atenção). Isso evita que um produto de ticket alto e conta em branco
  // domine o topo da lista sem que o vendedor possa fazer nada com ele.
  function getFiltered() {
    const matches = ALL_DEALS.filter((d) => applyPredicate(d, state));
    const main = matches.filter((d) => d.account).sort((a, b) => b.score.priority_score - a.score.priority_score);
    const attention = matches.filter((d) => !d.account);
    return { main, attention };
  }

  function getDraftCount() {
    return ALL_DEALS.filter((d) => applyPredicate(d, draft)).length;
  }

  // ---------- render ----------

  function render() {
    renderBanner();
    if (currentView === "kanban") {
      renderKanban();
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

  function renderBanner() {
    const highs = ALL_DEALS.filter((d) => d.account && tierOf(d.score.priority_score) === "high");
    const sum = highs.reduce((s, d) => s + d.score.expected_value, 0);
    els.bannerCount.textContent = highs.length;
    els.bannerText.textContent = `de alta prioridade — ${compactCurrency(sum)} em jogo hoje`;
  }

  const ATTENTION_PREVIEW_CAP = 12;

  function renderList() {
    const { main, attention } = getFiltered();
    const total = main.length + attention.length;
    const visible = main.slice(0, visibleCount);

    els.resultCount.textContent = `${total} deal${total === 1 ? "" : "s"} encontrado${total === 1 ? "" : "s"}`;
    els.emptyState.hidden = total !== 0;
    els.loadMore.hidden = visibleCount >= main.length;

    els.list.innerHTML = visible.map((d) => cardHtml(d)).join("");
    wireCardEvents(els.list);
    renderAttention(attention);
  }

  const KANBAN_STAGES = ["Prospecting", "Engaging"];
  const KANBAN_COL_CAP = 40;

  function renderKanban() {
    const { main } = getFiltered();
    els.resultCount.textContent = `${main.length} deal${main.length === 1 ? "" : "s"} encontrado${main.length === 1 ? "" : "s"}`;

    els.viewKanban.innerHTML = KANBAN_STAGES.map((stage) => {
      const deals = main.filter((d) => d.deal_stage === stage);
      const visible = deals.slice(0, KANBAN_COL_CAP);
      const rest = deals.length - visible.length;
      const value = deals.reduce((s, d) => s + d.score.expected_value, 0);
      return `
        <div class="kanban-col" data-stage="${escapeHtml(stage)}">
          <div class="kanban-col-head">
            <span class="name">${escapeHtml(stage)}</span>
            <span class="count">${deals.length} · ${compactCurrency(value)}</span>
          </div>
          <div class="kanban-col-body">
            ${visible.map((d) => cardHtml(d, true)).join("")}
            ${rest > 0 ? `<div class="kanban-more">+ ${rest.toLocaleString("pt-BR")} — ajuste os filtros pra ver todos</div>` : ""}
          </div>
        </div>`;
    }).join("");

    wireCardEvents(els.viewKanban);
  }

  function renderAttention(attention) {
    if (attention.length === 0) {
      els.attentionSection.hidden = true;
      els.attentionSection.innerHTML = "";
      return;
    }
    const preview = attention.slice(0, ATTENTION_PREVIEW_CAP);
    const rest = attention.length - preview.length;
    const rows = preview
      .map(
        (d) => `
      <li class="attention-card">
        <span class="attention-dot"></span>
        <div>
          <p class="attention-label">Conta não identificada</p>
          <p class="deal-sub">${escapeHtml(d.product)} · ${escapeHtml(d.sales_agent)} · ${compactCurrency(d.score.estimated_value)} est.</p>
        </div>
      </li>`
      )
      .join("");
    els.attentionSection.innerHTML = `
      <div class="attention-heading">Precisa de atenção no CRM (${attention.length})</div>
      <div class="attention-copy">Estes deals não têm conta associada no CRM — não entram no ranking de prioridade porque não é possível agir sobre eles até identificar o cliente.</div>
      <ul class="attention-list">${rows}</ul>
      ${rest > 0 ? `<div class="attention-more">+ ${rest.toLocaleString("pt-BR")} deals adicionais sem conta (ajuste os filtros pra ver por vendedor/região).</div>` : ""}
    `;
    els.attentionSection.hidden = false;
  }

  function cardHtml(d, compact) {
    const tier = tierOf(d.score.priority_score);
    const account = d.account;
    return `
    <li class="deal-card${compact ? " kanban-card" : ""}" data-id="${escapeHtml(d.opportunity_id)}">
      <div class="deal-card-head">
        <div class="priority-badge tier-${tier}" style="background: var(--tier-${tier}-bg); color: var(--tier-${tier}-fg);" title="Prioridade ${tierLabel(tier)}">
          <div class="score">${d.score.priority_score}</div>
          <div class="tier">${tierLabel(tier)}</div>
        </div>
        <div class="deal-title">
          <p class="deal-account">${escapeHtml(account)}</p>
          <p class="deal-sub">${escapeHtml(d.product)} · ${escapeHtml(d.sales_agent)}</p>
          <p class="deal-meta">${escapeHtml(d.deal_stage)} · ${compactCurrency(d.score.estimated_value)} est. · ${escapeHtml(d.regional_office || "—")}</p>
        </div>
      </div>
      <div class="deal-detail">
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
        <p class="confidence-note">Confiança: ${escapeHtml(d.score.confidence)} · Manager: ${escapeHtml(d.manager || "—")} · Setor: ${escapeHtml(d.sector || "não identificado")}</p>
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

  function openFilterPanel() {
    draft.stage = state.stage;
    draft.region = state.region;
    draft.manager = state.manager;
    draft.agent = state.agent;
    els.selectManager.value = draft.manager;
    els.selectAgent.value = draft.agent;
    paintChips();
    paintDraftCount();
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
  }

  // ---------- wiring ----------

  function initSidebar() {
    let collapsed = false;
    try { collapsed = localStorage.getItem("sidebarCollapsed") === "1"; } catch (e) {}
    els.drawer.classList.toggle("collapsed", collapsed);
    els.btnCollapse.addEventListener("click", () => {
      collapsed = !collapsed;
      els.drawer.classList.toggle("collapsed", collapsed);
      try { localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0"); } catch (e) {}
    });
  }

  function initViewSwitch() {
    els.navItems.forEach((btn) => {
      btn.addEventListener("click", () => {
        currentView = btn.dataset.view;
        els.navItems.forEach((b) => b.classList.toggle("active", b === btn));
        els.viewList.hidden = currentView !== "list";
        els.viewKanban.hidden = currentView !== "kanban";
        render();
      });
    });
  }

  function init() {
    initTheme();
    initSidebar();
    initViewSwitch();

    els.btnMenu.addEventListener("click", () => {
      els.drawer.classList.remove("hidden");
      els.overlay.hidden = false;
    });
    els.overlay.addEventListener("click", () => {
      els.drawer.classList.add("hidden");
      closeFilterPanel();
    });

    els.btnFilter.addEventListener("click", openFilterPanel);
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

    els.btnCloseBanner.addEventListener("click", () => { els.banner.hidden = true; });

    els.loadMore.addEventListener("click", () => {
      visibleCount += PAGE_SIZE;
      renderList();
    });

    loadDeals().then(() => {
      els.banner.hidden = false;
    });
  }

  init();
})();
