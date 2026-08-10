const state = {
  lhs: null,
  rhs: null,
  result: null,
  rows: [],
  changeIndexes: [],
  currentChange: 0,
  comparing: false,
  activeSide: "lhs",
};

const dragState = {
  paths: [],
  itemCount: 0,
};

const elements = {
  welcome: document.querySelector("#welcome"),
  workspace: document.querySelector("#workspace"),
  lhsCard: document.querySelector("#lhsCard"),
  rhsCard: document.querySelector("#rhsCard"),
  swapFiles: document.querySelector("#swapFiles"),
  newComparison: document.querySelector("#newComparison"),
  themeToggle: document.querySelector("#themeToggle"),
  dropOverlay: document.querySelector("#dropOverlay"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  diffFrame: document.querySelector("#diffFrame"),
  diffBody: document.querySelector("#diffBody"),
  emptyResult: document.querySelector("#emptyResult"),
  statusBadge: document.querySelector("#statusBadge"),
  languageBadge: document.querySelector("#languageBadge"),
  deletionStat: document.querySelector("#deletionStat"),
  additionStat: document.querySelector("#additionStat"),
  modifiedStat: document.querySelector("#modifiedStat"),
  previousChange: document.querySelector("#previousChange"),
  nextChange: document.querySelector("#nextChange"),
  changePosition: document.querySelector("#changePosition"),
  contextSelect: document.querySelector("#contextSelect"),
  ignoreComments: document.querySelector("#ignoreComments"),
  stripCr: document.querySelector("#stripCr"),
  wrapLines: document.querySelector("#wrapLines"),
  lhsHeaderName: document.querySelector("#lhsHeaderName"),
  rhsHeaderName: document.querySelector("#rhsHeaderName"),
  lhsHeaderMeta: document.querySelector("#lhsHeaderMeta"),
  rhsHeaderMeta: document.querySelector("#rhsHeaderMeta"),
  toast: document.querySelector("#toast"),
  toastMessage: document.querySelector("#toastMessage"),
  closeToast: document.querySelector("#closeToast"),
};

function tauriApi() {
  return window.__TAURI__ || null;
}

function fileName(path) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function setFile(side, path) {
  if (!path || typeof path !== "string") return;
  state[side] = { kind: "file", path, name: fileName(path) };
  state.result = null;
  renderFileCards();
  advanceToOpenSide(side);
}

function pastedFileName(side) {
  const other = state[side === "lhs" ? "rhs" : "lhs"];
  const extension = other?.name?.match(/(\.[a-z0-9_+-]+)$/i)?.[1] || ".txt";
  return side === "lhs" ? `pasted-original${extension}` : `pasted-changed${extension}`;
}

function setPastedText(side, content) {
  if (typeof content !== "string" || content.length === 0) return;
  state[side] = {
    kind: "text",
    name: state[side]?.kind === "text" ? state[side].name : pastedFileName(side),
    content,
  };
  state.result = null;
  renderFileCards();
  advanceToOpenSide(side);
  compareIfReady();
}

function advanceToOpenSide(side) {
  const opposite = side === "lhs" ? "rhs" : "lhs";
  state.activeSide = state[opposite] ? side : opposite;
  if (!state[opposite]) {
    elements[`${opposite}Card`].focus({ preventScroll: true });
  }
}

function setDroppedFiles(paths, preferredSide = null) {
  const usable = [...new Set(paths)].filter(Boolean);
  if (!usable.length) return;

  if (usable.length >= 2) {
    setFile("lhs", usable[0]);
    setFile("rhs", usable[1]);
  } else if (preferredSide) {
    setFile(preferredSide, usable[0]);
  } else if (!state.lhs) {
    setFile("lhs", usable[0]);
  } else if (!state.rhs) {
    setFile("rhs", usable[0]);
  } else {
    // Starting with a new original is the least surprising behavior after a
    // completed comparison; the next single drop will fill the changed side.
    state.rhs = null;
    setFile("lhs", usable[0]);
  }

  hideDropState();
  compareIfReady();
}

function renderFileCards() {
  renderCard(elements.lhsCard, state.lhs);
  renderCard(elements.rhsCard, state.rhs);
  const hasResult = Boolean(state.result && state.lhs && state.rhs);
  elements.welcome.classList.toggle("compact", hasResult);
  elements.workspace.classList.toggle("visible", hasResult);
}

function renderCard(card, file) {
  card.classList.toggle("has-file", Boolean(file));
  card.classList.toggle("pasted", file?.kind === "text");
  if (!file) return;
  card.querySelector(".selected-name").textContent = file.kind === "text" ? "Pasted text" : file.name;
  card.querySelector(".selected-path").textContent = file.kind === "text"
    ? `${sourceLines(file.content).length} lines · ${formatBytes(new TextEncoder().encode(file.content).length)}`
    : file.path;
}

async function chooseFile(side) {
  const api = tauriApi();
  if (!api?.dialog?.open) {
    showError("The native file picker is only available inside the Tauri app.");
    return;
  }

  try {
    const selected = await api.dialog.open({
      multiple: false,
      directory: false,
      title: side === "lhs" ? "Choose the original file" : "Choose the changed file",
    });
    if (typeof selected === "string") {
      setFile(side, selected);
      compareIfReady();
    }
  } catch (error) {
    showError(error);
  }
}

async function compareIfReady() {
  if (!state.lhs || !state.rhs || state.comparing) return;
  const api = tauriApi();
  if (!api?.core?.invoke) {
    showError("Open this page through Difftastic Studio to run the Rust diff engine.");
    return;
  }

  state.comparing = true;
  elements.loadingOverlay.classList.add("visible");
  elements.loadingOverlay.setAttribute("aria-hidden", "false");

  try {
    const response = await api.core.invoke("compare_inputs", {
      lhs: inputPayload(state.lhs),
      rhs: inputPayload(state.rhs),
      ignoreComments: elements.ignoreComments.checked,
      stripCr: elements.stripCr.checked,
    });
    state.result = JSON.parse(response);
    buildRows();
    renderResult();
    renderFileCards();
  } catch (error) {
    showError(error);
  } finally {
    state.comparing = false;
    elements.loadingOverlay.classList.remove("visible");
    elements.loadingOverlay.setAttribute("aria-hidden", "true");
  }
}

function inputPayload(input) {
  if (input.kind === "text") {
    return { kind: "text", name: input.name, content: input.content };
  }
  return { kind: "file", path: input.path };
}

function buildRows() {
  const result = state.result;
  const lhsLines = sourceLines(result.lhs.content);
  const rhsLines = sourceLines(result.rhs.content);
  const lhsChanges = new Map();
  const rhsChanges = new Map();

  for (const chunk of result.diff.chunks || []) {
    for (const line of chunk) {
      if (line.lhs) lhsChanges.set(line.lhs.line_number, line.lhs.changes || []);
      if (line.rhs) rhsChanges.set(line.rhs.line_number, line.rhs.changes || []);
    }
  }

  let alignment = result.diff.aligned_lines;
  if (!alignment?.length) {
    const longest = Math.max(lhsLines.length, rhsLines.length);
    alignment = Array.from({ length: longest }, (_, index) => [
      index < lhsLines.length ? index : null,
      index < rhsLines.length ? index : null,
    ]);
  }

  state.rows = alignment.map(([lhsNumber, rhsNumber], index) => {
    const lhsText = lhsNumber == null ? null : (lhsLines[lhsNumber] ?? "");
    const rhsText = rhsNumber == null ? null : (rhsLines[rhsNumber] ?? "");
    const leftChanges = lhsNumber == null ? [] : (lhsChanges.get(lhsNumber) || []);
    const rightChanges = rhsNumber == null ? [] : (rhsChanges.get(rhsNumber) || []);
    // Novel spans come directly from difftastic. Comparing the raw strings
    // here would re-introduce formatting-only noise that the structural engine
    // deliberately filtered out.
    const changed = lhsNumber == null || rhsNumber == null || leftChanges.length > 0 || rightChanges.length > 0;
    return {
      index,
      lhsNumber,
      rhsNumber,
      lhsText,
      rhsText,
      lhsChanges: leftChanges,
      rhsChanges: rightChanges,
      changed,
    };
  });

  state.changeIndexes = state.rows.filter((row) => row.changed).map((row) => row.index);
  state.currentChange = 0;
}

function sourceLines(content) {
  if (!content) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

function renderResult() {
  const { result } = state;
  const changed = result.has_syntactic_changes && state.changeIndexes.length > 0;
  elements.statusBadge.classList.toggle("unchanged", !changed);
  elements.statusBadge.querySelector("span").textContent = changed ? "Changed" : "Unchanged";
  elements.languageBadge.textContent = result.language;
  elements.lhsHeaderName.textContent = result.lhs.name;
  elements.rhsHeaderName.textContent = result.rhs.name;
  elements.lhsHeaderMeta.textContent = `${result.lhs.lines} lines · ${formatBytes(result.lhs.bytes)}`;
  elements.rhsHeaderMeta.textContent = `${result.rhs.lines} lines · ${formatBytes(result.rhs.bytes)}`;

  const stats = state.rows.reduce((totals, row) => {
    if (!row.changed) return totals;
    if (row.lhsNumber == null) totals.added += 1;
    else if (row.rhsNumber == null) totals.deleted += 1;
    else totals.modified += 1;
    return totals;
  }, { added: 0, deleted: 0, modified: 0 });
  elements.deletionStat.textContent = `−${stats.deleted}`;
  elements.additionStat.textContent = `+${stats.added}`;
  elements.modifiedStat.textContent = `${stats.modified} modified`;

  elements.emptyResult.classList.toggle("visible", !changed);
  elements.diffBody.style.display = changed ? "block" : "none";
  if (changed) renderRows();
  else elements.diffBody.innerHTML = "";
  updateNavigation();
}

function renderRows() {
  const contextValue = elements.contextSelect.value;
  const context = contextValue === "all" ? Infinity : Number(contextValue);
  const visible = new Set();

  if (context === Infinity) {
    state.rows.forEach((row) => visible.add(row.index));
  } else {
    for (const changedIndex of state.changeIndexes) {
      const start = Math.max(0, changedIndex - context);
      const end = Math.min(state.rows.length - 1, changedIndex + context);
      for (let index = start; index <= end; index += 1) visible.add(index);
    }
  }

  let html = "";
  let previous = -1;
  for (const row of state.rows) {
    if (!visible.has(row.index)) continue;
    if (row.index > previous + 1) {
      const skipped = row.index - previous - 1;
      html += `<div class="skip-row">${skipped} unchanged ${skipped === 1 ? "line" : "lines"}</div>`;
    }
    html += renderRow(row);
    previous = row.index;
  }
  if (previous < state.rows.length - 1) {
    const skipped = state.rows.length - previous - 1;
    html += `<div class="skip-row">${skipped} unchanged ${skipped === 1 ? "line" : "lines"}</div>`;
  }
  elements.diffBody.innerHTML = html;
}

function renderRow(row) {
  const changeAttribute = row.changed ? ` data-change-index="${row.index}"` : "";
  return `<div class="diff-row"${changeAttribute}>
    ${renderSide("lhs", row)}
    ${renderSide("rhs", row)}
  </div>`;
}

function renderSide(side, row) {
  const isLeft = side === "lhs";
  const number = isLeft ? row.lhsNumber : row.rhsNumber;
  const otherNumber = isLeft ? row.rhsNumber : row.lhsNumber;
  const text = isLeft ? row.lhsText : row.rhsText;
  const changes = isLeft ? row.lhsChanges : row.rhsChanges;
  const status = number == null ? "empty" : (otherNumber == null || row.changed ? (isLeft ? "removed" : "added") : "");
  const lineNumber = number == null ? "" : number + 1;
  const content = number == null ? "" : renderChangedText(text, changes);
  return `<div class="code-side ${status}"><span class="line-number">${lineNumber}</span><pre class="code-content">${content || " "}</pre></div>`;
}

function renderChangedText(text, changes) {
  if (!changes.length) {
    return escapeHtml(text);
  }

  const ordered = [...changes].sort((a, b) => a.start - b.start || a.end - b.end);
  let byteCursor = 0;
  let html = "";
  for (const change of ordered) {
    const start = Math.max(byteCursor, change.start);
    const end = Math.max(start, change.end);
    html += escapeHtml(sliceByBytes(text, byteCursor, start));
    const changedText = sliceByBytes(text, start, end) || change.content || "";
    html += `<span class="changed-token ${escapeAttribute(change.highlight || "normal")}">${escapeHtml(changedText)}</span>`;
    byteCursor = Math.max(byteCursor, end);
  }
  html += escapeHtml(sliceByBytes(text, byteCursor));
  return html;
}

function sliceByBytes(text, startByte, endByte = Infinity) {
  let bytes = 0;
  let startIndex = text.length;
  let endIndex = text.length;
  let foundStart = false;
  for (let index = 0; index < text.length;) {
    if (!foundStart && bytes >= startByte) {
      startIndex = index;
      foundStart = true;
    }
    if (bytes >= endByte) {
      endIndex = index;
      return text.slice(startIndex, endIndex);
    }
    const codePoint = text.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    bytes += new TextEncoder().encode(character).length;
    index += character.length;
  }
  if (!foundStart && bytes >= startByte) startIndex = text.length;
  return text.slice(startIndex, endByte === Infinity ? text.length : endIndex);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, "");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateNavigation() {
  const count = state.changeIndexes.length;
  elements.changePosition.textContent = count ? `${state.currentChange + 1} / ${count}` : "0 / 0";
  elements.previousChange.disabled = count === 0;
  elements.nextChange.disabled = count === 0;
}

function navigateChange(direction) {
  if (!state.changeIndexes.length) return;
  state.currentChange = (state.currentChange + direction + state.changeIndexes.length) % state.changeIndexes.length;
  const rowIndex = state.changeIndexes[state.currentChange];
  const row = elements.diffBody.querySelector(`[data-change-index="${rowIndex}"]`);
  elements.diffBody.querySelectorAll(".change-anchor").forEach((node) => node.classList.remove("change-anchor"));
  if (row) {
    row.classList.add("change-anchor");
    row.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  updateNavigation();
}

function swapFiles() {
  [state.lhs, state.rhs] = [state.rhs, state.lhs];
  state.result = null;
  renderFileCards();
  compareIfReady();
}

function resetComparison() {
  state.lhs = null;
  state.rhs = null;
  state.result = null;
  state.rows = [];
  state.changeIndexes = [];
  state.activeSide = "lhs";
  elements.diffBody.innerHTML = "";
  renderFileCards();
}

function showError(error) {
  elements.toastMessage.textContent = typeof error === "string" ? error : (error?.message || String(error));
  elements.toast.classList.add("visible");
  window.clearTimeout(showError.timer);
  showError.timer = window.setTimeout(() => elements.toast.classList.remove("visible"), 7000);
}

function hideDropState() {
  elements.dropOverlay.classList.remove("visible");
  elements.dropOverlay.setAttribute("aria-hidden", "true");
  elements.lhsCard.classList.remove("drop-ready");
  elements.rhsCard.classList.remove("drop-ready");
  elements.lhsCard.classList.remove("drag-target");
  elements.rhsCard.classList.remove("drag-target");
  dragState.paths = [];
  dragState.itemCount = 0;
}

function sideAtPosition(position) {
  if (!position) return null;
  const scale = window.devicePixelRatio || 1;
  // Wry uses CSS-like coordinates on macOS/Linux. Keep a physical-pixel
  // fallback for platforms that report the native position at display scale.
  const candidates = [position, { x: position.x / scale, y: position.y / scale }];
  for (const point of candidates) {
    for (const side of ["lhs", "rhs"]) {
      const rect = elements[`${side}Card`].getBoundingClientRect();
      if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) return side;
    }
  }
  return null;
}

function indicateDrop({ paths = [], position = null, itemCount = 0 } = {}) {
  const usablePaths = [...new Set(paths)].filter(Boolean);
  if (usablePaths.length) dragState.paths = usablePaths;
  if (itemCount) dragState.itemCount = itemCount;

  const draggedCount = dragState.paths.length || dragState.itemCount;
  const isMultiFile = draggedCount >= 2;
  const side = draggedCount === 1 ? sideAtPosition(position) : null;

  elements.dropOverlay.classList.toggle("visible", isMultiFile);
  elements.dropOverlay.setAttribute("aria-hidden", isMultiFile ? "false" : "true");
  elements.lhsCard.classList.toggle("drop-ready", draggedCount === 1);
  elements.rhsCard.classList.toggle("drop-ready", draggedCount === 1);
  elements.lhsCard.classList.toggle("drag-target", side === "lhs");
  elements.rhsCard.classList.toggle("drag-target", side === "rhs");
}

async function installNativeDropListeners() {
  const listen = tauriApi()?.event?.listen;
  if (!listen) return;
  await listen("tauri://drag-enter", (event) => indicateDrop(event.payload));
  await listen("tauri://drag-over", (event) => indicateDrop(event.payload));
  await listen("tauri://drag-leave", hideDropState);
  await listen("tauri://drag-drop", (event) => {
    const payload = event.payload || {};
    const paths = [...new Set(payload.paths?.length ? payload.paths : dragState.paths)].filter(Boolean);
    const side = paths.length >= 2 ? null : sideAtPosition(payload.position);
    hideDropState();
    if (paths.length >= 2) {
      setDroppedFiles(paths);
    } else if (paths.length === 1 && side) {
      setDroppedFiles(paths, side);
    }
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("difftastic-theme", theme);
}

function setLineWrapping(enabled) {
  elements.wrapLines.checked = enabled;
  elements.diffFrame.classList.toggle("wrap-lines", enabled);
  localStorage.setItem("difftastic-wrap-lines", enabled ? "on" : "off");
}

function bindEvents() {
  elements.lhsCard.addEventListener("click", () => chooseFile("lhs"));
  elements.rhsCard.addEventListener("click", () => chooseFile("rhs"));
  for (const side of ["lhs", "rhs"]) {
    const card = elements[`${side}Card`];
    card.addEventListener("mouseenter", () => { state.activeSide = side; });
    card.addEventListener("focus", () => { state.activeSide = side; });
  }
  elements.swapFiles.addEventListener("click", swapFiles);
  elements.newComparison.addEventListener("click", resetComparison);
  elements.previousChange.addEventListener("click", () => navigateChange(-1));
  elements.nextChange.addEventListener("click", () => navigateChange(1));
  elements.contextSelect.addEventListener("change", renderRows);
  elements.ignoreComments.addEventListener("change", compareIfReady);
  elements.stripCr.addEventListener("change", compareIfReady);
  elements.wrapLines.addEventListener("change", () => setLineWrapping(elements.wrapLines.checked));
  elements.closeToast.addEventListener("click", () => elements.toast.classList.remove("visible"));
  elements.themeToggle.addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  document.addEventListener("dragenter", (event) => {
    event.preventDefault();
    const itemCount = [...(event.dataTransfer?.items || [])]
      .filter((item) => item.kind === "file").length;
    indicateDrop({
      position: { x: event.clientX, y: event.clientY },
      itemCount,
    });
  });
  document.addEventListener("dragover", (event) => {
    event.preventDefault();
    indicateDrop({
      position: { x: event.clientX, y: event.clientY },
      itemCount: dragState.itemCount,
    });
  });
  document.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget) hideDropState();
  });
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    // WKWebView may expose a native `path` property. Tauri's native event is
    // still the primary path because browsers intentionally hide file paths.
    const paths = [...(event.dataTransfer?.files || [])].map((file) => file.path).filter(Boolean);
    const side = paths.length >= 2 ? null : sideAtPosition({ x: event.clientX, y: event.clientY });
    hideDropState();
    if (paths.length >= 2) {
      setDroppedFiles(paths);
    } else if (paths.length === 1 && side) {
      setDroppedFiles(paths, side);
    }
  });

  document.addEventListener("paste", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
    const content = event.clipboardData?.getData("text/plain");
    if (!content) return;
    event.preventDefault();
    // Mouse intent wins. A card may retain keyboard focus after a picker or a
    // previous paste, but hovering the opposite card must always redirect the
    // next paste there.
    const hoveredSide = document.querySelector(".file-card:hover")?.dataset.side;
    const focusedSide = document.activeElement?.closest?.(".file-card")?.dataset.side;
    const side = hoveredSide || focusedSide || state.activeSide;
    setPastedText(side, content);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
      event.preventDefault();
      chooseFile(state.lhs ? "rhs" : "lhs");
    } else if (event.key === "]" || event.key.toLowerCase() === "n") {
      navigateChange(1);
    } else if (event.key === "[" || event.key.toLowerCase() === "p") {
      navigateChange(-1);
    }
  });
}

function init() {
  const savedTheme = localStorage.getItem("difftastic-theme");
  const darkPreferred = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  setTheme(savedTheme || (darkPreferred ? "dark" : "light"));
  setLineWrapping(localStorage.getItem("difftastic-wrap-lines") === "on");
  bindEvents();
  installNativeDropListeners().catch(showError);
  renderFileCards();
}

init();
